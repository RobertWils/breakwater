import type { ContractRole } from "@prisma/client";

import { fetchContractAbi } from "@/lib/etherscan-client";
import { publicClient } from "@/lib/rpc-client";

import { checkIsContract } from "./contract-utils";
import { detectGovernor } from "./detect-governor";
import { detectProxy, type ProxyDetectionResult } from "./detect-proxy";
import {
  detectSafe,
  type NotSafeResult,
  type SafeDetectionResult,
} from "./detect-safe";
import { detectTimelock, type TimelockDetectionResult } from "./detect-timelock";
import type { GovernorDetectionResult } from "./types";
import type { GovernanceSnapshotData } from "./types";

/**
 * Plan 03 §5.1.1 — role-aware snapshot capture.
 *
 * `contractAddress` (renamed from Plan 02's `protocolAddress`) is the
 * address being scanned. `role` selects which detector probes get
 * invoked directly against the target vs. cascade-from-governor; see
 * the §5.1.1 role table for the routing matrix.
 *
 * Sibling-candidate hints (`declaredMultisigCandidate`,
 * `timelockCandidate`) replace Plan 02's `declaredMultisigAddresses`
 * array. The Plan 02 single-element pattern collapses cleanly to a
 * single optional string; in Plan 03 these hints come from sibling
 * Contract rows in the same scan (e.g., when a PRIMARY Contract has a
 * sibling DECLARED_MULTISIG Contract, the multisig hint comes from
 * that sibling's address).
 *
 * `blockNumber` is an optional pin (spec §5.1.2 — graph-wide block
 * coordination is a future Plan 04 concern; Phase C accepts the
 * parameter but does not consume it).
 *
 * Phase C.1 (this file) widens the type but keeps Plan 02's default
 * behavior unchanged — the role parameter is destructured but unused
 * here. Phase C.2 implements the §5.1.1 switch table.
 */
export interface CaptureSnapshotContext {
  contractAddress: string;
  role: ContractRole;
  blockNumber?: bigint;
  declaredMultisigCandidate?: string;
  timelockCandidate?: string;
}

/**
 * Compose a full GovernanceSnapshotData from the per-detector outputs.
 *
 * Step order:
 *   1. Pin a block number — every downstream read uses this so the
 *      snapshot is consistent against a single chain state.
 *   2. Governor (no dependencies).
 *   3. Timelock (cascades off Governor for Compound Bravo's
 *      `timelock()` accessor; falls back to candidateAddress=undefined
 *      when no Governor or no candidate is provided — D.3c does not
 *      pass an explicit Timelock candidate yet).
 *   4. Safe multisig (only when `declaredMultisigAddresses` carries
 *      at least one entry).
 *   5. Proxy (independent of the others — operates on the protocol
 *      address directly).
 *
 * The returned object is the persistence-ready shape; D.4 writes it
 * to the GovernanceSnapshot table.
 */
/**
 * Plan 03 §5.1.1 — empty proxy detection result used by the
 * DECLARED_MULTISIG branch (multisigs aren't proxies; we skip the
 * EIP-1967 read entirely to save RPC). The downstream snapshot's
 * `proxyType === "NONE"` triggers the same ABI-fetch fallback path
 * Plan 02 already exercises for non-proxy contracts, so the existing
 * detector logic remains uniform.
 */
const EMPTY_PROXY_RESULT: ProxyDetectionResult = {
  proxyType: "NONE",
  proxyAdminAddress: null,
  proxyImplementation: null,
  proxyAdminIsContract: null,
  implementationAbi: null,
};

type ProbeResults = {
  governorResult: GovernorDetectionResult;
  timelockResult: TimelockDetectionResult | null;
  safeResult: SafeDetectionResult | NotSafeResult | null;
  proxyResult: ProxyDetectionResult;
};

