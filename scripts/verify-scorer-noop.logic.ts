/**
 * Plan 05 Fase 1.2 — pure diff logic for the no-op verification harness.
 *
 * Compares the new reachability-aware rollup's output against the grades
 * already persisted on a Scan. Over today's pure-star data the two MUST be
 * bit-identical on all five fields — a non-empty diff means a reconciliation
 * bug (or unexpected non-star data, which the recon ruled out).
 */

import type { Grade } from "@prisma/client";

import type { ProtocolRollupResult } from "@/lib/scoring/protocol-rollup";

export interface PersistedScanGrades {
  compositeGrade: Grade | null;
  worstContractScore: number | null;
  averageContractScore: number | null;
  isPartialGrade: boolean;
  isPartialCoverage: boolean;
}

export interface FieldDiff {
  field: keyof PersistedScanGrades;
  computed: unknown;
  persisted: unknown;
}

export interface DiffResult {
  diffs: FieldDiff[];
  /**
   * True when this row's `worstContractScore` was NOT compared because it
   * carries the legacy signature (graded, but the field was never written).
   * Surfaced so the harness can report HOW MANY rows got a legacy field
   * exclusion — an honest "we skipped a never-written field on N rows", not
   * a silent swallow of N mismatches.
   */
  legacyWorstScoreSkipped: boolean;
}

/**
 * Legacy signature: a scan that DID get a grade (`compositeGrade` non-null)
 * but whose `worstContractScore` is null. That field was added 2026-05-22
 * (migration plan_03_add_contract_model_additive, nullable + no backfill)
 * and first written by markComplete in Plan 03 Phase F.2 (~2026-05-29). A
 * graded scan finalised BEFORE that has the column absent, not an old-scorer
 * output of null — so it is not comparable. The §5.4 bit-identical guarantee
 * covers scans the RECONCILED scorer (Plan 03 F+) actually produced, not
 * pre-field legacy data.
 *
 * (markComplete always writes `worstContractScore` non-null for a graded
 * scan today, so a graded+null row cannot be a current-code output — it is
 * necessarily pre-field legacy.)
 */
export function isLegacyNullWorstScore(persisted: PersistedScanGrades): boolean {
  return persisted.compositeGrade !== null && persisted.worstContractScore === null;
}

export function diffRollupVsPersisted(
  computed: ProtocolRollupResult,
  persisted: PersistedScanGrades,
): DiffResult {
  const legacyWorstScoreSkipped = isLegacyNullWorstScore(persisted);

  const diffs: FieldDiff[] = [];
  const check = (
    field: keyof PersistedScanGrades,
    c: unknown,
    p: unknown,
  ): void => {
    if (c !== p) diffs.push({ field, computed: c, persisted: p });
  };

  check("compositeGrade", computed.compositeGrade, persisted.compositeGrade);
  // Skip ONLY the never-written field on legacy rows; the other four must
  // still be bit-identical (we do not exclude the whole scan).
  if (!legacyWorstScoreSkipped) {
    check("worstContractScore", computed.worstContractScore, persisted.worstContractScore);
  }
  check(
    "averageContractScore",
    computed.averageContractScore,
    persisted.averageContractScore,
  );
  check("isPartialGrade", computed.isPartialGrade, persisted.isPartialGrade);
  check("isPartialCoverage", computed.isPartialCoverage, persisted.isPartialCoverage);

  return { diffs, legacyWorstScoreSkipped };
}
