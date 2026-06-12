// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  rollupProtocolComposite,
  type ProtocolRollupContract,
} from "../protocol-rollup";

// Plan 05 Fase 1.2 — contracts now carry id/address/isPrimary for
// reachability + the KNOWN_INFRA hook. These helpers give each contract a
// unique id/address and leave isPrimary false; with no explicit edges the
// rollup synthesises the star (contracts[0] as the fallback primary), so
// every contract is reachable and the fold is BIT-IDENTICAL to the prior
// flat worst-wins — the regression guarantee these cases lock in.
let nextId = 0;
function freshId(): { id: string; address: string } {
  nextId += 1;
  return {
    id: `c${nextId}`,
    address: `0x${nextId.toString(16).padStart(40, "0")}`,
  };
}

function complete(
  grade: "A" | "B" | "C" | "D" | "F",
  score: number,
  isPartialGrade = false,
): ProtocolRollupContract {
  return {
    ...freshId(),
    isPrimary: false,
    compositeGrade: grade,
    compositeScore: score,
    isPartialGrade,
    status: "COMPLETE",
  };
}

function failed(): ProtocolRollupContract {
  return {
    ...freshId(),
    isPrimary: false,
    compositeGrade: null,
    compositeScore: null,
    isPartialGrade: false,
    status: "FAILED",
  };
}

