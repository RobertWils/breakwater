import { Radar } from "@/components/radar/Radar"
import { buildStarGraph } from "./scan-to-radar"
import type { ContractResponse } from "@/lib/scan-response"

/**
 * Plan 04 Phase E.2 — the scan-result radar. Renders the contracts the user
 * supplied as a STAR (primary centre, related on a ring), statically (no scroll
 * phases — all nodes shown). Contagion up the star reproduces the worst-wins
 * protocol score: the primary inherits the worst related score.
 *
 * Plan 05 Fase 1.3 — the edge topology is the scan's persisted ACTIVE
 * depends-on edges (passed in via `edges`), read by buildStarGraph instead of
 * synthesised. Today those are the Scope-1 synthetic-star rows (primary →
 * each related), so the picture is unchanged; it generalises to real multi-hop
 * graphs once Fase 2 discovers edges. When a scan has no persisted edges,
 * buildStarGraph falls back to synthesising the star.
 *
 * Responsive: a desktop-sized radar (lg) and a mobile-sized one (sm); only one
 * shows per breakpoint so the square scope never overflows a narrow viewport.
 */
export function ScanRadar({
  contracts,
  edges,
}: {
  contracts: ContractResponse[]
  edges?: { from: string; to: string }[]
}) {
  const graph = buildStarGraph({ contracts, edges })
  if (graph.nodes.length === 0) return null

  return (
    <section
      aria-label="Protocol contract graph: the contracts you supplied. Each carries its own score; your primary contract inherits the worst score among them."
      className="flex flex-col items-center"
    >
      <div className="hidden w-full justify-center lg:flex">
        <Radar graph={graph} size="lg" />
      </div>
      <div className="flex w-full justify-center lg:hidden">
        <Radar graph={graph} size="sm" />
      </div>
      <p className="mt-2 text-center font-data text-xs text-sonar-muted">
        Your submitted contracts — each scored on its own. Your primary inherits the worst.
      </p>
    </section>
  )
}
