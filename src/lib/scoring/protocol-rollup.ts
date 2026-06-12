import type { Grade } from "@prisma/client";

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

export function rollupProtocolComposite(
  contracts: ReadonlyArray<ProtocolRollupContract>,
): ProtocolRollupResult {
  const graded = contracts.filter(
    (c): c is ProtocolRollupContract & { compositeGrade: Grade; compositeScore: number } =>
      isGradedContract(c),
  );

  if (graded.length === 0) {
    // §6.2 zero-graded-Contracts guard — extends Plan 02 H.9 BLOCKER
    // Layer C to the protocol-graph layer.
    return {
      compositeGrade: null,
      averageContractScore: null,
      worstContractScore: null,
      isPartialGrade: false,
      isPartialCoverage: false,
    };
  }

  const compositeGrade = minGrade(graded.map((c) => c.compositeGrade));
  // Plan 04 §2 — the protocol headline number is worst-wins: the GLOBAL
  // minimum composite score across eligible Contracts, so the number can
  // never tell a kinder story than the worst-grade-wins letter. (Plan 03
  // scoped this to the worst-grade tier; Plan 04 widens it to the global
  // minimum. The two coincide whenever grade is monotonic with score, but
  // the global min is the honest worst-wins value and survives any future
  // penalty recalibration that breaks monotonicity.)
  const worstContractScore = Math.min(...graded.map((c) => c.compositeScore));
  // Honest secondary statistic only — the arithmetic mean across graded
  // Contracts. NOT the headline (Plan 04 §2 makes the headline worst-wins).
  const averageContractScore = Math.round(
    graded.reduce((acc, c) => acc + c.compositeScore, 0) / graded.length,
  );

  // §6.3 detector-error clause: ANY contract's per-Contract
  // isPartialGrade flag. SKIPPED/FAILED contracts default to false
  // for this flag in the caller, so they don't trigger spuriously.
  const isPartialGrade = contracts.some((c) => c.isPartialGrade);

  // §6.3 partial-coverage clause: at least one graded contributor
  // (guaranteed here because graded.length > 0) AND at least one
  // FAILED sibling. SKIPPED is NOT partial coverage by design.
  const isPartialCoverage = contracts.some((c) => c.status === "FAILED");

  return {
    compositeGrade,
    averageContractScore,
    worstContractScore,
    isPartialGrade,
    isPartialCoverage,
  };
}
