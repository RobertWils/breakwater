// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  rollupProtocolComposite,
  type ProtocolRollupContract,
} from "../protocol-rollup";

function complete(
  grade: "A" | "B" | "C" | "D" | "F",
  score: number,
  isPartialGrade = false,
): ProtocolRollupContract {
  return {
    compositeGrade: grade,
    compositeScore: score,
    isPartialGrade,
    status: "COMPLETE",
  };
}

function failed(): ProtocolRollupContract {
  return {
    compositeGrade: null,
    compositeScore: null,
    isPartialGrade: false,
    status: "FAILED",
  };
}

function skipped(): ProtocolRollupContract {
  return {
    compositeGrade: null,
    compositeScore: null,
    isPartialGrade: false,
    status: "SKIPPED",
  };
}

describe("rollupProtocolComposite (Plan 03 §6.2 + §6.3)", () => {
  // CASE A — single Contract grade A.
  it("A: single ELIGIBLE Contract grade A — composite A, avg = worst = that score, no partials", () => {
    const result = rollupProtocolComposite([complete("A", 100)]);
    expect(result.compositeGrade).toBe("A");
    expect(result.averageContractScore).toBe(100);
    expect(result.worstContractScore).toBe(100);
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(false);
  });

  // CASE B — two Contracts, A + F. Worst-grade-wins, average is the
  // mean, worst is the F-grader's score.
  it("B: two ELIGIBLE Contracts A + F — composite F, avg = mean, worst = F score", () => {
    const result = rollupProtocolComposite([
      complete("A", 95),
      complete("F", 25),
    ]);
    expect(result.compositeGrade).toBe("F");
    expect(result.averageContractScore).toBe(60); // (95+25)/2
    expect(result.worstContractScore).toBe(25);
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(false);
  });

  // CASE C — three Contracts all grade F with distinct scores. Tie-
  // break: worstContractScore is the LOWEST score within the worst-
  // grade tier (spec §6.2).
  it("C: three ELIGIBLE Contracts all F at scores [0, 15, 30] — composite F, avg 15, worst 0 (tie-break: lowest of worst-grade group)", () => {
    const result = rollupProtocolComposite([
      complete("F", 0),
      complete("F", 15),
      complete("F", 30),
    ]);
    expect(result.compositeGrade).toBe("F");
    expect(result.averageContractScore).toBe(15);
    expect(result.worstContractScore).toBe(0);
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(false);
  });

  // CASE D — two Contracts both grade C. Average rounds to nearest
  // integer.
  it("D: two ELIGIBLE Contracts both C at [60, 65] — composite C, avg 63 (rounded), worst 60", () => {
    const result = rollupProtocolComposite([
      complete("C", 60),
      complete("C", 65),
    ]);
    expect(result.compositeGrade).toBe("C");
    expect(result.averageContractScore).toBe(63); // 62.5 → 63
    expect(result.worstContractScore).toBe(60);
  });

  // CASE E — one A + one FAILED. Graded contributors exist + a
  // FAILED sibling → isPartialCoverage TRUE. The A contract's grade
  // still rolls up.
  it("E: one ELIGIBLE (A) + one FAILED — composite A, isPartialCoverage TRUE", () => {
    const result = rollupProtocolComposite([complete("A", 100), failed()]);
    expect(result.compositeGrade).toBe("A");
    expect(result.averageContractScore).toBe(100);
    expect(result.worstContractScore).toBe(100);
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(true);
  });

  // CASE F — one A + one SKIPPED. SKIPPED is NOT partial coverage.
  it("F: one ELIGIBLE (A) + one SKIPPED — composite A, isPartialCoverage FALSE (SKIPPED is role-applicability, not coverage gap)", () => {
    const result = rollupProtocolComposite([complete("A", 100), skipped()]);
    expect(result.compositeGrade).toBe("A");
    expect(result.averageContractScore).toBe(100);
    expect(result.worstContractScore).toBe(100);
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(false);
  });

  // CASE G — all FAILED. Zero-graded-Contracts guard fires.
  it("G: all FAILED — composite null, both score fields null, both partial flags false (§6.2 zero-graded-Contracts guard)", () => {
    const result = rollupProtocolComposite([failed(), failed(), failed()]);
    expect(result.compositeGrade).toBeNull();
    expect(result.averageContractScore).toBeNull();
    expect(result.worstContractScore).toBeNull();
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(false);
  });

  // CASE H — all SKIPPED. Zero-graded-Contracts guard fires (same
  // null shape as all-FAILED; the caller's status drives the UI).
  it("H: all SKIPPED — composite null, both score fields null, both partial flags false", () => {
    const result = rollupProtocolComposite([skipped(), skipped()]);
    expect(result.compositeGrade).toBeNull();
    expect(result.averageContractScore).toBeNull();
    expect(result.worstContractScore).toBeNull();
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(false);
  });

  // CASE I — A (with detector errors) + B (clean). isPartialGrade
  // fires because detector errors degraded the A's grade; no FAILED
  // siblings → isPartialCoverage stays false.
  it("I: A with isPartialGrade + B clean — composite B, isPartialGrade TRUE (detector errors), isPartialCoverage FALSE (no FAILED siblings)", () => {
    const result = rollupProtocolComposite([
      complete("A", 95, /* isPartialGrade */ true),
      complete("B", 80, false),
    ]);
    expect(result.compositeGrade).toBe("B"); // worst-grade-wins
    expect(result.averageContractScore).toBe(88); // (95+80)/2 = 87.5 → 88
    expect(result.worstContractScore).toBe(80);
    expect(result.isPartialGrade).toBe(true);
    expect(result.isPartialCoverage).toBe(false);
  });

  // CASE J — A (clean) + FAILED contract. The detector-error clause
  // does not fire (no Contract has isPartialGrade); the partial-
  // coverage clause does fire (graded + FAILED).
  it("J: A clean + FAILED contract — isPartialGrade FALSE, isPartialCoverage TRUE", () => {
    const result = rollupProtocolComposite([
      complete("A", 100, false),
      failed(),
    ]);
    expect(result.compositeGrade).toBe("A");
    expect(result.averageContractScore).toBe(100);
    expect(result.worstContractScore).toBe(100);
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(true);
  });

  // Backward-compat sanity: a single COMPLETE Contract with no errors
  // must produce the exact same Scan.compositeGrade Plan 02 would have
  // (single contract's grade), averageContractScore equal to that
  // single score, worstContractScore the same.
  it("backward-compat N=1: single-Contract scan collapses to Plan 02 semantics (averageContractScore === Plan 02 compositeScore)", () => {
    const result = rollupProtocolComposite([complete("B", 80, false)]);
    expect(result.compositeGrade).toBe("B");
    expect(result.averageContractScore).toBe(80);
    expect(result.worstContractScore).toBe(80);
    expect(result.isPartialGrade).toBe(false);
    expect(result.isPartialCoverage).toBe(false);
  });
});
