/**
 * Plan 05 Fase 1.4/1.5 — detect-and-attach discovered contracts.
 *
 * Fase 1.4 promoted the resolved proxy implementation from detect-AND-WARN to
 * detect-AND-ATTACH. Fase 1.5 generalises the engine to ROLE'D CANDIDATES: a
 * discovery source yields `DiscoveredCandidate { address, role, discoveredAs }`
 * (the role assigned by the §4 role ladder), and each new candidate is attached
 * as a flat sibling Contract (discoverySource AUTO, roleSource AUTO) so it is
 * scanned in THIS scan, not the next.
 *
 * Testable core (this commit): the candidate model, dedup, the role-aware
 * row builders, the race-safe attach, and the DI orchestrator. The only LIVE
 * candidate source wired here is detectProxy's EIP-1967 implementation (no new
 * RPC); the §1.1 slot-expansion + §1.2 getter sources push more candidates into
 * `discoverCandidates` in the follow-up.
 *
 * THREE LOAD-BEARING CONSTRAINTS (recon-enforced — the scope stands or falls
 * on these):
 *
 *   1. FLAT SIBLINGS, NO EDGES, NOT RECURSIVE. The implementation becomes a flat
 *      sibling Contract under the Scan (the existing manual PROXY_IMPLEMENTATION
 *      shape) — one level, NO ContractEdge row. Non-recursion is enforced by the
 *      PROBE SET: we only ever probe `discoverySource: MANUAL` contracts (see
 *      the live `loadManualContracts`), never the AUTO-attached implementations.
 *      So even if an attached impl is itself a proxy, its sub-impl is NOT
 *      attached (the detect-and-warn nudge then honestly fires for that next
 *      level). Two-level proxy chains stay flat siblings ⇒ the radar stays a
 *      star ⇒ the Scope-2 scorer no-op stays valid. Recursive attach + real
 *      edges = Fase 2.
 *
 *   2. IDEMPOTENT. Re-running (or an Inngest retry of the attach step) must not
 *      double-attach. `selectImplsToAttach` excludes any address already present
 *      in the scan, and the live `attachImplementation` is a no-op if the
 *      Contract already exists (backed by @@unique([scanId, address])). On a
 *      retry the impl is now an existing MANUAL?-no, AUTO contract — and because
 *      the probe set is MANUAL-only, it is neither re-probed (non-recursion) nor
 *      re-attached (dedup).
 *
 *   3. NO ContractEdge ROWS. Attach adds a Contract (+ its ModuleRuns) only; the
 *      sibling appears in the radar via the existing synthesis/fallback.
 *
 * The pure helpers + the DI orchestrator are unit-tested; the live RPC (detectProxy)
 * + Prisma wiring is in `discoverAndAttachProxyImplementations`.
 */

import {
  ContractRole,
  ModuleName,
  Prisma,
  type Chain,
  type PrismaClient,
} from "@prisma/client";

import { publicClient } from "@/lib/rpc-client";
import {
  IMPLEMENTED_MODULES,
  computeSkipReason,
  generateIdempotencyKey,
} from "@/lib/scan-modules";

import { gatherCandidates, makeCandidateSourceDeps } from "./gather-candidates";

/**
 * A contract discovered from a manual contract's slots/getters, already
 * classified by the role ladder (§4). `address` is lowercased; `discoveredAs`
 * is provenance metadata persisted on `Contract.discoveredAs`.
 */
export interface DiscoveredCandidate {
  address: string;
  role: ContractRole;
  discoveredAs: string;
}

// ─── Pure selection ────────────────────────────────────────────────────────

/**
 * Dedup candidates by address (lowercased) against the addresses ALREADY in the
 * scan AND against each other (first occurrence wins its role), returning the
 * distinct NEW candidates to attach. Non-recursion is the CALLER's
 * responsibility (it discovers only from the manual contracts); this function
 * only dedups.
 */
export function selectCandidatesToAttach(
  candidates: ReadonlyArray<DiscoveredCandidate>,
  existingAddresses: ReadonlyArray<string>,
): DiscoveredCandidate[] {
  const seen = new Set<string>();
  for (const a of existingAddresses) seen.add(a.toLowerCase());

  const out: DiscoveredCandidate[] = [];
  for (const c of candidates) {
    if (!c.address) continue;
    const lower = c.address.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push({ ...c, address: lower });
  }
  return out;
}

// ─── Pure row builders ───────────────────────────────────────────────────────

/** The Contract create-data for an auto-attached, role'd discovered contract. */
export function buildAttachedContractData(params: {
  scanId: string;
  address: string;
  chain: Chain;
  /** Role from the §4 ladder; defaults to PROXY_IMPLEMENTATION (Fase 1.4). */
  role?: ContractRole;
  /** Provenance metadata (e.g. "IMPL_SLOT", "ORACLE"). */
  discoveredAs?: string;
}): Prisma.ContractCreateManyInput {
  return {
    scanId: params.scanId,
    address: params.address,
    chain: params.chain,
    role: params.role ?? ContractRole.PROXY_IMPLEMENTATION,
    isPrimary: false,
    label: null,
    crossChainTwins: [],
    // Plan 05 — provenance: discovered + role inferred by detection.
    discoverySource: "AUTO",
    roleSource: "AUTO",
    // Json? column: use the JsonNull sentinel (not a bare null) when absent.
    discoveredAs: params.discoveredAs ?? Prisma.JsonNull,
  };
}

