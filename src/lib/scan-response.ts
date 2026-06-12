// @vitest-environment node
import { prisma } from "@/lib/prisma";
import type {
  Contract,
  ContractRole,
  Finding,
  GovernanceSnapshot,
  ModuleRun,
  ModuleStatus,
  ScanStatus,
} from "@prisma/client";

export type VisibilityTier = "unauth" | "email" | "paid";

/**
 * Plan 05 Fase 1.3 — a directed depends-on edge between two Contract rows in
 * the scan, mapped 1-to-1 from an ACTIVE ContractEdge row (fromContractId →
 * from, toContractId → to). Both ids are Contract row ids (= RadarNode ids).
 */
export interface ContractEdgeResponse {
  from: string;
  to: string;
}

export interface ScanResponse {
  id: string;
  status: ScanStatus;
  /** Plan 03 §6.2 — arithmetic mean of per-Contract scores across graded Contracts. */
  averageContractScore: number | null;
  /**
   * Plan 04 §2 — the worst-wins protocol score: the GLOBAL minimum
   * `Contract.compositeScore` across all graded (eligible) Contracts. Always
   * agrees with `compositeGrade` (worst-grade-wins). For legacy rows whose
   * stored `Scan.worstContractScore` is null, this is recomputed from the
   * graded contracts at read time (see `deriveWorstContractScore`).
   */
  worstContractScore: number | null;
  /** Plan 03 §6.2 — "worst contributing contract's grade." */
  compositeGrade: string | null;
  /** Plan 02 I.1 FIX 3 detector-error clause (spec §6.3). */
  isPartialGrade: boolean;
  /**
   * Plan 03 §6.3 graph-coverage clause — true when ≥1 ELIGIBLE Contract
   * coexists with ≥1 FAILED Contract.
   */
  isPartialCoverage: boolean;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
  protocol: {
    slug: string;
    displayName: string;
    chain: string;
    domain: string | null;
    ownershipStatus: string;
  };
  /**
   * Plan 03 §7.2 — per-Contract response shape. The Plan 02 top-level
   * `modules` array was REMOVED in Phase G.6 (spec §13 breaking change);
   * modules now live under each ContractResponse. Post-PR-2 (spec §3.5)
   * every Scan has ≥1 Contract row (backfill + NOT NULL contractId), so
   * all reads go through this contractId-keyed shape exclusively — the
   * PR 1 graceful-degradation adapter for zero-Contract scans is gone.
   */
  contracts: ContractResponse[];
  findings: FindingResponse[];
  /**
   * Plan 05 Fase 1.3 — the scan's persisted ACTIVE depends-on edges, read by
   * the radar (buildStarGraph) instead of synthesising a star. Optional: a
   * scan with no persisted edges (created after the Scope-1 backfill, or N=1)
   * omits it / sends `[]`, and the radar falls back to synthesising the star
   * — byte-identical for those shapes.
   */
  edges?: ContractEdgeResponse[];
  // NO tier field
  // NO top-level hiddenFindingsCount (per-module in ModuleRunResponse)
}

/**
 * Plan 03 §7.2 — per-Contract response shape. One entry per Contract row
 * within the scan.
 */
export interface ContractResponse {
  id: string;
  address: string;
  role: ContractRole;
  label: string | null;
  isPrimary: boolean;
  compositeScore: number | null;
  compositeGrade: string | null;
  isPartialGrade: boolean;
  crossChainTwins: { chain: string; address: string }[];
  modules: ModuleRunResponse[];
  findingsCount: number;
  /**
   * Plan 03 §5.3 detect-and-warn. Populated when the snapshot found a
   * proxy implementation address but the user did not submit it as a
   * separate Contract. Null otherwise. UI renders the warning on this
   * Contract's card.
   */
  proxyImplementationWarning: { detectedAddress: string } | null;
}

export interface ModuleRunResponse {
  id: string;
  module: string;
  status: ModuleStatus;
  grade: string | null;
  score: number | null;
  findingsCount: number | null;
  /** Only for unauth tier, per module, only when > 0 */
  hiddenFindingsCount?: number;
  startedAt: string | null;
  completedAt: string | null;
  attemptCount: number;
  errorMessage: string | null;
  /** null for unauth/email, string for paid */
  errorStack: string | null;
  detectorVersions: unknown;
  rpcCallsUsed: number;
}

