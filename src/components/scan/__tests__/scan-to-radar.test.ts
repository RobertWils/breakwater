// @vitest-environment node
import { describe, it, expect } from "vitest"
import type { Grade } from "@prisma/client"

import { buildStarGraph, gradeToRadarScore } from "../scan-to-radar"
import { resolveContagion } from "@/components/radar/contagion"
import {
  rollupProtocolComposite,
  type ProtocolRollupContract,
} from "@/lib/scoring/protocol-rollup"
import type { ContractResponse } from "@/lib/scan-response"

// Plausible score per grade band (only the letter matters for the equivalence;
// rollup needs a non-null score to count a contract as graded).
const SCORE_FOR: Record<Grade, number> = { A: 95, B: 80, C: 65, D: 45, F: 10 }

function contract(
  id: string,
  grade: Grade | null,
  opts: {
    isPrimary?: boolean
    role?: ContractResponse["role"]
    /** Override the score (e.g. null while grade is set — the eligibility-mismatch case). */
    score?: number | null
  } = {},
): ContractResponse {
  return {
    id,
    address: "0x" + id.padEnd(40, "0").slice(0, 40),
    role: opts.role ?? (opts.isPrimary ? "PRIMARY" : "RELATED"),
    label: null,
    isPrimary: !!opts.isPrimary,
    compositeScore: opts.score !== undefined ? opts.score : grade ? SCORE_FOR[grade] : null,
    compositeGrade: grade,
    isPartialGrade: false,
    crossChainTwins: [],
    modules: [],
    findingsCount: 0,
    proxyImplementationWarning: null,
  }
}

function toRollup(c: ContractResponse): ProtocolRollupContract {
  return {
    id: c.id,
    address: c.address,
    isPrimary: c.isPrimary,
    compositeScore: c.compositeScore,
    compositeGrade: c.compositeGrade as Grade | null,
    isPartialGrade: c.isPartialGrade,
    status: c.compositeGrade ? "COMPLETE" : "FAILED",
  }
}

/** The core E.1 honesty check: star-contagion on the primary ≡ worst-wins. */
function assertStarEqualsWorstWins(contracts: ContractResponse[]) {
  const primary = contracts.find((c) => c.isPrimary) ?? contracts[0]
  const rollup = rollupProtocolComposite(contracts.map(toRollup))
  const expected = gradeToRadarScore(rollup.compositeGrade)

  const resolved = resolveContagion(buildStarGraph({ contracts }))
  expect(resolved.get(primary.id)).toBe(expected)
  return { expected, resolved }
}

describe("gradeToRadarScore — explicit boundaries (A/B/C/D/F, no E)", () => {
  it("A, B → safe", () => {
    expect(gradeToRadarScore("A")).toBe("safe")
    expect(gradeToRadarScore("B")).toBe("safe")
  })
  it("C, D → moderate", () => {
    expect(gradeToRadarScore("C")).toBe("moderate")
    expect(gradeToRadarScore("D")).toBe("moderate")
  })
  it("F → unsafe", () => {
    expect(gradeToRadarScore("F")).toBe("unsafe")
  })
  it("null / unknown → null", () => {
    expect(gradeToRadarScore(null)).toBeNull()
    expect(gradeToRadarScore(undefined)).toBeNull()
    expect(gradeToRadarScore("E")).toBeNull() // not a real grade
  })
})

describe("buildStarGraph — shape", () => {
  it("primary at centre, N related on a ring → N edges, N+1 nodes", () => {
    const contracts = [
      contract("p", "A", { isPrimary: true }),
      contract("r1", "B"),
      contract("r2", "C"),
      contract("r3", "F"),
    ]
    const g = buildStarGraph({ contracts })

    expect(g.nodes).toHaveLength(4)
    expect(g.edges).toHaveLength(3)

    const p = g.nodes.find((n) => n.id === "p")!
    expect(p.isPrimary).toBe(true)
    expect(p.position).toEqual({ x: 50, y: 50 })

    // Every edge is primary → a related node (from leans on to).
    expect(g.edges.every((e) => e.from === "p")).toBe(true)
    expect(g.edges.map((e) => e.to).sort()).toEqual(["r1", "r2", "r3"])

    // Related nodes sit on the ring (≈ equal distance from centre) and are small.
    for (const id of ["r1", "r2", "r3"]) {
      const n = g.nodes.find((x) => x.id === id)!
      expect(n.small).toBe(true)
      expect(n.isPrimary).toBeFalsy()
      const d = Math.hypot(n.position.x - 50, n.position.y - 50)
      expect(d).toBeCloseTo(32, 5)
    }
  })

  it("N=1 (single contract) → just the primary, no edges", () => {
    const g = buildStarGraph({ contracts: [contract("p", "A", { isPrimary: true })] })
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
  })

  it("uses the first contract as primary if none is flagged isPrimary", () => {
    const g = buildStarGraph({ contracts: [contract("a", "A"), contract("b", "B")] })
    expect(g.nodes.find((n) => n.id === "a")!.isPrimary).toBe(true)
    expect(g.edges).toEqual([{ from: "a", to: "b" }])
  })
})

