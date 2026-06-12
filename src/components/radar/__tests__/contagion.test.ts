// @vitest-environment node
import { describe, it, expect } from "vitest"

import { resolveContagion } from "../contagion"
import type { RadarGraph, RadarNode, RadarScore } from "../types"

// Compact node builder — position is irrelevant to the resolver.
function n(id: string, score: RadarScore, extra: Partial<RadarNode> = {}): RadarNode {
  return { id, score, position: { x: 50, y: 50 }, ...extra }
}

function resolve(graph: RadarGraph): Record<string, RadarScore> {
  return Object.fromEntries(resolveContagion(graph))
}

describe("resolveContagion — worst-wins up the graph (spec §2)", () => {
  it("§2: a RED dependency makes its dependent red", () => {
    // A depends on B; B unsafe, A's own code safe → A inherits unsafe.
    const r = resolve({
      nodes: [n("A", "safe"), n("B", "unsafe")],
      edges: [{ from: "A", to: "B" }],
    })
    expect(r.A).toBe("unsafe")
    expect(r.B).toBe("unsafe")
  })

  it("§2: an AMBER dependency makes its dependent at-least-amber", () => {
    const r = resolve({
      nodes: [n("A", "safe"), n("B", "moderate")],
      edges: [{ from: "A", to: "B" }],
    })
    expect(r.A).toBe("moderate")
  })

  it("§2: a purely-green dependency chain stays green", () => {
    // A → B → C, all safe.
    const r = resolve({
      nodes: [n("A", "safe"), n("B", "safe"), n("C", "safe")],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
      ],
    })
    expect(r).toEqual({ A: "safe", B: "safe", C: "safe" })
  })

  it("§2: contagion flows UP, not sideways — sibling branches keep their own score", () => {
    // A depends on B (unsafe) AND C (safe). B's badness must NOT leak to the
    // sibling C; only the shared dependent A inherits it.
    const r = resolve({
      nodes: [n("A", "safe"), n("B", "unsafe"), n("C", "safe")],
      edges: [
        { from: "A", to: "B" },
        { from: "A", to: "C" },
      ],
    })
    expect(r.A).toBe("unsafe") // inherits worst of its deps
    expect(r.B).toBe("unsafe")
    expect(r.C).toBe("safe") // sibling unaffected
  })

  it("§2: worst of MULTIPLE deps wins (amber + red → red)", () => {
    const r = resolve({
      nodes: [n("T", "safe"), n("x1", "moderate"), n("x2", "unsafe")],
      edges: [
        { from: "T", to: "x1" },
        { from: "T", to: "x2" },
      ],
    })
    expect(r.T).toBe("unsafe")
  })

  it("§2: amber + green deps → dependent amber", () => {
    const r = resolve({
      nodes: [n("B", "safe"), n("x1", "moderate"), n("x2", "safe")],
      edges: [
        { from: "B", to: "x1" },
        { from: "B", to: "x2" },
      ],
    })
    expect(r.B).toBe("moderate")
  })

  it("§2: PRIMARY inherits the worst across the entire reachable graph (transitive)", () => {
    // core → tr → trx2(unsafe), multi-hop. core's own code is clean.
    const r = resolve({
      nodes: [n("core", "safe", { isPrimary: true }), n("tr", "safe"), n("trx2", "unsafe")],
      edges: [
        { from: "core", to: "tr" },
        { from: "tr", to: "trx2" },
      ],
    })
    expect(r.core).toBe("unsafe")
    expect(r.tr).toBe("unsafe")
  })

  it("a node's OWN worse score dominates a clean dependency", () => {
    const r = resolve({
      nodes: [n("A", "unsafe"), n("B", "safe")],
      edges: [{ from: "A", to: "B" }],
    })
    expect(r.A).toBe("unsafe")
  })

  it("null own score with no deps resolves to null; with a safe dep resolves safe", () => {
    const r = resolve({
      nodes: [n("lonely", null), n("A", null), n("B", "safe")],
      edges: [{ from: "A", to: "B" }],
    })
    expect(r.lonely).toBeNull()
    expect(r.A).toBe("safe")
  })

  it("is cycle-safe (defensive) — mutual dependency does not loop", () => {
    const r = resolve({
      nodes: [n("A", "safe"), n("B", "unsafe")],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
      ],
    })
    expect(r.A).toBe("unsafe")
    expect(r.B).toBe("unsafe")
  })
})

