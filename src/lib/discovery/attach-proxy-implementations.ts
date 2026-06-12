/**
 * Plan 05 Fase 1.4 — detect-and-attach proxy implementations.
 *
 * Promotes an already-resolved proxy implementation from detect-AND-WARN to
 * detect-AND-ATTACH: when a manual contract is a proxy whose implementation is
 * not yet a contract in the scan, the implementation is added as a NEW Contract
 * row (role PROXY_IMPLEMENTATION, discoverySource AUTO) so it is scanned in THIS
 * scan, not the next.
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

import { detectProxy } from "@/lib/detectors/governance/detect-proxy";
import { publicClient } from "@/lib/rpc-client";
import {
  IMPLEMENTED_MODULES,
  computeSkipReason,
  generateIdempotencyKey,
} from "@/lib/scan-modules";

// ─── Pure selection ────────────────────────────────────────────────────────

/**
 * Given the implementations resolved from the probe set and the addresses
 * ALREADY present in the scan, return the distinct NEW implementation addresses
 * to attach (lowercased). Drops nulls, dedups against the existing set AND
 * against each other. Non-recursion is the CALLER's responsibility (it passes
 * only the manual contracts' resolved impls); this function only dedups.
 */
export function selectImplsToAttach(
  resolvedImpls: ReadonlyArray<string | null | undefined>,
  existingAddresses: ReadonlyArray<string>,
): string[] {
  const seen = new Set<string>();
  for (const a of existingAddresses) seen.add(a.toLowerCase());

  const out: string[] = [];
  for (const impl of resolvedImpls) {
    if (!impl) continue;
    const lower = impl.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(lower);
  }
  return out;
}

// ─── Pure row builders ───────────────────────────────────────────────────────

/** The Contract create-data for an auto-attached implementation. */
export function buildAttachedContractData(params: {
  scanId: string;
  address: string;
  chain: Chain;
}): Prisma.ContractCreateManyInput {
  return {
    scanId: params.scanId,
    address: params.address,
    chain: params.chain,
    role: ContractRole.PROXY_IMPLEMENTATION,
    isPrimary: false,
    label: null,
    crossChainTwins: [],
    // Plan 05 Fase 1.4 — provenance: discovered + role inferred by detection.
    discoverySource: "AUTO",
    roleSource: "AUTO",
  };
}

/**
 * One ModuleRun per ModuleName for the attached implementation, mirroring
 * submitScan's per-(Contract, module) creation via the SAME `computeSkipReason`.
 * GOVERNANCE ships QUEUED (so the fan-out scans the impl this scan) when it's in
 * `modulesEnabled`; unimplemented modules ship SKIPPED. Using modulesEnabled for
 * the `enabled` check means a scan that didn't enable GOVERNANCE ships the impl's
 * GOVERNANCE run SKIPPED (module_disabled_by_user) — terminal, so no hang.
 */
export function buildModuleRunInputs(
  scanId: string,
  contractId: string,
  modulesEnabled: ReadonlyArray<string>,
): Prisma.ModuleRunCreateManyInput[] {
  return (Object.values(ModuleName) as ModuleName[]).map((name) => {
    const skipReason = computeSkipReason({
      module: name,
      role: ContractRole.PROXY_IMPLEMENTATION,
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
        contractRole: ContractRole.PROXY_IMPLEMENTATION,
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

export interface ProxyAttachDeps {
  /** The probe set — ONLY discoverySource: MANUAL contracts (non-recursion). */
  loadManualContracts(scanId: string): Promise<ManualContract[]>;
  /** ALL contract addresses in the scan, for dedup (manual + already-attached). */
  loadExistingAddresses(scanId: string): Promise<string[]>;
  /** Resolve a contract's EIP-1967 implementation (null if not a proxy). */
  resolveImplementation(address: string): Promise<string | null>;
  /** Create the impl Contract + its ModuleRuns (idempotent on @@unique). */
  attachImplementation(params: {
    scanId: string;
    address: string;
    chain: Chain;
  }): Promise<void>;
  log(line: string): void;
}

export interface AttachResult {
  probed: number;
  attached: string[];
}

export async function discoverAndAttach(
  deps: ProxyAttachDeps,
  scanId: string,
): Promise<AttachResult> {
  const manual = await deps.loadManualContracts(scanId);
  if (manual.length === 0) return { probed: 0, attached: [] };

  // All contracts in a scan share its chain.
  const chain = manual[0]!.chain;

  // Probe ONLY the manual contracts (non-recursion boundary).
  const resolved = await Promise.all(
    manual.map((c) => deps.resolveImplementation(c.address)),
  );

  const existing = await deps.loadExistingAddresses(scanId);
  const toAttach = selectImplsToAttach(resolved, existing);

  for (const address of toAttach) {
    await deps.attachImplementation({ scanId, address, chain });
    deps.log(
      `[discovery] attached proxy implementation ${address} (PROXY_IMPLEMENTATION, AUTO)`,
    );
  }

  return { probed: manual.length, attached: toAttach };
}

// ─── Race-safe attach ─────────────────────────────────────────────────────────

/**
 * True ONLY for a Prisma P2002 unique-constraint violation on Contract's
 * `@@unique([scanId, address])`. NARROW BY DESIGN (Codex claim 5): a concurrent
 * race where the loser hits this constraint is benign (the row exists, the
 * attach effectively succeeded). Any OTHER P2002 (a different unique) or any
 * non-P2002 error is a real failure that must still trigger the degraded
 * fallback — so we match this one constraint, not "any unique violation".
 *
 * `meta.target` is the field list (`["scanId","address"]`) or the constraint
 * name (`"Contract_scanId_address_key"`) depending on connector/version; both
 * name BOTH columns, and no other unique in the schema names both.
 */
export function isContractScanAddressUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  const target = err.meta?.target;
  const flat = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return flat.includes("scanId") && flat.includes("address");
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

  const deps: ProxyAttachDeps = {
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
    async resolveImplementation(address) {
      const result = await detectProxy({
        protocolAddress: address,
        blockNumber,
      });
      return result.proxyImplementation;
    },
    async attachImplementation({ scanId, address, chain }) {
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
            data: buildAttachedContractData({ scanId, address, chain }),
            select: { id: true },
          });
          await tx.moduleRun.createMany({
            data: buildModuleRunInputs(scanId, contract.id, params.modulesEnabled),
          });
        }),
      );
    },
    log: (line) => console.log(`[execute-scan] ${line}`),
  };

  return discoverAndAttach(deps, params.scanId);
}