/**
 * Plan 03 §5.1.1 role-branched probe routing. The role determines which
 * detector probes get invoked directly against the scan target vs.
 * cascade-from-governor:
 *
 *   PRIMARY / PROXY_IMPLEMENTATION / RELATED
 *     Plan 02 default — governor + timelock + proxy on contractAddress;
 *     Safe only when a sibling-multisig candidate is supplied.
 *
 *   DECLARED_MULTISIG
 *     Scan the target AS a Safe. Governor/timelock/proxy are not invoked
 *     (multisigs aren't governors and don't sit behind proxies in the
 *     typical Safe deployment model). GOV-003 will fire on the resulting
 *     snapshot because `multisigAddress` is now populated from the
 *     contractAddress itself rather than from a separate candidate hint.
 *     This is the BLOCKER 2 load-bearing branch.
 *
 *   TIMELOCK
 *     Direct timelock probe on the scan target (passes contractAddress
 *     as `candidateAddress` to detectTimelock, which Plan 02 already
 *     supports). Proxy probe still runs because timelocks can be
 *     deployed behind proxies. Governor/Safe skipped.
 *
 *   TOKEN_CONTRACT / DECLARED_BRIDGE
 *     Defensive throw — submission-layer role-applicability gating
 *     (§4.2) should have SKIPPED the GOVERNANCE module for these
 *     roles, so they never reach capture. This is defense-in-depth
 *     against a future submission path that bypasses the gate.
 */
async function probeForRole(
  contractAddress: string,
  role: ContractRole,
  blockNumber: bigint,
  declaredMultisigCandidate: string | undefined,
  timelockCandidate: string | undefined,
): Promise<ProbeResults> {
  switch (role) {
    case "DECLARED_MULTISIG":
      // BLOCKER 2 load-bearing branch.
      return {
        governorResult: null,
        timelockResult: null,
        safeResult: await detectSafe({ candidateAddress: contractAddress }),
        proxyResult: EMPTY_PROXY_RESULT,
      };

    case "TIMELOCK":
      return {
        governorResult: null,
        timelockResult: await detectTimelock({
          blockNumber,
          governorResult: null,
          candidateAddress: contractAddress,
        }),
        safeResult: null,
        proxyResult: await detectProxy({
          protocolAddress: contractAddress,
          blockNumber,
        }),
      };

    case "TOKEN_CONTRACT":
    case "DECLARED_BRIDGE":
      throw new Error(
        `[capture-snapshot] role ${role} should be SKIPPED at submission, not reach capture`,
      );

    case "PRIMARY":
    case "PROXY_IMPLEMENTATION":
    case "RELATED":
    default: {
      // Plan 02 default behavior preserved: direct governor + proxy
      // probes, cascade-from-governor timelock (or explicit candidate
      // when supplied), safe only when a sibling-multisig hint exists.
      const governorResult = await detectGovernor({
        protocolAddress: contractAddress,
        blockNumber,
      });
      const timelockResult = await detectTimelock({
        blockNumber,
        governorResult,
        candidateAddress: timelockCandidate,
      });
      const safeResult = declaredMultisigCandidate
        ? await detectSafe({ candidateAddress: declaredMultisigCandidate })
        : null;
      const proxyResult = await detectProxy({
        protocolAddress: contractAddress,
        blockNumber,
      });
      return { governorResult, timelockResult, safeResult, proxyResult };
    }
  }
}

