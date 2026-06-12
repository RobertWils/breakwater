import type { Grade } from "@prisma/client";

import { reachableFrom, type GraphEdge } from "@/lib/graph/reachability";
import { isKnownInfra } from "@/lib/scoring/known-infra";

/**
 * Plan 03 Phase F.1 — protocol-level composite rollup per spec §6.2 +
 * §6.3. Pure function over a list of per-Contract grade/score tuples.
 * The function has no Prisma dependency and is exercised exhaustively
 * by unit tests; the live wiring (markComplete reads Contracts,
 * computes per-Contract composites, then calls this) is verified
 * separately in Phase F.2's integration tests.
 *
 * Eligibility (§6.2): ONLY Contracts whose `compositeGrade !== null`
 * contribute to the rollup. That filters out:
 *   - FAILED Contracts (snapshot capture failed or every ModuleRun
 *     ended FAILED): null compositeGrade — excluded.
 *   - SKIPPED Contracts (every applicable ModuleRun ended SKIPPED via
 *     the role-applicability table): null compositeGrade — excluded.
 *   - Any future status carrying null compositeGrade.
 *
 * Worst-grade-wins (§6.2 + Plan 04 §2). The protocol composite grade is
 * the F-most letter across ELIGIBLE Contracts, and `worstContractScore`
 * is the GLOBAL minimum composite score across those same Contracts.
 * Rationale: a protocol is only as safe as its weakest contract —
 * averaging dilutes the signal, so the headline number must be the worst
 * score, never the mean. Both the letter and the number are worst-wins,
 * so they always tell the same story. `averageContractScore` is retained
 * as an honest secondary statistic (the mean) but is NOT the headline.
 *
 * Two-clause partial semantics (§6.3):
 *   - `isPartialGrade` (Plan 02 carry-over): any Contract has its own
 *     `isPartialGrade` flag true — i.e., one of its COMPLETE
 *     ModuleRuns had `errorDetectorCount > 0`. Per-Contract grade is
 *     real but degraded by detector errors.
 *   - `isPartialCoverage` (Plan 03 extension): at least one Contract
 *     contributed a grade AND at least one OTHER Contract finalised
 *     FAILED. Graph coverage is partial. SKIPPED siblings do NOT
 *     trigger this — SKIPPED is role-applicability working as
 *     designed, not coverage degradation.
 *
 * Zero-graded-Contracts guard (§6.2). Extends Plan 02 H.9 BLOCKER
 * Layer C from the executor layer to the graph layer: if no Contract
 * has a non-null compositeGrade (every Contract is FAILED or SKIPPED
 * or any mix), return all-null with both partial flags false. The
 * caller (markComplete) treats this as the FAILED scan signal — the
 * scan's `status === "FAILED"` drives the UI framing, not a partial
 * flag.
 */

export type ProtocolRollupContractStatus = "COMPLETE" | "FAILED" | "SKIPPED";

export interface ProtocolRollupContract {
  /**
   * Plan 05 Fase 1.2 — the Contract row id, used as the node identity for
   * reachability. The protocol grade folds over the PRIMARY's reachable
   * closure, not a flat set (see `rollupProtocolComposite`).
   */
  id: string;
  /**
   * Plan 05 Fase 1.2 — the Contract address, the key for the KNOWN_INFRA
   * exclusion hook (`isKnownInfra`). Excluded nodes don't drag the grade.
   */
  address: string;
  /** The reachability root: the protocol's headline contract. */
  isPrimary: boolean;
  compositeScore: number | null;
  compositeGrade: Grade | null;
  /** Per-Contract isPartialGrade (Plan 02 I.1 FIX 3 semantic, per-Contract). */
  isPartialGrade: boolean;
  /** Derived from the Contract's ModuleRuns by markComplete. */
  status: ProtocolRollupContractStatus;
}

export interface ProtocolRollupResult {
  compositeGrade: Grade | null;
  averageContractScore: number | null;
  worstContractScore: number | null;
  isPartialGrade: boolean;
  isPartialCoverage: boolean;
}

// F is the worst (min); A is the best (max). Lower number = worse.
const GRADE_RANK: Record<Grade, number> = { A: 5, B: 4, C: 3, D: 2, F: 1 };

function minGrade(grades: ReadonlyArray<Grade>): Grade {
  return grades.reduce((worst, g) =>
    GRADE_RANK[g] < GRADE_RANK[worst] ? g : worst,
  );
}

/**
 * §6.2 eligibility rule — a Contract contributes to the protocol composite
 * only when it has BOTH a non-null `compositeGrade` AND a non-null
 * `compositeScore` (FAILED / SKIPPED Contracts have null and are excluded).
 *
 * Exported as the single source of truth so other consumers (e.g. the Phase E
 * radar mapper) mirror the exact same rule and the two can't drift.
 */
export function isGradedContract(c: {
  compositeScore: number | null;
  compositeGrade: string | null;
}): boolean {
  return c.compositeGrade !== null && c.compositeScore !== null;
}

const EMPTY_ROLLUP: ProtocolRollupResult = {
  compositeGrade: null,
  averageContractScore: null,
  worstContractScore: null,
  isPartialGrade: false,
  isPartialCoverage: false,
};

