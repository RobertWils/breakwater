import { reachableFrom } from "@/lib/graph/reachability"

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
  // Reachability is delegated to the SHARED `reachableFrom` (Plan 05 Fase
  // 1.2) — the SAME function rollupProtocolComposite uses — so the radar and
  // the persisted scorer can never disagree about which nodes contaminate a
  // node. Each node's displayed score = the worst own-rank over its reachable
  // closure (inclusive of itself). Edge direction + the "ignore edges to
  // absent nodes" filter live in reachableFrom; this is behaviour-identical
  // to the prior inline DFS (regression-locked by contagion.test.ts).
  const ids = graph.nodes.map((n) => n.id)
  const ownRank = new Map<string, number>()
  for (const node of graph.nodes) ownRank.set(node.id, rankOf(node.score))

  const out = new Map<string, RadarScore>()
  for (const node of graph.nodes) {
    let worst = RANK.none
    // Set.forEach (not for-of) — the project's TS target predates ES2015
    // iteration; forEach avoids the downlevelIteration requirement.
    reachableFrom(ids, graph.edges, node.id).forEach((id) => {
      worst = Math.max(worst, ownRank.get(id) ?? RANK.none)
    })
    out.set(node.id, BY_RANK[worst])
  }
  return out
}
