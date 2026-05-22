// @vitest-environment node
import { prisma } from "@/lib/prisma";
import type {
  ContractRole,
  Finding,
  ModuleRun,
  ModuleStatus,
  ScanStatus,
} from "@prisma/client";

export type VisibilityTier = "unauth" | "email" | "paid";

export interface ScanResponse {
  id: string;
  status: ScanStatus;
  /**
   * Plan 03 §3.5 PR 1: response keeps `compositeScore` as a backward-
   * compat alias of `averageContractScore` for the Phase A window.
   * Phase G removes this field once UI consumers migrate to read
   * `averageContractScore` + `worstContractScore` separately.
   */
  compositeScore: number | null;
  /** Plan 03 §6.2 — arithmetic mean of per-Contract scores across graded Contracts. */
  averageContractScore: number | null;
  /**
   * Plan 03 §6.2 — lowest `Contract.compositeScore` among Contracts whose
   * grade matches `compositeGrade` (ties broken by lowest score). Stubbed
   * to null in Phase A; populated by Phase F's protocol-rollup.
   */
  worstContractScore: number | null;
  /** Plan 03 §6.2 — widens to "worst contributing contract's grade" once graphs land. */
  compositeGrade: string | null;
  /** Plan 02 I.1 FIX 3 detector-error clause (spec §6.3). */
  isPartialGrade: boolean;
  /**
   * Plan 03 §6.3 graph-coverage clause — see Plan 03 plan §20 for the
   * two-boolean implementation choice. Stubbed to false in Phase A;
   * populated by Phase F.
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
   * Plan 02 single-contract module list. Plan 03 keeps this at the top
   * level during PR 1 for backward compat (UI consumers haven't migrated
   * yet); Phase G migrates UI to read `contracts[i].modules` and Phase G
   * or J removes this field.
   */
  modules: ModuleRunResponse[];
  /**
   * Plan 03 §7.2 — per-Contract response shape. Stubbed to `[]` in Phase A
   * (no business logic populates contracts yet); Phases B/G populate.
   */
  contracts: ContractResponse[];
  findings: FindingResponse[];
  // NO tier field
  // NO top-level hiddenFindingsCount (per-module in ModuleRunResponse)
}

/**
 * Plan 03 §7.2 — per-Contract response shape. One entry per Contract row
 * within the scan. Phase A ships the type stub only; the response builder
 * returns `contracts: []` until Phase G wires up the populated shape.
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
 * Before G.4, narrowing relied on structural checks (`"id" in f`). With
 * the `tier` discriminator, TypeScript narrows exhaustively and downstream
 * renderers can branch on a stable field. The discriminator is also
 * useful at the wire boundary — clients that see `tier` know which fields
 * to expect without sniffing for presence.
 *
 * Plan 02 only ever resolves to UNAUTH or EMAIL at the route boundary
 * (session?.user?.id ? "email" : "unauth"). The PAID variant ships as a
 * type-level provision for Plan 07+ Subscription lookup; no consumer
 * currently selects it. See NOTES.md "Paid tier route-level subscription
 * lookup (Plan 07+)" for the wiring plan.
 */
export type FindingResponse =
  | FindingResponseUnauth
  | FindingResponseEmail
  | FindingResponsePaid;

export interface FindingResponseUnauth {
  tier: "UNAUTH";
  severity: string;
  publicTitle: string;
  remediationHint: string;
}

export interface FindingResponseEmail {
  tier: "EMAIL";
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
 * structural conflict — `extends FindingResponseEmail` would lock the
 * discriminator to "EMAIL".
 */
export interface FindingResponsePaid
  extends Omit<FindingResponseEmail, "tier"> {
  tier: "PAID";
  remediationDetailed: string;
}

// ── Core query ──────────────────────────────────────────────────────────────

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
      modules: {
        orderBy: { module: "asc" },
      },
      findings: {
        orderBy: [{ module: "asc" }, { publicRank: "asc" }],
      },
    },
  });

  if (!scan) return null;

  const { findings, hiddenByModule } = filterFindings({
    findings: scan.findings,
    tier: params.tier,
  });

  return {
    id: scan.id,
    status: scan.status,
    // Plan 03 §3.5 PR 1: Prisma column renamed to `averageContractScore`.
    // The response surfaces it under BOTH `compositeScore` (Plan 02
    // backward-compat alias) and `averageContractScore` (Plan 03 name).
    // Phase G removes the alias once UI consumers migrate.
    compositeScore: scan.averageContractScore,
    averageContractScore: scan.averageContractScore,
    // Stubbed in Phase A — populated by Phase F's protocol-rollup once
    // multi-Contract scans land.
    worstContractScore: scan.worstContractScore,
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
    modules: scan.modules.map((m) =>
      shapeModuleRun(m, params.tier, hiddenByModule.get(m.module) ?? 0),
    ),
    // Plan 03 §7.2 stub. Phase A's response builder doesn't read or
    // populate Contract rows yet; Phases B/G will. Returning `[]` here
    // keeps the response shape stable for legacy single-contract scans.
    contracts: [],
    findings,
  };
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
    severity: f.severity,
    publicTitle: f.publicTitle,
    remediationHint: f.remediationHint,
  };
}

export function shapeFindingEmail(f: Finding): FindingResponseEmail {
  return {
    tier: "EMAIL",
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