/**
 * One ModuleRun per ModuleName for an auto-attached contract, mirroring
 * submitScan's per-(Contract, module) creation via the SAME `computeSkipReason`
 * — keyed on the contract's ROLE. For a PROXY_IMPLEMENTATION/TIMELOCK (roles
 * GOVERNANCE applies to) GOVERNANCE ships QUEUED so the fan-out scans it; for a
 * TOKEN_CONTRACT/DECLARED_BRIDGE (roles GOVERNANCE does NOT apply to) it ships
 * SKIPPED (role_not_applicable_to_module) — terminal, so no governance runs on a
 * token and the scan can't hang. A scan that didn't enable GOVERNANCE ships it
 * SKIPPED (module_disabled_by_user) — also terminal.
 */
export function buildModuleRunInputs(
  scanId: string,
  contractId: string,
  role: ContractRole,
  modulesEnabled: ReadonlyArray<string>,
): Prisma.ModuleRunCreateManyInput[] {
  return (Object.values(ModuleName) as ModuleName[]).map((name) => {
    const skipReason = computeSkipReason({
      module: name,
      role,
      enabled: modulesEnabled.includes(name),
      implemented: IMPLEMENTED_MODULES.has(name),
      // Only FRONTEND requires a domain, and it is unimplemented (module_not_
      // implemented wins in computeSkipReason's priority), so hasDomain is moot.
      requiresDomain: name === ModuleName.FRONTEND,
      hasDomain: false,
    });
    return {
      scanId,
      contractId,
      module: name,
      status: skipReason ? "SKIPPED" : "QUEUED",
      errorMessage: skipReason,
      idempotencyKey: generateIdempotencyKey(scanId, name, contractId),
      inputSnapshot: {
        // Audit record only — executeGovernanceModule reads the address/role
        // from the Contract row (loadContractContext), not from here.
        contractAddress: "<auto-attached>",
        contractRole: role,
        discoverySource: "AUTO",
      },
      attemptCount: 0,
      rpcCallsUsed: 0,
      detectorVersions: {},
    };
  });
}

// ─── DI orchestrator ─────────────────────────────────────────────────────────

export interface ManualContract {
  id: string;
  address: string;
  chain: Chain;
}

export interface StructuralDiscoveryDeps {
  /** The probe set — ONLY discoverySource: MANUAL contracts (non-recursion). */
  loadManualContracts(scanId: string): Promise<ManualContract[]>;
  /** ALL contract addresses in the scan, for dedup (manual + already-attached). */
  loadExistingAddresses(scanId: string): Promise<string[]>;
  /**
   * Discover role'd candidates from ONE manual contract's slots/getters (depth
   * 1). Called only on manual contracts, never on attached candidates — that is
   * the non-recursion boundary.
   */
  discoverCandidates(contract: ManualContract): Promise<DiscoveredCandidate[]>;
  /** Create the candidate Contract + its ModuleRuns (idempotent on @@unique). */
  attachCandidate(params: {
    scanId: string;
    address: string;
    chain: Chain;
    role: ContractRole;
    discoveredAs: string;
  }): Promise<void>;
  log(line: string): void;
}

export interface AttachResult {
  probed: number;
  attached: DiscoveredCandidate[];
}

export async function discoverAndAttach(
  deps: StructuralDiscoveryDeps,
  scanId: string,
): Promise<AttachResult> {
  const manual = await deps.loadManualContracts(scanId);
  if (manual.length === 0) return { probed: 0, attached: [] };

  // All contracts in a scan share its chain.
  const chain = manual[0]!.chain;

  // Depth 1: discover ONLY from the manual contracts (non-recursion boundary).
  const perContract = await Promise.all(
    manual.map((c) => deps.discoverCandidates(c)),
  );
  const candidates = perContract.flat();

  const existing = await deps.loadExistingAddresses(scanId);
  const toAttach = selectCandidatesToAttach(candidates, existing);

  for (const c of toAttach) {
    await deps.attachCandidate({
      scanId,
      address: c.address,
      chain,
      role: c.role,
      discoveredAs: c.discoveredAs,
    });
    deps.log(
      `[discovery] attached ${c.address} as ${c.role} (${c.discoveredAs}, AUTO)`,
    );
  }

  return { probed: manual.length, attached: toAttach };
}

// ─── Race-safe attach ─────────────────────────────────────────────────────────

/** Exact field set of Contract's @@unique([scanId, address]). */
const SCAN_ADDRESS_FIELDS = ["scanId", "address"] as const;
/** The constraint name Prisma generates for that compound unique. */
const SCAN_ADDRESS_CONSTRAINT = "Contract_scanId_address_key";