function skipped(): ProtocolRollupContract {
  return {
    ...freshId(),
    isPrimary: false,
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

  // CASE C — three Contracts all grade F with distinct scores.
  // worstContractScore is the GLOBAL minimum composite score across
  // eligible Contracts (Plan 04 §2); here that is 0.
  it("C: three ELIGIBLE Contracts all F at scores [0, 15, 30] — composite F, avg 15, worst 0 (global minimum)", () => {
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

  // CASE K (Plan 04 §2) — the protocol NUMBER is the GLOBAL minimum
  // across eligible Contracts, NOT the min within the worst-grade tier.
  // Synthetic grade/score mismatch isolates the two rules: the lowest
  // score (10) sits on a non-worst-grade (D) Contract. Worst-wins must
  // report 10, not the F-tier's 50.
  it("K (Plan 04 §2): worst number = GLOBAL min across eligible, not min-within-worst-grade-tier", () => {
    const result = rollupProtocolComposite([
      complete("F", 50),
      complete("D", 10),
    ]);
    expect(result.compositeGrade).toBe("F"); // letter unchanged: worst-grade-wins
    expect(result.worstContractScore).toBe(10); // global min, NOT 50
  });

  // CASE L (Plan 04 §2) — the canonical "averaging lies" case. One F@0
  // hidden behind three A@100. The protocol number must sink to 0 (worst-
  // wins) so it agrees with the F letter; the average (75) is computed as
  // an honest secondary field but must NOT be the headline number.
  it("L (Plan 04 §2): F@0 + 3×A@100 — number 0 (worst-wins), grade F — number agrees with letter", () => {
    const result = rollupProtocolComposite([
      complete("F", 0),
      complete("A", 100),
      complete("A", 100),
      complete("A", 100),
    ]);
    expect(result.compositeGrade).toBe("F");
    expect(result.worstContractScore).toBe(0); // worst-wins, NOT the 75 mean
    expect(result.averageContractScore).toBe(75); // honest secondary, not headline
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

// ─── Plan 05 Fase 1.2 — reachability-aware reconciliation ──────────────────

type Grade = "A" | "B" | "C" | "D" | "F";
function mk(
  id: string,
  opts: {
    grade?: Grade | null;
    score?: number | null;
    isPrimary?: boolean;
    status?: ProtocolRollupContract["status"];
    isPartialGrade?: boolean;
    address?: string;
  } = {},
): ProtocolRollupContract {
  const grade = opts.grade ?? null;
  return {
    id,
    address: opts.address ?? `0x${id}`,
    isPrimary: opts.isPrimary ?? false,
    compositeGrade: grade,
    compositeScore: opts.score ?? (grade === null ? null : 50),
    isPartialGrade: opts.isPartialGrade ?? false,
    status: opts.status ?? (grade === null ? "FAILED" : "COMPLETE"),
  };
}

describe("rollupProtocolComposite — Fase 1.2 star equivalence", () => {
  it("all-safe star → A", () => {
    const r = rollupProtocolComposite([
      mk("p", { grade: "A", score: 100, isPrimary: true }),
      mk("a", { grade: "A", score: 95 }),
      mk("b", { grade: "A", score: 98 }),
    ]);
    expect(r.compositeGrade).toBe("A");
  });

  it("one-unsafe-related star → F (worst-wins up the star)", () => {
    const r = rollupProtocolComposite([
      mk("p", { grade: "A", score: 100, isPrimary: true }),
      mk("a", { grade: "A", score: 95 }),
      mk("bad", { grade: "F", score: 10 }),
    ]);
    expect(r.compositeGrade).toBe("F");
    expect(r.worstContractScore).toBe(10);
  });

  it("primary-unsafe star → F regardless of safe siblings", () => {
    const r = rollupProtocolComposite([
      mk("p", { grade: "F", score: 5, isPrimary: true }),
      mk("a", { grade: "A", score: 100 }),
    ]);
    expect(r.compositeGrade).toBe("F");
  });

  it("N=1 (primary only) → primary's own grade", () => {
    const r = rollupProtocolComposite([
      mk("p", { grade: "C", score: 60, isPrimary: true }),
    ]);
    expect(r.compositeGrade).toBe("C");
    expect(r.worstContractScore).toBe(60);
  });

  it("N=20 with a single F somewhere → F", () => {
    const contracts: ProtocolRollupContract[] = [
      mk("p", { grade: "A", score: 100, isPrimary: true }),
    ];
    for (let i = 1; i < 19; i++) contracts.push(mk(`r${i}`, { grade: "A", score: 90 }));
    contracts.push(mk("r19", { grade: "F", score: 12 }));
    expect(contracts).toHaveLength(20);
    const r = rollupProtocolComposite(contracts);
    expect(r.compositeGrade).toBe("F");
    expect(r.worstContractScore).toBe(12);
  });

  it("null/partial grades: partial flag propagates, FAILED sibling sets partial coverage", () => {
    const r = rollupProtocolComposite([
      mk("p", { grade: "A", score: 100, isPrimary: true, isPartialGrade: true }),
      mk("f", { grade: null, status: "FAILED" }),
    ]);
    expect(r.compositeGrade).toBe("A");
    expect(r.isPartialGrade).toBe(true);
    expect(r.isPartialCoverage).toBe(true);
  });

  it("KNOWN_INFRA node present with EMPTY allowlist → still counts (hook is a no-op today)", () => {
    // The infra-shaped node is unsafe; with an empty allowlist it is NOT
    // excluded, so it drags the grade to F. This pins the bit-identical
    // guarantee: the hook exists but excludes nothing until Fase 2.
    const r = rollupProtocolComposite([
      mk("p", { grade: "A", score: 100, isPrimary: true }),
      mk("permit2", {
        grade: "F",
        score: 8,
        address: "0x000000000022d473030f116ddee9f6b43ac78ba3",
      }),
    ]);
    expect(r.compositeGrade).toBe("F");
  });
});

describe("rollupProtocolComposite — Fase 1.2 reachability (explicit edges)", () => {
  it("multi-hop chain: contagion folds through primary→a→b", () => {
    const r = rollupProtocolComposite(
      [
        mk("p", { grade: "A", score: 100, isPrimary: true }),
        mk("a", { grade: "A", score: 95 }),
        mk("b", { grade: "F", score: 10 }),
      ],
      [
        { from: "p", to: "a" },
        { from: "a", to: "b" },
      ],
    );
    expect(r.compositeGrade).toBe("F"); // b is reachable via a
    expect(r.worstContractScore).toBe(10);
  });

  it("DISCONNECTED unsafe node is NOT folded — the reachability divergence a flat scorer gets wrong", () => {
    // primary depends only on `a` (both safe). `x` is unsafe but the primary
    // does NOT reach it. A flat worst-over-all would wrongly report F; the
    // reachability scorer keeps the protocol at A.
    const r = rollupProtocolComposite(
      [
        mk("p", { grade: "A", score: 100, isPrimary: true }),
        mk("a", { grade: "A", score: 95 }),
        mk("x", { grade: "F", score: 3 }),
      ],
      [{ from: "p", to: "a" }], // no path to x
    );
    expect(r.compositeGrade).toBe("A");
    expect(r.worstContractScore).toBe(95); // x's 3 excluded
    expect(r.isPartialCoverage).toBe(false);
  });

  it("a FAILED node unreachable from primary does NOT set partial coverage", () => {
    const r = rollupProtocolComposite(
      [
        mk("p", { grade: "A", score: 100, isPrimary: true }),
        mk("orphan", { grade: null, status: "FAILED" }),
      ],
      [], // explicit empty edges ⇒ primary reaches only itself
    );
    expect(r.compositeGrade).toBe("A");
    expect(r.isPartialCoverage).toBe(false); // orphan unreachable
  });
});