export async function captureGovernanceSnapshot(
  context: CaptureSnapshotContext,
): Promise<GovernanceSnapshotData> {
  const {
    contractAddress,
    role,
    declaredMultisigCandidate,
    timelockCandidate,
  } = context;

  // Plan 03 §5.1.1 defensive short-circuit. TOKEN_CONTRACT and
  // DECLARED_BRIDGE roles must never reach capture — the submission
  // filter (§4.2 role-applicability gating) SKIPs the GOVERNANCE
  // ModuleRun for these roles at scan creation. This throw fires
  // BEFORE any RPC call (no getBlockNumber, no checkIsContract, no
  // detector probes) so a bypassed filter surfaces a clear
  // role-not-supported error immediately instead of a potentially
  // confusing RPC error or an empty-snapshot-graded-A misread.
  // The duplicate guard inside `probeForRole` is defense-in-depth for
  // any future caller that invokes probeForRole directly.
  if (role === "TOKEN_CONTRACT" || role === "DECLARED_BRIDGE") {
    throw new Error(
      `[capture-snapshot] role ${role} should be SKIPPED at submission, not reach capture`,
    );
  }

  // Spec §5.1.2: `blockNumber` is an optional pin for future graph-wide
  // coordination. Plan 03 captures per-Contract independently, so when
  // no pin is provided we fetch one ourselves (Plan 02 behavior).
  const blockNumber =
    context.blockNumber ?? (await publicClient.getBlockNumber());

  // H.8: fail-closed when the address has no deployed bytecode. Without
  // this gate, EOAs and undeployed contracts produce empty snapshots
  // (no governor / timelock / multisig / proxy / ABI). Every detector
  // then returns `[]` against the empty input, the composite calc
  // scores 100, and the UI presents a misleading grade A for a
  // non-contract submission.
  //
  // We only gate on a definitive `false` from `checkIsContract`. A
  // `null` return means the RPC call itself failed — those should fall
  // through to the downstream calls (which have their own retries via
  // viem's fallback transport) rather than being misclassified here as
  // "not a contract."
  const isContract = await checkIsContract(contractAddress, blockNumber);
  if (isContract === false) {
    throw new Error(
      `address_is_not_contract: ${contractAddress} has no contract ` +
        `bytecode on this chain (EOA or undeployed contract)`,
    );
  }

  const { governorResult, timelockResult, safeResult, proxyResult } =
    await probeForRole(
      contractAddress,
      role,
      blockNumber,
      declaredMultisigCandidate,
      timelockCandidate,
    );

  // E.2: For non-proxy contracts, fetch the protocol's own ABI so
  // GOV-002 can scan it for emergency/bypass function patterns.
  // Proxy contracts already have implementationAbi populated by
  // detect-proxy; skip the redundant fetch.
  //
  // Plan 03 §5.1.1: the DECLARED_MULTISIG branch returns
  // EMPTY_PROXY_RESULT (proxyType: "NONE") so the ABI fetch fires for
  // multisigs too — uniform with Plan 02's non-proxy contract path.
  let protocolAbi: string | null = null;
  if (proxyResult.proxyType === "NONE") {
    const abiResult = await fetchContractAbi(contractAddress);
    if (abiResult.ok) {
      protocolAbi = abiResult.data;
    }
    // Etherscan unavailable (missing key, rate limit, unverified
    // contract) → leave null. GOV-002 treats null as "skip with note".
  }

  const safeIsValid = safeResult !== null && safeResult.isSafe;

  return {
    blockNumber,
    capturedAt: new Date(),

    hasGovernor: governorResult !== null,
    governorAddress: governorResult?.address ?? null,
    governorType: governorResult?.type ?? null,
    governorVersion: governorResult?.version ?? null,

    hasTimelock: timelockResult !== null,
    timelockAddress: timelockResult?.address ?? null,
    timelockMinDelay: timelockResult?.minDelay ?? null,
    timelockAdmin: timelockResult?.admin ?? null,
    timelockAdminIsContract: timelockResult?.adminIsContract ?? null,

    hasMultisig: safeIsValid,
    multisigAddress: safeIsValid ? safeResult.address : null,
    multisigThreshold: safeIsValid ? safeResult.threshold : null,
    multisigOwnerCount: safeIsValid ? safeResult.ownerCount : null,
    multisigOwners: safeIsValid ? safeResult.owners : [],

    proxyType: proxyResult.proxyType,
    proxyAdminAddress: proxyResult.proxyAdminAddress,
    proxyImplementation: proxyResult.proxyImplementation,
    proxyVerified: Boolean(proxyResult.implementationAbi),
    proxyAdminIsContract: proxyResult.proxyAdminIsContract,
    implementationAbi: proxyResult.implementationAbi,
    protocolAbi,

    // Voting-token detection deferred (Plan 03+ enhancement).
    votingTokenAddress: null,
    // E.4: votingSnapshotType captured by detect-governor's snapshot probe.
    votingSnapshotType: governorResult?.votingSnapshotType ?? null,

    rawState: {
      // Plan 03 §5.1.1: name the role branch this capture took, for
      // post-hoc debugging / forensic readability. Detectors MUST NOT
      // branch on this — the snapshot data itself carries everything a
      // detector needs (detector signature stays pure per spec §5.1).
      role,
      governor: governorResult?.raw ?? null,
      timelock: timelockResult?.raw ?? null,
      safe: safeResult ?? null,
      proxy: {
        type: proxyResult.proxyType,
        adminAddress: proxyResult.proxyAdminAddress,
        implementation: proxyResult.proxyImplementation,
        adminIsContract: proxyResult.proxyAdminIsContract,
      },
    },
  };
}