/**
 * Tier-discriminated finding union (Plan 02 G.4 — resolves Plan 01 backlog).
 *
 * Plan 03 §7.2 — every variant carries `contractId` so the UI can group
 * findings by Contract without joining tables. Post-PR-2 (§3.5)
 * `Finding.contractId` is NOT NULL and the graceful-degradation adapter
 * is gone, so this is always a real Contract id — non-null.
 */
export type FindingResponse =
  | FindingResponseUnauth
  | FindingResponseEmail
  | FindingResponsePaid;

export interface FindingResponseUnauth {
  tier: "UNAUTH";
  contractId: string;
  severity: string;
  publicTitle: string;
  remediationHint: string;
}

export interface FindingResponseEmail {
  tier: "EMAIL";
  contractId: string;
  id: string;
  moduleRunId: string;
  module: string;
  severity: string;
  publicTitle: string;
  title: string;
  description: string;
  evidence: unknown;
  affectedComponent: string;
  references: unknown;
  remediationHint: string;
  publicRank: number;
  detectorId: string;
  detectorVersion: number;
  createdAt: string;
}

/**
 * Paid variant shares the email payload but adds `remediationDetailed`.
 * `Omit` drops the EMAIL discriminator so we can stamp PAID without
 * structural conflict.
 */
export interface FindingResponsePaid
  extends Omit<FindingResponseEmail, "tier"> {
  tier: "PAID";
  remediationDetailed: string;
}

// ── Core query ──────────────────────────────────────────────────────────────

/**
 * Internal shape returned by the Prisma include — keeps the helper
 * signatures readable while reflecting what's actually loaded.
 */
type ContractWithRelations = Contract & {
  moduleRuns: ModuleRun[];
  findings: Finding[];
  // Plan 03 §3.5 PR 2: GovernanceSnapshot.contractId is now @unique, so
  // this 1:1 relation loads as a single row (or null), not an array.
  governanceSnapshot: GovernanceSnapshot | null;
};

export async function getScan(params: {
  scanId: string;
  tier: VisibilityTier;
}): Promise<ScanResponse | null> {
  const scan = await prisma.scan.findUnique({
    where: { id: params.scanId },
    include: {
      protocol: {
        select: {
          slug: true,
          displayName: true,
          chain: true,
          domain: true,
          ownershipStatus: true,
        },
      },
      findings: {
        orderBy: [{ module: "asc" }, { publicRank: "asc" }],
      },
      contracts: {
        include: {
          moduleRuns: { orderBy: { module: "asc" } },
          findings: { orderBy: [{ module: "asc" }, { publicRank: "asc" }] },
          governanceSnapshot: true,
        },
      },
    },
  });

  if (!scan) return null;

  const { contracts, findings } = buildContractsAndFindings({
    scanContracts: (scan.contracts ?? []) as ContractWithRelations[],
    scanFindings: scan.findings,
    tier: params.tier,
  });

  // Plan 05 Fase 1.3 — load this scan's ACTIVE depends-on edges (the
  // synthetic-star rows Scope 1 backfilled; real discovered edges in Fase 2).
  // Read-only — no edges are written here. Scoped to the scan via the
  // fromContract relation (Contract.id is scan-specific). Empty for scans
  // created after the backfill or N=1 scans; the radar falls back to the star.
  const edgeRows = await prisma.contractEdge.findMany({
    where: {
      status: "ACTIVE",
      edgeKind: "DEPENDS_ON",
      fromContract: { scanId: scan.id },
    },
    select: { fromContractId: true, toContractId: true },
  });
  const edges: ContractEdgeResponse[] = edgeRows.map((e) => ({
    from: e.fromContractId,
    to: e.toContractId,
  }));

  return {
    id: scan.id,
    status: scan.status,
    averageContractScore: scan.averageContractScore,
    worstContractScore: deriveWorstContractScore(
      scan.worstContractScore,
      contracts,
    ),
    compositeGrade: scan.compositeGrade,
    isPartialGrade: scan.isPartialGrade,
    isPartialCoverage: scan.isPartialCoverage,
    createdAt: scan.createdAt.toISOString(),
    completedAt: scan.completedAt?.toISOString() ?? null,
    expiresAt: scan.expiresAt.toISOString(),
    protocol: {
      slug: scan.protocol.slug,
      displayName: scan.protocol.displayName,
      chain: scan.protocol.chain,
      domain: scan.protocol.domain,
      ownershipStatus: scan.protocol.ownershipStatus,
    },
    contracts,
    findings,
    edges,
  };
}