/**
 * True ONLY for a Prisma P2002 unique-constraint violation on Contract's
 * `@@unique([scanId, address])`. NARROW BY DESIGN (Codex claim 5 + point 1): a
 * concurrent race where the loser hits THIS constraint is benign (the row
 * exists, the attach effectively succeeded). Any OTHER P2002 (a different
 * unique) or any non-P2002 error is a real failure that must still trigger the
 * degraded fallback.
 *
 * `meta.target` is the field list (`["scanId","address"]`) or the constraint
 * name (`"Contract_scanId_address_key"`) depending on connector/version. The
 * match is EXACT, not substring: the array must be precisely those two fields
 * (any order, no extras), or the string must equal the constraint name. This
 * closes the substring trap where a future constraint whose name merely
 * CONTAINS both words (e.g. `SomeOther_scanId_address_extra_key`, or a target
 * `["scanId","address","other"]`) would be wrongly swallowed. Unexpected
 * shapes (undefined / empty / non-array-non-string) return false (propagate).
 */
export function isContractScanAddressUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) {
    // Exact set equality: exactly scanId + address, any order, NO extras.
    return (
      target.length === SCAN_ADDRESS_FIELDS.length &&
      SCAN_ADDRESS_FIELDS.every((field) => target.includes(field))
    );
  }
  if (typeof target === "string") {
    return target === SCAN_ADDRESS_CONSTRAINT;
  }
  return false;
}

/**
 * Run an attach, treating ONLY the benign `(scanId, address)` unique race as a
 * clean no-op (another run/transaction already attached this impl — the
 * constraint held, so there is no double row and nothing to do). Any other
 * error propagates so the caller's degraded-fallback fires. This makes the
 * implementation as strong as the idempotency claim: clean no-op on retry AND
 * on a concurrent race, with no spurious `discoveryDegraded`.
 */
export async function attachWithRaceTolerance(
  doAttach: () => Promise<void>,
): Promise<{ attached: boolean }> {
  try {
    await doAttach();
    return { attached: true };
  } catch (err) {
    if (isContractScanAddressUniqueViolation(err)) return { attached: false };
    throw err;
  }
}

// ─── Live wiring (detectProxy + Prisma) ───────────────────────────────────────

/**
 * Entry point executeScan calls (before the ModuleRun fan-out). Builds the live
 * deps and runs the orchestrator. Returns the attach result; the caller wraps
 * this in a guarded step so a hard failure degrades the scan rather than failing
 * the whole run.
 */
export async function discoverAndAttachProxyImplementations(
  prisma: PrismaClient,
  params: { scanId: string; modulesEnabled: ReadonlyArray<string>; blockNumber?: bigint },
): Promise<AttachResult> {
  // One block for the whole attach pass (impl addresses are stable; the module
  // snapshot re-reads at its own block later).
  const blockNumber = params.blockNumber ?? (await publicClient.getBlockNumber());

  // Plan 05 Fase 1.5b — live discovery sources (slots/getters/probes) behind the
  // DI seam. gatherCandidates isolates per-source failures and reports degraded;
  // we OR it across contracts and mark the scan discoveryDegraded if any source
  // failed (a TOTAL failure instead throws → executeScan's wrapper sets the same
  // flag). Either way discovery continues on what succeeded.
  const sourceDeps = makeCandidateSourceDeps(blockNumber);
  let anyDegraded = false;

  const deps: StructuralDiscoveryDeps = {
    async loadManualContracts(scanId) {
      const rows = await prisma.contract.findMany({
        where: { scanId, discoverySource: "MANUAL" },
        select: { id: true, address: true, chain: true },
      });
      return rows;
    },
    async loadExistingAddresses(scanId) {
      const rows = await prisma.contract.findMany({
        where: { scanId },
        select: { address: true },
      });
      return rows.map((r) => r.address);
    },
    async discoverCandidates(contract) {
      const { candidates, degraded } = await gatherCandidates(sourceDeps, contract);
      if (degraded) anyDegraded = true;
      return candidates;
    },
    async attachCandidate({ scanId, address, chain, role, discoveredAs }) {
      // Sequential-retry fast-path (findUnique) + concurrent-race tolerance
      // (P2002 on @@unique([scanId, address]) → no-op). Both yield a clean
      // no-op with no degraded flag; only a REAL failure propagates.
      await attachWithRaceTolerance(() =>
        prisma.$transaction(async (tx) => {
          const existing = await tx.contract.findUnique({
            where: { scanId_address: { scanId, address } },
            select: { id: true },
          });
          if (existing) return;

          const contract = await tx.contract.create({
            data: buildAttachedContractData({ scanId, address, chain, role, discoveredAs }),
            select: { id: true },
          });
          await tx.moduleRun.createMany({
            data: buildModuleRunInputs(scanId, contract.id, role, params.modulesEnabled),
          });
        }),
      );
    },
    log: (line) => console.log(`[execute-scan] ${line}`),
  };

  const result = await discoverAndAttach(deps, params.scanId);

  // Per-source degraded: a source failed but the rest succeeded — mark the scan
  // and continue (the scan is not failed). Idempotent + race-safe via updateMany.
  if (anyDegraded) {
    await prisma.scan.updateMany({
      where: { id: params.scanId },
      data: { discoveryDegraded: true },
    });
  }

  return result;
}
