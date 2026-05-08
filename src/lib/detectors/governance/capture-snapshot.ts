import { publicClient } from "@/lib/rpc-client";

import { detectGovernor } from "./detect-governor";
import { detectProxy } from "./detect-proxy";
import { detectSafe } from "./detect-safe";
import { detectTimelock } from "./detect-timelock";
import type { GovernanceSnapshotData } from "./types";

export interface CaptureSnapshotContext {
  protocolAddress: string;
  /**
   * Multisig addresses declared by the protocol metadata (from
   * `Protocol.knownMultisigs` or scan-input). Plan 02 D.3c probes only
   * the first entry; Phase E may iterate when GOV-003 needs broader
   * coverage.
   */
  declaredMultisigAddresses?: string[];
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
export async function captureGovernanceSnapshot(
  context: CaptureSnapshotContext,
): Promise<GovernanceSnapshotData> {
  const { protocolAddress, declaredMultisigAddresses } = context;

  const blockNumber = await publicClient.getBlockNumber();

  const governorResult = await detectGovernor({
    protocolAddress,
    blockNumber,
  });

  const timelockResult = await detectTimelock({
    blockNumber,
    governorResult,
  });

  const safeResult =
    declaredMultisigAddresses && declaredMultisigAddresses.length > 0
      ? await detectSafe({
          candidateAddress: declaredMultisigAddresses[0]!,
        })
      : null;

  const proxyResult = await detectProxy({
    protocolAddress,
    blockNumber,
  });

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

    // Voting-token detection deferred to Phase E (GOV-004 will
    // reach into governor.token() / similar accessors when needed).
    votingTokenAddress: null,
    votingSnapshotType: null,

    rawState: {
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