describe("resolveContagion — the G1f example graph (spec §1 phase 4 / §2)", () => {
  // The full demo graph at the contagion phase (all leaves present).
  const fullGraph: RadarGraph = {
    nodes: [
      n("core", "safe", { isPrimary: true }),
      n("tl", "safe"),
      n("tr", "safe"),
      n("bl", "safe"),
      n("br", "safe"),
      n("trx1", "moderate", { external: true }),
      n("trx2", "unsafe", { external: true }),
      n("brx1", "moderate", { external: true }),
      n("brx2", "safe", { external: true }),
      n("blx1", "safe"),
      n("tlx1", "safe"),
    ],
    edges: [
      { from: "core", to: "tl" },
      { from: "core", to: "tr" },
      { from: "core", to: "bl" },
      { from: "core", to: "br" },
      { from: "tr", to: "trx1" },
      { from: "tr", to: "trx2" },
      { from: "br", to: "brx1" },
      { from: "br", to: "brx2" },
      { from: "bl", to: "blx1" },
      { from: "tl", to: "tlx1" },
    ],
  }

  it("phase 4: TR=unsafe, BR=moderate, BL/TL=safe, CORE=unsafe (matches the demo)", () => {
    const r = resolve(fullGraph)
    expect(r.tr).toBe("unsafe") // amber + red leaves
    expect(r.br).toBe("moderate") // amber + green leaves
    expect(r.bl).toBe("safe")
    expect(r.tl).toBe("safe")
    expect(r.core).toBe("unsafe") // inherits the worst across the graph
  })

  it("heal phase: with externals removed, the whole graph resolves back to safe", () => {
    const healed: RadarGraph = {
      nodes: fullGraph.nodes.filter((node) => !node.external),
      edges: fullGraph.edges.filter(
        (e) => !["trx1", "trx2", "brx1", "brx2"].includes(e.to),
      ),
    }
    const r = resolve(healed)
    expect(r.core).toBe("safe")
    expect(r.tr).toBe("safe")
    expect(r.br).toBe("safe")
  })
})

// Plan 05 Fase 1.2 — cyclic-graph correctness (Codex finding 1).
//
// The pre-extraction inline resolver had an ORDER-DEPENDENT memoization bug:
// a node resolved while a cycle-mate was still on the stack cached an
// incomplete score (the in-progress shortcut returned only the mate's OWN
// rank, not its closure). Delegating to the shared `reachableFrom` (which
// builds the full reachable closure) FIXES this. These cases lock the
// correct behaviour; the prior 12 tests passed only because none used a
// cycle where a worse node was reachable THROUGH the cycle.
//
// No production impact today: every scan is a star (acyclic). This matters
// in Fase 2 when real discovered edges can form cycles.
describe("resolveContagion — cyclic graphs (Plan 05 Fase 1.2)", () => {
  it("B↔C, both safe → both safe", () => {
    const r = resolve({
      nodes: [n("B", "safe"), n("C", "safe")],
      edges: [
        { from: "B", to: "C" },
        { from: "C", to: "B" },
      ],
    })
    expect(r).toEqual({ B: "safe", C: "safe" })
  })

  it("B↔C with C unsafe → both unsafe (each reaches the other)", () => {
    const r = resolve({
      nodes: [n("B", "safe"), n("C", "unsafe")],
      edges: [
        { from: "B", to: "C" },
        { from: "C", to: "B" },
      ],
    })
    expect(r).toEqual({ B: "unsafe", C: "unsafe" })
  })

  it("longer cycle A→B→C→A with one unsafe node → all unsafe", () => {
    const r = resolve({
      nodes: [n("A", "safe"), n("B", "safe"), n("C", "unsafe")],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "C" },
        { from: "C", to: "A" },
      ],
    })
    expect(r).toEqual({ A: "unsafe", B: "unsafe", C: "unsafe" })
  })

  it("cycle + disconnected branch: the cycle stays safe, the disconnected unsafe node does not leak in", () => {
    const r = resolve({
      nodes: [n("A", "safe"), n("B", "safe"), n("D", "unsafe")],
      edges: [
        { from: "A", to: "B" },
        { from: "B", to: "A" },
        // D has no edges — unreachable from the A↔B cycle.
      ],
    })
    expect(r.A).toBe("safe")
    expect(r.B).toBe("safe")
    expect(r.D).toBe("unsafe")
  })

  it("the order-dependent bug case: B↔C cycle + B→D(unsafe) — C is unsafe via C→B→D regardless of node order", () => {
    const edges = [
      { from: "B", to: "C" },
      { from: "C", to: "B" },
      { from: "B", to: "D" },
    ]
    // Node order [B, C, D] is the order the old memoized resolver cached C
    // with B's incomplete in-progress value (→ C: safe, WRONG).
    const r1 = resolve({
      nodes: [n("B", "safe"), n("C", "safe"), n("D", "unsafe")],
      edges,
    })
    expect(r1).toEqual({ B: "unsafe", C: "unsafe", D: "unsafe" })

    // The reverse order must give the same correct result.
    const r2 = resolve({
      nodes: [n("D", "unsafe"), n("C", "safe"), n("B", "safe")],
      edges,
    })
    expect(r2).toEqual({ B: "unsafe", C: "unsafe", D: "unsafe" })
  })
})
