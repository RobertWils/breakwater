// @vitest-environment node
import { describe, expect, it } from "vitest";

import { calculateCompositeGrade } from "../composite-grade";

describe("calculateCompositeGrade (Plan 02 F.2 — spec §5.3)", () => {
  describe("Empty findings (clean baseline)", () => {
    it("returns score 100, grade A on empty findings array", () => {
      const result = calculateCompositeGrade([]);

      expect(result.score).toBe(100);
      expect(result.grade).toBe("A");
      expect(result.rawScore).toBe(100);
      expect(result.penalties).toBe(0);
      expect(result.findingsCounts).toEqual({
        CRITICAL: 0,
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        INFO: 0,
      });
    });
  });

  describe("Single severity penalties (spec §5.3 mapping)", () => {
    it("CRITICAL: -35 → score 65 → grade C (60 ≤ 65 < 75)", () => {
      const result = calculateCompositeGrade([{ severity: "CRITICAL" }]);
      expect(result.score).toBe(65);
      expect(result.grade).toBe("C");
      expect(result.penalties).toBe(35);
    });

    it("HIGH: -20 → score 80 → grade B (75 ≤ 80 < 90)", () => {
      const result = calculateCompositeGrade([{ severity: "HIGH" }]);
      expect(result.score).toBe(80);
      expect(result.grade).toBe("B");
    });

    it("MEDIUM: -10 → score 90 → grade A (boundary, 90 ≥ 90)", () => {
      const result = calculateCompositeGrade([{ severity: "MEDIUM" }]);
      expect(result.score).toBe(90);
      expect(result.grade).toBe("A");
    });

    it("LOW: -5 → score 95 → grade A", () => {
      const result = calculateCompositeGrade([{ severity: "LOW" }]);
      expect(result.score).toBe(95);
      expect(result.grade).toBe("A");
    });

    it("INFO: 0 → score 100 → grade A (zero penalty)", () => {
      const result = calculateCompositeGrade([{ severity: "INFO" }]);
      expect(result.score).toBe(100);
      expect(result.grade).toBe("A");
    });
  });

  describe("Accumulating penalties", () => {
    it("3 MEDIUM = -30 → score 70 → grade C", () => {
      const result = calculateCompositeGrade([
        { severity: "MEDIUM" },
        { severity: "MEDIUM" },
        { severity: "MEDIUM" },
      ]);
      expect(result.score).toBe(70);
      expect(result.grade).toBe("C");
      expect(result.penalties).toBe(30);
    });

    it("1 HIGH + 2 MEDIUM = -40 → score 60 → grade C (60 boundary, 60 ≥ 60)", () => {
      const result = calculateCompositeGrade([
        { severity: "HIGH" },
        { severity: "MEDIUM" },
        { severity: "MEDIUM" },
      ]);
      expect(result.score).toBe(60);
      expect(result.grade).toBe("C");
    });

    it("5 LOW = -25 → score 75 → grade B (75 boundary, 75 ≥ 75)", () => {
      const result = calculateCompositeGrade(
        Array(5).fill({ severity: "LOW" as const }),
      );
      expect(result.score).toBe(75);
      expect(result.grade).toBe("B");
    });
  });

  describe("Floor override: 3+ CRITICAL → F", () => {
    it("3 CRITICAL = -105 → clamped to 0, grade F (override matches natural)", () => {
      const result = calculateCompositeGrade(
        Array(3).fill({ severity: "CRITICAL" as const }),
      );
      expect(result.score).toBe(0);
      expect(result.rawScore).toBe(-5);
      expect(result.grade).toBe("F");
      expect(result.findingsCounts.CRITICAL).toBe(3);
    });

    it("4 CRITICAL → grade F", () => {
      const result = calculateCompositeGrade(
        Array(4).fill({ severity: "CRITICAL" as const }),
      );
      expect(result.grade).toBe("F");
      expect(result.findingsCounts.CRITICAL).toBe(4);
    });
  });

  describe("Floor override: 2 CRITICAL → cap at D", () => {
    it("2 CRITICAL alone (-70 → score 30 → natural F) stays F (cap doesn't upgrade)", () => {
      // Natural F is worse than D. Cap-at-D only downgrades naturally
      // A/B/C; it does not upgrade naturally-F scans to D.
      const result = calculateCompositeGrade(
        Array(2).fill({ severity: "CRITICAL" as const }),
      );
      expect(result.score).toBe(30);
      expect(result.grade).toBe("F");
      expect(result.findingsCounts.CRITICAL).toBe(2);
    });

    it("2 CRITICAL + many INFO (no extra penalty) still F (natural F unchanged)", () => {
      const findings = [
        { severity: "CRITICAL" as const },
        { severity: "CRITICAL" as const },
        ...Array(10).fill({ severity: "INFO" as const }),
      ];
      const result = calculateCompositeGrade(findings);
      expect(result.score).toBe(30);
      expect(result.grade).toBe("F");
    });

    // Note: the cap-at-D downgrade branch (natural A/B/C → D) is
    // unreachable with current penalty values — 2 CRITICAL = 70 penalty
    // always yields natural F. The branch is defensive future-proofing
    // for penalty recalibration; documented in the implementation
    // alongside the floor override logic.
  });

  describe("Score clamping", () => {
    it("clamps score to 0 (never negative) on many CRITICALs", () => {
      const result = calculateCompositeGrade(
        Array(10).fill({ severity: "CRITICAL" as const }),
      );
      expect(result.score).toBe(0);
      expect(result.rawScore).toBe(-250);
      expect(result.grade).toBe("F");
    });

    it("clamps score to 100 ceiling on empty findings", () => {
      const result = calculateCompositeGrade([]);
      expect(result.score).toBe(100);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("Spec §5.3 grade boundaries (90/75/60/40)", () => {
    it("score 90 → A (A threshold, inclusive)", () => {
      // 2 LOW = 10 penalty → 90
      const result = calculateCompositeGrade([
        { severity: "LOW" },
        { severity: "LOW" },
      ]);
      expect(result.score).toBe(90);
      expect(result.grade).toBe("A");
    });

    it("score 75 → B (B threshold, inclusive)", () => {
      // 5 LOW = 25 penalty → 75
      const result = calculateCompositeGrade(
        Array(5).fill({ severity: "LOW" as const }),
      );
      expect(result.score).toBe(75);
      expect(result.grade).toBe("B");
    });

    it("score 60 → C (C threshold, inclusive)", () => {
      // 1 HIGH + 2 MEDIUM = 40 penalty → 60
      const result = calculateCompositeGrade([
        { severity: "HIGH" },
        { severity: "MEDIUM" },
        { severity: "MEDIUM" },
      ]);
      expect(result.score).toBe(60);
      expect(result.grade).toBe("C");
    });

    it("score 40 → D (D threshold, inclusive)", () => {
      // 3 HIGH = 60 penalty → 40
      const result = calculateCompositeGrade(
        Array(3).fill({ severity: "HIGH" as const }),
      );
      expect(result.score).toBe(40);
      expect(result.grade).toBe("D");
    });

    it("score 39 → F (just below D threshold)", () => {
      // 1 CRITICAL + 1 HIGH + 1 MEDIUM + 1 LOW + 1 LOW = 35+20+10+5+5 = 75 → 25
      // Actually, want exactly 39; that needs 61 penalty which is awkward.
      // Use 3 HIGH + 1 LOW = 65 penalty → 35 → F (below 40).
      const result = calculateCompositeGrade([
        { severity: "HIGH" },
        { severity: "HIGH" },
        { severity: "HIGH" },
        { severity: "LOW" },
      ]);
      expect(result.score).toBe(35);
      expect(result.grade).toBe("F");
    });

    it("score 50 → D (well above F threshold, 40 ≤ 50 < 60)", () => {
      // 2 HIGH + 2 LOW = 50 penalty → 50
      const result = calculateCompositeGrade([
        { severity: "HIGH" },
        { severity: "HIGH" },
        { severity: "LOW" },
        { severity: "LOW" },
      ]);
      expect(result.score).toBe(50);
      expect(result.grade).toBe("D");
    });
  });

  describe("Realistic scenarios", () => {
    it("Plan 02 worst-case: 6 CRITICAL findings → grade F", () => {
      const result = calculateCompositeGrade(
        Array(6).fill({ severity: "CRITICAL" as const }),
      );
      expect(result.score).toBe(0);
      expect(result.grade).toBe("F");
    });

    it("Typical mid-tier: 1 HIGH + 1 MEDIUM + 2 INFO = -30 → score 70 → grade C", () => {
      const result = calculateCompositeGrade([
        { severity: "HIGH" },
        { severity: "MEDIUM" },
        { severity: "INFO" },
        { severity: "INFO" },
      ]);
      expect(result.score).toBe(70);
      expect(result.grade).toBe("C");
    });

    it("Clean Uniswap V3-like (empty findings) → grade A", () => {
      const result = calculateCompositeGrade([]);
      expect(result.grade).toBe("A");
    });
  });

  describe("Output structure", () => {
    it("returns every expected field with correct types", () => {
      const result = calculateCompositeGrade([
        { severity: "CRITICAL" },
        { severity: "HIGH" },
        { severity: "MEDIUM" },
      ]);

      expect(result).toHaveProperty("score");
      expect(result).toHaveProperty("grade");
      expect(result).toHaveProperty("rawScore");
      expect(result).toHaveProperty("penalties");
      expect(result).toHaveProperty("findingsCounts");

      expect(typeof result.score).toBe("number");
      expect(typeof result.rawScore).toBe("number");
      expect(typeof result.penalties).toBe("number");
      expect(["A", "B", "C", "D", "F"]).toContain(result.grade);
    });

    it("findingsCounts sums to total findings", () => {
      const findings = [
        { severity: "CRITICAL" as const },
        { severity: "CRITICAL" as const },
        { severity: "HIGH" as const },
        { severity: "MEDIUM" as const },
        { severity: "LOW" as const },
        { severity: "INFO" as const },
      ];

      const result = calculateCompositeGrade(findings);
      const total = Object.values(result.findingsCounts).reduce(
        (a, b) => a + b,
        0,
      );
      expect(total).toBe(findings.length);
    });

    it("findingsCounts per-severity counts are exact", () => {
      const findings = [
        { severity: "CRITICAL" as const },
        { severity: "CRITICAL" as const },
        { severity: "HIGH" as const },
        { severity: "INFO" as const },
        { severity: "INFO" as const },
        { severity: "INFO" as const },
      ];

      const result = calculateCompositeGrade(findings);
      expect(result.findingsCounts).toEqual({
        CRITICAL: 2,
        HIGH: 1,
        MEDIUM: 0,
        LOW: 0,
        INFO: 3,
      });
    });
  });
});
