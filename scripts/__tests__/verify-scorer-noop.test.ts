// @vitest-environment node
/**
 * Plan 05 Fase 1.2 — no-op harness diff logic.
 *
 * The fleet enumeration is DB-gated (run separately against the DB). These
 * unit tests cover the pure comparison: the new reachability-scorer output
 * vs the persisted Scan grades must match on all five fields.
 */

import { describe, expect, it } from "vitest";

import type { ProtocolRollupResult } from "@/lib/scoring/protocol-rollup";

import {
  diffRollupVsPersisted,
  type PersistedScanGrades,
} from "../verify-scorer-noop.logic";

const computed: ProtocolRollupResult = {
  compositeGrade: "B",
  worstContractScore: 80,
  averageContractScore: 88,
  isPartialGrade: false,
  isPartialCoverage: true,
};
const persisted: PersistedScanGrades = {
  compositeGrade: "B",
  worstContractScore: 80,
  averageContractScore: 88,
  isPartialGrade: false,
  isPartialCoverage: true,
};

describe("diffRollupVsPersisted", () => {
  it("returns no diffs when all five fields match", () => {
    expect(diffRollupVsPersisted(computed, persisted)).toEqual([]);
  });

  it("flags a compositeGrade mismatch", () => {
    const diffs = diffRollupVsPersisted({ ...computed, compositeGrade: "F" }, persisted);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.field).toBe("compositeGrade");
    expect(diffs[0]!.computed).toBe("F");
    expect(diffs[0]!.persisted).toBe("B");
  });

  it("flags a worstContractScore mismatch (incl. null vs value)", () => {
    const diffs = diffRollupVsPersisted(
      { ...computed, worstContractScore: null },
      persisted,
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.field).toBe("worstContractScore");
  });

  it("flags every field when all differ", () => {
    const diffs = diffRollupVsPersisted(
      {
        compositeGrade: "F",
        worstContractScore: 1,
        averageContractScore: 2,
        isPartialGrade: true,
        isPartialCoverage: false,
      },
      persisted,
    );
    expect(diffs.map((d) => d.field).sort()).toEqual(
      [
        "averageContractScore",
        "compositeGrade",
        "isPartialCoverage",
        "isPartialGrade",
        "worstContractScore",
      ].sort(),
    );
  });
});
