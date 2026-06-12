import { resolveContagion } from "./contagion"
import type { RadarGraph, RadarNode, RadarScore } from "./types"

/**
 * Plan 04 Phase B — the sonar radar (spec §1 + §2). A reusable, data-driven
 * component: it renders ANY `RadarGraph`, resolves the worst-wins contagion
 * colours via the pure `resolveContagion`, and reveals / heals the graph by
 * the `phase` prop. The G1f demo graph is just one dataset.
 *
 * Phase contract (for Phase C scroll wiring):
 *   - `phase` undefined → show the whole graph, fully resolved, no heal.
 *   - `phase = p` → reveal nodes/edges with `minPhase <= p`; contagion is
 *     resolved over what's visible (so colours appear as dependencies reveal).
 *   - `phase >= healPhase` → Breakwater neutralizes `external` nodes (locked +
 *     killed, excluded from the resolve so the graph heals green) and the
 *     shield ring appears on the primary.
 *
 * All nodes/edges are always in the DOM; visibility is a class toggle, so
 * revealing/healing animates via CSS transitions rather than mount/unmount.
 *
 * `size` serves both layouts from one component: "lg" = desktop cockpit,
 * "sm" = mobile stacked (fewer rings, smaller blips, compact labels).
 */
const VIEWBOX = 600

interface RadarProps {
  graph: RadarGraph
  phase?: number
  healPhase?: number
  size?: "lg" | "sm"
  className?: string
}

function colourClass(score: RadarScore): string {
  if (score === "moderate") return "is-moderate"
  if (score === "unsafe") return "is-unsafe"
  return "" // safe / null → default sonar
}

function minPhaseOf(item: { minPhase?: number }): number {
  return item.minPhase ?? 1
}

export function Radar({ graph, phase, healPhase, size = "lg", className = "" }: RadarProps) {
  const activePhase = phase ?? Number.POSITIVE_INFINITY
  const healed =
    phase !== undefined && healPhase !== undefined && phase >= healPhase

  const visibleIds = new Set(
    graph.nodes.filter((node) => minPhaseOf(node) <= activePhase).map((node) => node.id),
  )

  // At the heal phase, external nodes are neutralized: excluded from the
  // resolve (so the rest heals green) and animated out.
  const neutralized = new Set(
    healed
      ? graph.nodes
          .filter((node) => node.external && visibleIds.has(node.id))
          .map((node) => node.id)
      : [],
  )

  // Resolve contagion over the currently-contributing subgraph.
  const resolverNodes = graph.nodes.filter(
    (node) => visibleIds.has(node.id) && !neutralized.has(node.id),
  )
  const resolverIds = new Set(resolverNodes.map((node) => node.id))
  const resolverEdges = graph.edges.filter(
    (edge) => resolverIds.has(edge.from) && resolverIds.has(edge.to),
  )
  const resolved = resolveContagion({ nodes: resolverNodes, edges: resolverEdges })

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const showShield =
    healed && graph.nodes.some((node) => node.isPrimary && visibleIds.has(node.id))
  // Order the neutralized nodes so they lock/kill in a staggered cadence at
  // the heal phase (mockup ~160ms apart), instead of all at once.
  const neutralizedOrder = graph.nodes
    .filter((node) => neutralized.has(node.id))
    .map((node) => node.id)

  return (
    <div className={`radar radar--${size} ${className}`.trim()} data-phase={phase ?? ""}>
      <div className="radar-scope">
        <span className="radar-ring" />
        <span className="radar-ring" />
        <span className="radar-ring" />
        <span className="radar-ring" />
        <span className="radar-cross radar-cross--h" />
        <span className="radar-cross radar-cross--v" />
        <span className="radar-sweep animate-sweep" />
        {size === "lg" && <span className="radar-sweep-line animate-sweep" />}
        <span className={`radar-shield ${showShield ? "radar-shield--show" : ""}`.trim()} />

        <svg
          className="radar-edges"
          viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {graph.edges.map((edge) => {
            const from = nodeById.get(edge.from)
            const to = nodeById.get(edge.to)
            if (!from || !to) return null
            const shown =
              minPhaseOf(edge) <= activePhase &&
              visibleIds.has(edge.from) &&
              visibleIds.has(edge.to)
            const killed = neutralized.has(edge.to)
            const colour = killed ? "" : colourClass(resolved.get(edge.to) ?? null)
            return (
              <line
                key={`${edge.from}->${edge.to}`}
                x1={(from.position.x / 100) * VIEWBOX}
                y1={(from.position.y / 100) * VIEWBOX}
                x2={(to.position.x / 100) * VIEWBOX}
                y2={(to.position.y / 100) * VIEWBOX}
                className={[
                  "radar-edge",
                  shown ? "is-shown" : "",
                  colour,
                  killed ? "is-killed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            )
          })}
        </svg>

        {graph.nodes.map((node) => (
          <Blip
            key={node.id}
            node={node}
            shown={visibleIds.has(node.id)}
            colour={neutralized.has(node.id) ? "" : colourClass(resolved.get(node.id) ?? null)}
            neutralized={neutralized.has(node.id)}
            killDelayMs={neutralized.has(node.id) ? neutralizedOrder.indexOf(node.id) * 160 : 0}
            // Desktop labels every node; mobile keeps only the primary's tag
            // (matches the mobile mockup) and drops sublabels for compactness.
            showLabel={size === "lg" || !!node.isPrimary}
            showSublabel={size === "lg"}
          />
        ))}
      </div>
    </div>
  )
}

function Blip({
  node,
  shown,
  colour,
  neutralized,
  showLabel,
  showSublabel,
  killDelayMs,
}: {
  node: RadarNode
  shown: boolean
  colour: string
  neutralized: boolean
  showLabel: boolean
  showSublabel: boolean
  killDelayMs: number
}) {
  const classes = [
    "radar-blip",
    shown ? "is-shown" : "",
    node.isPrimary ? "is-core" : "",
    node.small ? "is-small" : "",
    colour,
    neutralized ? "is-locking is-killed" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div
      className={classes}
      data-node-id={node.id}
      style={{
        left: `${node.position.x}%`,
        top: `${node.position.y}%`,
        ...(killDelayMs > 0 ? { transitionDelay: `${killDelayMs}ms` } : {}),
      }}
    >
      <span className="radar-blip-dot">
        <span className="radar-blip-pulse animate-blip" />
      </span>
      <span className="radar-blip-lock" />
      {showLabel && node.label && (
        <span className="radar-blip-label">
          <b>{node.label}</b>
          {showSublabel && node.sublabel && <span>{node.sublabel}</span>}
        </span>
      )}
    </div>
  )
}
