import { Radar } from "@/components/radar/Radar"
import { buildStarGraph } from "./scan-to-radar"
import type { ContractResponse } from "@/lib/scan-response"

/**
 * Plan 04 Phase E.2 — the scan-result radar. Renders the contracts the user
 * supplied as a STAR (primary centre, related on a ring), statically (no scroll
 * phases — all nodes shown). Contagion up the star reproduces the worst-wins
 * protocol score: the primary inherits the worst related score.
 *
 * Honest about scope: it shows ONLY the submitted contracts and the primary
 * depending on them — no multi-hop dependency analysis (edges don't exist in
 * the data; the ProtocolGraphDisclaimer below says discovery is on the
 * roadmap, and this visualization must not contradict it).
 *
 * Responsive: a desktop-sized radar (lg) and a mobile-sized one (sm); only one
 * shows per breakpoint so the square scope never overflows a narrow viewport.
 */
export function ScanRadar({ contracts }: { contracts: ContractResponse[] }) {
  const graph = buildStarGraph({ contracts })
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