/**
 * Plan 04 Step 2 null-safe read-fallback. The protocol headline now renders
 * `worstContractScore` (worst-wins, Plan 04 §2), but the Plan 03 legacy
 * backfill created single-PRIMARY-contract scans without writing
 * `Scan.worstContractScore` (the migration added it nullable). For those rows
 * the stored value is null, which would render no protocol score at all.
 *
 * When the stored value is null, recompute the true worst-wins value at read
 * time as the GLOBAL minimum composite score across graded contracts — the
 * same rule `rollupProtocolComposite` persists for new scans, so the fallback
 * is exact (for the legacy N=1 rows, min over the single contract === that
 * contract's score === the backfilled average). Triggers ONLY when the stored
 * value is null; non-null rows pass through untouched, so no "average" is ever
 * reintroduced into the headline for scans that already have a real value.
 */
function deriveWorstContractScore(
  storedWorst: number | null,
  contracts: ReadonlyArray<{
    compositeScore: number | null;
    compositeGrade: string | null;
  }>,
): number | null {
  if (storedWorst !== null) return storedWorst;
  const gradedScores = contracts
    .filter((c) => c.compositeGrade !== null && c.compositeScore !== null)
    .map((c) => c.compositeScore as number);
  if (gradedScores.length === 0) return null;
  return Math.min(...gradedScores);
}

// ── Multi-Contract projection ───────────────────────────────────────────────

/**
 * Plan 03 §6.2 role-priority for contract ordering (Phase G.2 spec).
 * PRIMARY is handled separately via `isPrimary` sort; this order
 * applies among non-PRIMARY contracts.
 */
const ROLE_PRIORITY: Record<ContractRole, number> = {
  PRIMARY: 0,
  TIMELOCK: 1,
  DECLARED_MULTISIG: 2,
  PROXY_IMPLEMENTATION: 3,
  TOKEN_CONTRACT: 4,
  DECLARED_BRIDGE: 5,
  RELATED: 6,
};

function compareContracts(
  a: { isPrimary: boolean; role: ContractRole; address: string },
  b: { isPrimary: boolean; role: ContractRole; address: string },
): number {
  if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
  const pa = ROLE_PRIORITY[a.role] ?? 99;
  const pb = ROLE_PRIORITY[b.role] ?? 99;
  if (pa !== pb) return pa - pb;
  return a.address.toLowerCase().localeCompare(b.address.toLowerCase());
}

/**
 * Plan 03 §5.3 detect-and-warn. Set when this Contract's snapshot
 * detected a proxy implementation address that the user did not also
 * submit as a separate Contract with role PROXY_IMPLEMENTATION. UI
 * renders an inline note on this Contract's card.
 */
function deriveProxyImplementationWarning(
  contract: ContractWithRelations,
  allContracts: ReadonlyArray<{ address: string; role: ContractRole }>,
): { detectedAddress: string } | null {
  const snapshot = contract.governanceSnapshot;
  const impl = snapshot?.proxyImplementation;
  if (!impl) return null;
  const implLower = impl.toLowerCase();
  const inGraph = allContracts.some(
    (c) =>
      c.address.toLowerCase() === implLower &&
      c.role === "PROXY_IMPLEMENTATION",
  );
  return inGraph ? null : { detectedAddress: impl };
}

/**
 * Plan 03 §7.2 unauth-tier teaser semantic — keyed per
 * `(contractId, module)`. One teaser per (Contract, module) where
 * publicRank === 1; remaining findings count as hidden under the
 * same key. Spec §7.4 accepts that a 10-Contract unauth scan sees
 * up to 10 teasers; this is the per-key aggregation that yields it.
 */
