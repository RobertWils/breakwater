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
  isLegacyNullWorstScore,
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
    const { diffs, legacyWorstScoreSkipped } = diffRollupVsPersisted(
      computed,
      persisted,
    );
    expect(diffs).toEqual([]);
    expect(legacyWorstScoreSkipped).toBe(false);
  });

  it("flags a compositeGrade mismatch", () => {
    const { diffs } = diffRollupVsPersisted(
      { ...computed, compositeGrade: "F" },
      persisted,
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.field).toBe("compositeGrade");
    expect(diffs[0]!.computed).toBe("F");
    expect(diffs[0]!.persisted).toBe("B");
  });

  it("flags a worstContractScore mismatch when persisted is a real value (not legacy)", () => {
    const { diffs } = diffRollupVsPersisted(
      { ...computed, worstContractScore: 10 },
      persisted, // persisted.worstContractScore = 80 (non-null ⇒ not legacy)
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.field).toBe("worstContractScore");
  });

  it("flags every field when all differ", () => {
    const { diffs } = diffRollupVsPersisted(
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

describe("legacy worstContractScore exclusion (Plan 05 F1.2)", () => {
  // The legacy signature: graded scan, worstContractScore never written.
  const legacyPersisted: PersistedScanGrades = {
    compositeGrade: "A",
    worstContractScore: null, // pre-field: never written
    averageContractScore: 100,
    isPartialGrade: false,
    isPartialCoverage: false,
  };
  // What the new scorer computes for that single-A/100 scan.
  const legacyComputed: ProtocolRollupResult = {
    compositeGrade: "A",
    worstContractScore: 100, // correctly derived now
    averageContractScore: 100,
    isPartialGrade: false,
    isPartialCoverage: false,
  };

  it("isLegacyNullWorstScore detects the signature (graded + null worst) and nothing else", () => {
    expect(isLegacyNullWorstScore(legacyPersisted)).toBe(true);
    // FAILED scan (no grade) with null worst is NOT legacy — both nulls match.
    expect(
      isLegacyNullWorstScore({ ...legacyPersisted, compositeGrade: null }),
    ).toBe(false);
    // A graded scan WITH a worst value is in-regime, not legacy.
    expect(
      isLegacyNullWorstScore({ ...legacyPersisted, worstContractScore: 100 }),
    ).toBe(false);
  });

  it("excludes worstContractScore (computed 100 vs persisted null) but matches the other four", () => {
    const { diffs, legacyWorstScoreSkipped } = diffRollupVsPersisted(
      legacyComputed,
      legacyPersisted,
    );
    expect(legacyWorstScoreSkipped).toBe(true);
    expect(diffs).toEqual([]); // worst skipped; the other four are bit-identical
  });

  it("does NOT exclude the whole scan — a real divergence in another field still flags", () => {
    const { diffs, legacyWorstScoreSkipped } = diffRollupVsPersisted(
      { ...legacyComputed, compositeGrade: "F" }, // grade genuinely differs
      legacyPersisted,
    );
    expect(legacyWorstScoreSkipped).toBe(true); // worst still excluded
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.field).toBe("compositeGrade"); // but the grade diff is caught
  });
});
