/**
 * Plan 05 Fase 1.2 — the single source of truth for graph reachability.
 *
 * Both scorers consume THIS function so reachability is computed in exactly
 * one place (the Fase E lesson: two paths that coincide on today's data are
 * a latent bug; one path can't diverge):
 *   - `resolveContagion` (the radar) folds RadarScore over each node's
 *     reachable closure.
 *   - `rollupProtocolComposite` (the persisted scorer) folds Grade/score
 *     over the primary's reachable closure.
 *
 * Direction: an edge `from -> to` means `from` depends on `to`; contagion
 * flows UP from a dependency to its dependent. "Reachable from a node" =
 * that node plus everything it (transitively) depends on, following
 * `from -> to`. The set is INCLUSIVE of the root.
 *
 * Edges that reference an id outside `nodeIds` are ignored, so callers may
 * pass a filtered subgraph (mirrors resolveContagion's pre-refactor
 * behaviour). Cycle-safe via a visited set.
 *
 * Cyclic-graph correctness (Codex finding 1): this computes the FULL
 * reachable closure, which FIXES an order-dependent memoization bug in the
 * pre-extraction inline resolver — a node resolved while a cycle-mate was
 * still on the stack could cache an incomplete score (the in-progress
 * shortcut returned only the mate's own rank, not its closure). The fix is
 * deliberately KEPT (not reverted for "behaviour-preservation"): conserving
 * a known bug would be wrong. No production impact today (every scan is a
 * star — acyclic); it becomes load-bearing in Fase 2 when real discovered
 * edges can form cycles.
 */

export interface GraphEdge {
  from: string;
  to: string;
}

export function reachableFrom(
  nodeIds: Iterable<string>,
  edges: ReadonlyArray<GraphEdge>,
  rootId: string,
): Set<string> {
  const known = nodeIds instanceof Set ? nodeIds : new Set(nodeIds);

  // Adjacency over KNOWN nodes only: deps[from] = [to, ...].
  const deps = new Map<string, string[]>();
  for (const edge of edges) {
    if (known.has(edge.from) && known.has(edge.to)) {
      (deps.get(edge.from) ?? deps.set(edge.from, []).get(edge.from)!).push(
        edge.to,
      );
    }
  }

  // DFS from root, inclusive of root, visited-guarded for cycles.
  const reached = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const dep of deps.get(id) ?? []) {
      if (!reached.has(dep)) {
        reached.add(dep);
        stack.push(dep);
      }
    }
  }
  return reached;
}
