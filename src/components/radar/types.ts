/**
 * Plan 04 Phase B — sonar radar data model (spec §1 + §2).
 *
 * The radar is data-driven: it renders ANY dependency graph from this shape.
 * The G1f demo graph is just one dataset (see `exampleGraph.ts`), never baked
 * into the component.
 */

/** A node's OWN score. `null` = unknown / not-yet-scored. */
export type RadarScore = "safe" | "moderate" | "unsafe" | null

export interface RadarNode {
  id: string
  /** ATC-style primary label, e.g. "TIMELOCK". Optional (leaf blips omit it). */
  label?: string
  /** ATC-style secondary label / role tag, e.g. "GOV". */
  sublabel?: string
  /** Semantic role (optional, informational). */
  role?: string
  /** The node's OWN score, before contagion is resolved along edges. */
  score: RadarScore
  /** Position within the scope, in percent (0-100) of width/height. */
  position: { x: number; y: number }
  /** The core / protocol node (larger blip, shield target at the heal phase). */
  isPrimary?: boolean
  /** Neutralized by Breakwater at the heal phase (animated out + excluded). */
  external?: boolean
  /** First story phase at which this node is revealed (default 1). */
  minPhase?: number
  /** Render as a small leaf blip. */
  small?: boolean
}

export interface RadarEdge {
  /** The dependent node. */
  from: string
  /** The dependency node. Contagion flows UP the edge: `to` → `from` (§2). */
  to: string
  /** First story phase at which this edge is revealed (default 1). */
  minPhase?: number
}

export interface RadarGraph {
  nodes: RadarNode[]
  edges: RadarEdge[]
}
