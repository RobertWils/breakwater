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

export function diffRollupVsPersisted(
  computed: ProtocolRollupResult,
  persisted: PersistedScanGrades,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const check = (
    field: keyof PersistedScanGrades,
    c: unknown,
    p: unknown,
  ): void => {
    if (c !== p) diffs.push({ field, computed: c, persisted: p });
  };

  check("compositeGrade", computed.compositeGrade, persisted.compositeGrade);
  check("worstContractScore", computed.worstContractScore, persisted.worstContractScore);
  check(
    "averageContractScore",
    computed.averageContractScore,
    persisted.averageContractScore,
  );
  check("isPartialGrade", computed.isPartialGrade, persisted.isPartialGrade);
  check("isPartialCoverage", computed.isPartialCoverage, persisted.isPartialCoverage);

  return diffs;
}