/**
 * The synthetic star: the primary depends on every other contract. Mirrors
 * `buildStarGraph` (scan-to-radar.ts) exactly — `from = primary`, `to =
 * each sibling` — so the rollup folds over the same topology the radar
 * draws. Used when no explicit edges are supplied (Fase 1.2: there are no
 * persisted ContractEdge rows at scan-finalisation time; real edges arrive
 * in Fase 2 and would be passed in).
 */
function syntheticStarEdges(
  primaryId: string,
  contracts: ReadonlyArray<ProtocolRollupContract>,
): GraphEdge[] {
  return contracts
    .filter((c) => c.id !== primaryId)
    .map((c) => ({ from: primaryId, to: c.id }));
}

/**
 * Plan 05 Fase 1.2 — reachability-aware protocol composite.
 *
 * The grade folds over { primary } ∪ { contracts reachable from the primary
 * via depends-on edges }, with KNOWN_INFRA nodes excluded from the fold. The
 * reachable set is computed by the SHARED `reachableFrom` — the SAME
 * function `resolveContagion` uses — so the persisted grade and the radar
 * can never disagree about which nodes contaminate the primary.
 *
 * Today every scan is a pure star (the only topology; `edges` omitted ⇒
 * synthetic star), where every contract is reachable from the primary, so
 * this is BIT-IDENTICAL to the prior flat worst-wins fold. The change is
 * structural: when Fase 2 introduces real multi-hop edges, the grade
 * correctly stops contagion at branch boundaries instead of folding over a
 * flat set.
 *
 * KNOWN_INFRA (Fase 1.2 hook, empty allowlist): an infra node's OWN
 * grade/score is excluded from the worst-fold via `isKnownInfra` — the same
 * predicate `buildStarGraph` uses for the radar. With an empty allowlist
 * this excludes nothing, preserving bit-identity.
 */
export function rollupProtocolComposite(
  contracts: ReadonlyArray<ProtocolRollupContract>,
  edges?: ReadonlyArray<GraphEdge>,
): ProtocolRollupResult {
  if (contracts.length === 0) return EMPTY_ROLLUP;

  // Reachability root: the primary. Fall back to the first contract so a
  // (malformed) scan without an isPrimary flag still resolves — mirrors
  // buildStarGraph's `find(isPrimary) ?? contracts[0]`.
  const primary = contracts.find((c) => c.isPrimary) ?? contracts[0]!;

  // `undefined` ⇒ no edges supplied ⇒ synthesise the star (Fase 1.2
  // default; no persisted edges exist at finalisation). An explicitly
  // supplied array — even empty — is taken as THE edge set (an empty set
  // isolates the primary), so Fase 2 can pass real edges without the
  // synthetic star leaking back in.
  const graphEdges =
    edges !== undefined ? edges : syntheticStarEdges(primary.id, contracts);
  const reachableIds = reachableFrom(
    contracts.map((c) => c.id),
    graphEdges,
    primary.id,
  );
  const reachable = contracts.filter((c) => reachableIds.has(c.id));

  // KNOWN_INFRA exclusion — identical hook to buildStarGraph. Excluded
  // nodes contribute nothing to the protocol composite (grade, score, and
  // the partial flags) but remain in the graph so contagion can flow
  // through them. Empty allowlist in Fase 1.2 ⇒ no-op ⇒ bit-identical.
  const contributing = reachable.filter((c) => !isKnownInfra(c.address));

  const graded = contributing.filter(
    (c): c is ProtocolRollupContract & { compositeGrade: Grade; compositeScore: number } =>
      isGradedContract(c),
  );

  if (graded.length === 0) {
    // §6.2 zero-graded-Contracts guard — extends Plan 02 H.9 BLOCKER
    // Layer C to the protocol-graph layer.
    return EMPTY_ROLLUP;
  }

  const compositeGrade = minGrade(graded.map((c) => c.compositeGrade));
  // Plan 04 §2 — the protocol headline number is worst-wins: the minimum
  // composite score across eligible (reachable, non-infra) Contracts, so the
  // number can never tell a kinder story than the worst-grade-wins letter.
  const worstContractScore = Math.min(...graded.map((c) => c.compositeScore));
  // Honest secondary statistic only — the arithmetic mean across graded
  // Contracts. NOT the headline (Plan 04 §2 makes the headline worst-wins).
  const averageContractScore = Math.round(
    graded.reduce((acc, c) => acc + c.compositeScore, 0) / graded.length,
  );

  // §6.3 detector-error clause: ANY contributing contract's per-Contract
  // isPartialGrade flag.
  const isPartialGrade = contributing.some((c) => c.isPartialGrade);

  // §6.3 partial-coverage clause: ≥1 graded contributor (guaranteed here)
  // AND ≥1 FAILED contributor. SKIPPED is NOT partial coverage by design.
  const isPartialCoverage = contributing.some((c) => c.status === "FAILED");

  return {
    compositeGrade,
    averageContractScore,
    worstContractScore,
    isPartialGrade,
    isPartialCoverage,
  };
}