function teaserKey(contractId: string | null, module: string): string {
  return `${contractId ?? "__null__"}:${module}`;
}

function filterUnauthGrouped(findings: Finding[]): {
  shapedByContractId: Map<string | null, FindingResponseUnauth[]>;
  hiddenByContractIdModule: Map<string, number>;
} {
  const teaser = new Map<string, Finding>();
  const total = new Map<string, number>();

  for (const f of findings) {
    const key = teaserKey(f.contractId, f.module);
    total.set(key, (total.get(key) ?? 0) + 1);
    if (f.publicRank === 1 && !teaser.has(key)) {
      teaser.set(key, f);
    }
  }

  const shapedByContractId = new Map<string | null, FindingResponseUnauth[]>();
  for (const f of Array.from(teaser.values())) {
    const shaped = shapeFindingUnauth(f);
    const bucket = shapedByContractId.get(f.contractId) ?? [];
    bucket.push(shaped);
    shapedByContractId.set(f.contractId, bucket);
  }

  const hiddenByContractIdModule = new Map<string, number>();
  for (const [key, count] of Array.from(total.entries())) {
    const shown = teaser.has(key) ? 1 : 0;
    hiddenByContractIdModule.set(key, count - shown);
  }

  return { shapedByContractId, hiddenByContractIdModule };
}

function buildContractsAndFindings(params: {
  scanContracts: ContractWithRelations[];
  scanFindings: Finding[];
  tier: VisibilityTier;
}): { contracts: ContractResponse[]; findings: FindingResponse[] } {
  const { scanContracts, scanFindings, tier } = params;

  // Plan 03 §3.5 PR 2: every Scan has ≥1 Contract row post-backfill, so
  // reads go through the contractId-keyed shape exclusively. The PR 1
  // zero-Contract graceful-degradation adapter was removed here.
  const allContracts = scanContracts.map((c) => ({
    address: c.address,
    role: c.role,
  }));

  // Per-tier finding filtering.
  if (tier === "unauth") {
    const { shapedByContractId, hiddenByContractIdModule } =
      filterUnauthGrouped(scanFindings);

    const contracts = scanContracts
      .slice()
      .sort(compareContracts)
      .map((c) =>
        shapeContract({
          contract: c,
          allContracts,
          tier,
          findingsCount: c.findings.length,
          hiddenLookup: (module) =>
            hiddenByContractIdModule.get(teaserKey(c.id, module)) ?? 0,
        }),
      );

    // Top-level findings flattened from per-Contract teasers in the
    // same sort order, so the wire shape mirrors the ContractList
    // ordering above.
    const findings = contracts.flatMap(
      (c) => shapedByContractId.get(c.id) ?? [],
    );
    return { contracts, findings };
  }

  // email / paid: every finding is shaped + carries contractId.
  const shapedFindings: FindingResponse[] = scanFindings.map((f) =>
    tier === "email" ? shapeFindingEmail(f) : shapeFindingPaid(f),
  );

  const contracts = scanContracts
    .slice()
    .sort(compareContracts)
    .map((c) =>
      shapeContract({
        contract: c,
        allContracts,
        tier,
        findingsCount: c.findings.length,
        hiddenLookup: () => 0,
      }),
    );

  return { contracts, findings: shapedFindings };
}

function shapeContract(args: {
  contract: ContractWithRelations;
  allContracts: ReadonlyArray<{ address: string; role: ContractRole }>;
  tier: VisibilityTier;
  findingsCount: number;
  hiddenLookup: (module: string) => number;
}): ContractResponse {
  const { contract, allContracts, tier, findingsCount, hiddenLookup } = args;
  return {
    id: contract.id,
    address: contract.address,
    role: contract.role,
    label: contract.label,
    isPrimary: contract.isPrimary,
    compositeScore: contract.compositeScore,
    compositeGrade: contract.compositeGrade,
    isPartialGrade: contract.isPartialGrade,
    crossChainTwins: normaliseCrossChainTwins(contract.crossChainTwins),
    modules: contract.moduleRuns.map((m) =>
      shapeModuleRun(m, tier, hiddenLookup(m.module)),
    ),
    findingsCount,
    proxyImplementationWarning: deriveProxyImplementationWarning(
      contract,
      allContracts,
    ),
  };
}