describe("star-contagion ≡ worst-wins (the equivalence check)", () => {
  it("all safe → safe", () => {
    const { expected } = assertStarEqualsWorstWins([
      contract("p", "A", { isPrimary: true }),
      contract("r1", "A"),
      contract("r2", "B"),
    ])
    expect(expected).toBe("safe")
  })

  it("one unsafe related → primary unsafe; the safe sibling keeps its own colour", () => {
    const contracts = [
      contract("p", "A", { isPrimary: true }),
      contract("safe", "A"),
      contract("bad", "F"),
    ]
    const { expected, resolved } = assertStarEqualsWorstWins(contracts)
    expect(expected).toBe("unsafe")
    // Sibling branches keep their own colour (no related↔related edges in a star).
    expect(resolved.get("safe")).toBe("safe")
    expect(resolved.get("bad")).toBe("unsafe")
  })

  it("one moderate related → moderate", () => {
    const { expected } = assertStarEqualsWorstWins([
      contract("p", "A", { isPrimary: true }),
      contract("r", "C"),
    ])
    expect(expected).toBe("moderate")
  })

  it("primary itself unsafe → unsafe", () => {
    const { expected } = assertStarEqualsWorstWins([
      contract("p", "F", { isPrimary: true }),
      contract("r", "A"),
    ])
    expect(expected).toBe("unsafe")
  })

  it("N=1 single contract → its own score", () => {
    const { expected } = assertStarEqualsWorstWins([contract("p", "B", { isPrimary: true })])
    expect(expected).toBe("safe")
  })

  it("N=20 related, one unsafe → unsafe (and 20 edges)", () => {
    const related = Array.from({ length: 20 }, (_, i) =>
      contract(`r${i}`, i === 7 ? "F" : "A"),
    )
    const contracts = [contract("p", "A", { isPrimary: true }), ...related]
    const { expected } = assertStarEqualsWorstWins(contracts)
    expect(expected).toBe("unsafe")
    expect(buildStarGraph({ contracts }).edges).toHaveLength(20)
  })

  it("FAILED related (null grade) is ignored — does not worsen the primary", () => {
    const { expected } = assertStarEqualsWorstWins([
      contract("p", "A", { isPrimary: true }),
      contract("failed", null),
      contract("r", "B"),
    ])
    expect(expected).toBe("safe")
  })

  it("everything FAILED → null on both sides", () => {
    const { expected } = assertStarEqualsWorstWins([
      contract("p", null, { isPrimary: true }),
      contract("r", null),
    ])
    expect(expected).toBeNull()
  })

  // ── Codex HIGH finding: eligibility-set mismatch (grade set, score null) ──
  it("Codex counterexample: primary A/95 + related F/score-null → safe (NOT unsafe)", () => {
    const contracts = [
      contract("p", "A", { isPrimary: true }), // A / 95
      contract("bad", "F", { score: null }), // grade F but score null → excluded by rollup
    ]
    const { expected, resolved } = assertStarEqualsWorstWins(contracts)
    // Rollup ignores the score-null contract → worst-wins is A → safe.
    expect(expected).toBe("safe")
    // The radar must agree: the excluded contract is neutral (null), not unsafe.
    expect(resolved.get("p")).toBe("safe")
    expect(resolved.get("bad")).toBeNull()
  })

  it("mirror: primary F/score-null + related A/95 → safe (primary excluded by rollup)", () => {
    const contracts = [
      contract("p", "F", { isPrimary: true, score: null }), // grade F but score null → excluded
      contract("r", "A"), // A / 95
    ]
    const { expected, resolved } = assertStarEqualsWorstWins(contracts)
    expect(expected).toBe("safe")
    expect(resolved.get("p")).toBe("safe")
  })

  it("mixed null-score: A/95 + F/score-null (excluded) + C/65 → moderate", () => {
    const { expected } = assertStarEqualsWorstWins([
      contract("p", "A", { isPrimary: true }),
      contract("x", "F", { score: null }), // excluded
      contract("c", "C"), // C / 65
    ])
    expect(expected).toBe("moderate")
  })

  it("grade-null but score-present is also excluded (both must be non-null)", () => {
    const { expected, resolved } = assertStarEqualsWorstWins([
      contract("p", "A", { isPrimary: true }),
      contract("weird", null, { score: 10 }), // grade null but score set → excluded
    ])
    expect(expected).toBe("safe")
    expect(resolved.get("weird")).toBeNull()
  })
})
