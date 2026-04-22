// @vitest-environment node
import { prisma } from "@/lib/prisma";
import type { ModuleRun, Finding, ScanStatus, ModuleStatus } from "@prisma/client";

export type VisibilityTier = "unauth" | "email" | "paid";

export interface ScanResponse {
  id: string;
  status: ScanStatus;
  compositeScore: number | null;
  compositeGrade: string | null;
  isPartialGrade: boolean;
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
  modules: ModuleRunResponse[];
  findings: FindingResponse[];
  // NO tier field
  // NO top-level hiddenFindingsCount (per-module in ModuleRunResponse)
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

export type FindingResponse =
  | FindingResponseUnauth
  | FindingResponseEmail
  | FindingResponsePaid;

export interface FindingResponseUnauth {
  severity: string;
  publicTitle: string;
  remediationHint: string;
}

export interface FindingResponseEmail {
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

export interface FindingResponsePaid extends FindingResponseEmail {
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
    compositeScore: scan.compositeScore,
    compositeGrade: scan.compositeGrade,
    isPartialGrade: scan.isPartialGrade,
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
    severity: f.severity,
    publicTitle: f.publicTitle,
    remediationHint: f.remediationHint,
  };
}

export function shapeFindingEmail(f: Finding): FindingResponseEmail {
  return {
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
    ...shapeFindingEmail(f),
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