function normaliseCrossChainTwins(
  raw: unknown,
): { chain: string; address: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { chain: string; address: string }[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      "chain" in entry &&
      "address" in entry
    ) {
      const e = entry as { chain: unknown; address: unknown };
      if (typeof e.chain === "string" && typeof e.address === "string") {
        out.push({ chain: e.chain, address: e.address });
      }
    }
  }
  return out;
}

// ── Finding filtering ────────────────────────────────────────────────────────

export function filterFindings(params: {
  findings: Finding[];
  tier: VisibilityTier;
}): {
  findings: FindingResponse[];
  hiddenByModule: Map<string, number>;
} {
  if (params.tier === "unauth") {
    // One teaser per module (publicRank === 1); count the rest as hidden.
    const byModule = new Map<string, Finding>();
    const totalByModule = new Map<string, number>();

    for (const f of params.findings) {
      totalByModule.set(f.module, (totalByModule.get(f.module) ?? 0) + 1);
      if (f.publicRank !== 1) continue;
      if (!byModule.has(f.module)) {
        byModule.set(f.module, f);
      }
    }

    const teaserFindings = Array.from(byModule.values()).map(shapeFindingUnauth);

    const hiddenByModule = new Map<string, number>();
    for (const [module, total] of Array.from(totalByModule.entries())) {
      const shown = byModule.has(module) ? 1 : 0;
      hiddenByModule.set(module, total - shown);
    }

    return { findings: teaserFindings, hiddenByModule };
  }

  const findings =
    params.tier === "email"
      ? params.findings.map(shapeFindingEmail)
      : params.findings.map(shapeFindingPaid);

  return { findings, hiddenByModule: new Map() };
}

// ── Shaping helpers ──────────────────────────────────────────────────────────

export function shapeFindingUnauth(f: Finding): FindingResponseUnauth {
  return {
    tier: "UNAUTH",
    contractId: f.contractId,
    severity: f.severity,
    publicTitle: f.publicTitle,
    remediationHint: f.remediationHint,
  };
}

export function shapeFindingEmail(f: Finding): FindingResponseEmail {
  return {
    tier: "EMAIL",
    contractId: f.contractId,
    id: f.id,
    moduleRunId: f.moduleRunId,
    module: f.module,
    severity: f.severity,
    publicTitle: f.publicTitle,
    title: f.title,
    description: f.description,
    evidence: f.evidence,
    affectedComponent: f.affectedComponent,
    references: f.references,
    remediationHint: f.remediationHint,
    publicRank: f.publicRank,
    detectorId: f.detectorId,
    detectorVersion: f.detectorVersion,
    createdAt: f.createdAt.toISOString(),
  };
}

export function shapeFindingPaid(f: Finding): FindingResponsePaid {
  return {
    // Spread email shape, then overwrite the discriminator so the
    // result narrows correctly as PAID, not EMAIL.
    ...shapeFindingEmail(f),
    tier: "PAID",
    remediationDetailed: f.remediationDetailed,
  };
}

export function shapeModuleRun(
  m: ModuleRun,
  tier: VisibilityTier,
  hiddenCount: number,
): ModuleRunResponse {
  return {
    id: m.id,
    module: m.module,
    status: m.status,
    grade: m.grade,
    score: m.score,
    findingsCount: m.findingsCount,
    ...(tier === "unauth" && hiddenCount > 0 && {
      hiddenFindingsCount: hiddenCount,
    }),
    startedAt: m.startedAt?.toISOString() ?? null,
    completedAt: m.completedAt?.toISOString() ?? null,
    attemptCount: m.attemptCount,
    errorMessage: m.errorMessage,
    errorStack: tier === "paid" ? m.errorStack : null,
    detectorVersions: m.detectorVersions,
    rpcCallsUsed: m.rpcCallsUsed,
  };
}
