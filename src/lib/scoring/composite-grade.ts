import type { Grade, Severity } from "@prisma/client";

/**
 * Composite score + grade calculation per spec §5.3.
 *
 * Pure function over an array of findings (anything with `severity`):
 *   1. Start at baseScore 100.
 *   2. Subtract `SEVERITY_PENALTIES[severity]` for each finding.
 *   3. Clamp the final score to `[0, 100]`.
 *   4. Map the clamped score to a letter grade via spec thresholds.
 *   5. Apply CRITICAL floor overrides:
 *       - 3+ CRITICAL findings → grade F regardless of score.
 *       - 2+ CRITICAL findings → grade capped at D (never A/B/C).
 *         When the natural grade is already D or F, this is a no-op.
 *
 * Rationale (spec §5.3): compound CRITICAL effects can additively
 * still produce a "B" or "C" with the base scoring alone — the
 * overrides force the worst-case scenarios into the worst grades.
 *
 * Floor override semantics: spec phrases this as `grade = D` for the
 * 2+ CRITICAL case. We implement the "cap at D" reading because the
 * spec rationale ("don't average out to B") points at preventing the
 * grade from being *better* than D, not upgrading naturally-F scans
 * to D. With current penalty values 2 CRITICAL alone yields score 30
 * (natural F), so this cap is effectively dead code today — kept for
 * defensive future-proofing if penalty values are recalibrated.
 */
const SEVERITY_PENALTIES: Record<Severity, number> = {
  CRITICAL: 35,
  HIGH: 20,
  MEDIUM: 10,
  LOW: 5,
  INFO: 0,
};

const BASE_SCORE = 100;
const MIN_SCORE = 0;

/**
 * Grade thresholds (descending). First matching threshold wins.
 * Per spec §5.3: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F otherwise.
 */
const GRADE_THRESHOLDS: ReadonlyArray<{ minScore: number; grade: Grade }> = [
  { minScore: 90, grade: "A" },
  { minScore: 75, grade: "B" },
  { minScore: 60, grade: "C" },
  { minScore: 40, grade: "D" },
  { minScore: MIN_SCORE, grade: "F" },
];

export interface CompositeGradeInput {
  severity: Severity;
}

export interface FindingsCounts {
  CRITICAL: number;
  HIGH: number;
  MEDIUM: number;
  LOW: number;
  INFO: number;
}

export interface CompositeGradeResult {
  /** Score clamped to [0, 100]. */
  score: number;
  /** Letter grade after threshold mapping + floor overrides. */
  grade: Grade;
  /** baseScore - penalties, before clamping (can be negative). */
  rawScore: number;
  /** Total severity penalties subtracted. */
  penalties: number;
  /** Count of findings per severity. */
  findingsCounts: FindingsCounts;
}

export function calculateCompositeGrade(
  findings: ReadonlyArray<CompositeGradeInput>,
): CompositeGradeResult {
  const findingsCounts: FindingsCounts = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };

  let penalties = 0;
  for (const finding of findings) {
    findingsCounts[finding.severity] += 1;
    penalties += SEVERITY_PENALTIES[finding.severity];
  }

  const rawScore = BASE_SCORE - penalties;
  const score = Math.max(MIN_SCORE, Math.min(BASE_SCORE, rawScore));

  let grade: Grade = "F";
  for (const { minScore, grade: g } of GRADE_THRESHOLDS) {
    if (score >= minScore) {
      grade = g;
      break;
    }
  }

  // Floor overrides on CRITICAL count.
  if (findingsCounts.CRITICAL >= 3) {
    grade = "F";
  } else if (findingsCounts.CRITICAL >= 2) {
    // Cap at D: only downgrade if the natural grade is better than D.
    if (grade === "A" || grade === "B" || grade === "C") {
      grade = "D";
    }
    // If natural grade is already D or F, leave unchanged.
  }

  return { score, grade, rawScore, penalties, findingsCounts };
}
