import type { RadarGraph, RadarScore } from "./types"

/**
 * Plan 04 Phase B — the worst-wins contagion resolver (spec §2).
 *
 * This is the visual mirror of the data-layer scoring fix: a node's DISPLAYED
 * colour is the worst score among itself and everything it (transitively)
 * depends on. Contagion flows UP the dependency edges (`to` → `from`), never
 * sideways to siblings, so a clean branch keeps its own colour even when a
 * sibling branch is unsafe. The primary inherits the worst across its entire
 * reachable graph.
 *
 * Pure function over the graph → resolved score per node id. Unit-tested
 * against §2's worked examples.
 */

// Severity ranking — higher is worse. `null` (unknown) ranks below safe so it
// never worsens a dependent and an all-null closure resolves back to null.
const RANK: Record<"none" | "safe" | "moderate" | "unsafe", number> = {
  none: 0,
  safe: 1,
  moderate: 2,
  unsafe: 3,
}
const BY_RANK: Record<number, RadarScore> = {
  0: null,
  1: "safe",
  2: "moderate",
  3: "unsafe",
}

function rankOf(score: RadarScore): number {
  return score === null ? RANK.none : RANK[score]
}

export function resolveContagion(graph: RadarGraph): Map<string, RadarScore> {
  const ownRank = new Map<string, number>()
  for (const node of graph.nodes) ownRank.set(node.id, rankOf(node.score))

  // Dependencies: edge `from` depends on `to`, so worst flows to → from.
  const deps = new Map<string, string[]>()
  for (const node of graph.nodes) deps.set(node.id, [])
  for (const edge of graph.edges) {
    // Ignore edges that reference nodes not in the graph (e.g. a leaf hidden
    // at the current phase) so callers can pass a filtered subgraph.
    if (deps.has(edge.from) && ownRank.has(edge.to)) {
      deps.get(edge.from)!.push(edge.to)
    }
  }

  const resolved = new Map<string, number>()
  const inProgress = new Set<string>()

  function worstRank(id: string): number {
    const cached = resolved.get(id)
    if (cached !== undefined) return cached
    // Cycle guard: a node already on the stack contributes only its own rank
    // back up the chain; its dependencies are resolved by the outer call.
    if (inProgress.has(id)) return ownRank.get(id) ?? RANK.none

    inProgress.add(id)
    let worst = ownRank.get(id) ?? RANK.none
    for (const depId of deps.get(id) ?? []) {
      worst = Math.max(worst, worstRank(depId))
    }
    inProgress.delete(id)
    resolved.set(id, worst)
    return worst
  }

  const out = new Map<string, RadarScore>()
  for (const node of graph.nodes) out.set(node.id, BY_RANK[worstRank(node.id)])
  return out
}
