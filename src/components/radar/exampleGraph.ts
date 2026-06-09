import type { RadarGraph } from "./types"

/**
 * Plan 04 Phase B — the G1f demo graph as a DATA SET (not baked into the
 * component). Positions / scores / minPhase / external are transcribed from
 * docs/superpowers/specs/G1f-with-stats.html. Phase E replaces this with real
 * scan data shaped into the same `RadarGraph` form.
 *
 * Edges point dependent → dependency (`from` relies on `to`); contagion flows
 * the other way (§2). The four TR/BR leaves are `external` — Breakwater
 * neutralizes them at the heal phase, after which the graph resolves green.
 */
export const HEAL_PHASE = 5

export const exampleGraph: RadarGraph = {
  nodes: [
    { id: "core", label: "YOUR PROTOCOL", sublabel: "PRIMARY", score: "safe", isPrimary: true, position: { x: 50, y: 50 }, minPhase: 1 },
    { id: "tl", label: "IMPL", sublabel: "PROXY", score: "safe", position: { x: 30, y: 31 }, minPhase: 2 },
    { id: "tr", label: "TIMELOCK", sublabel: "GOV", score: "safe", position: { x: 72, y: 32 }, minPhase: 2 },
    { id: "bl", label: "GUARDIAN", sublabel: "MULTISIG", score: "safe", position: { x: 29, y: 72 }, minPhase: 2 },
    { id: "br", label: "BRIDGE", sublabel: "DECLARED", score: "safe", position: { x: 71, y: 72 }, minPhase: 3 },

    { id: "trx1", score: "moderate", small: true, external: true, position: { x: 90, y: 18 }, minPhase: 4 },
    { id: "trx2", score: "unsafe", small: true, external: true, position: { x: 92, y: 37 }, minPhase: 4 },
    { id: "brx1", score: "moderate", small: true, external: true, position: { x: 91, y: 67 }, minPhase: 4 },
    { id: "brx2", score: "safe", small: true, external: true, position: { x: 83, y: 88 }, minPhase: 4 },
    { id: "blx1", score: "safe", small: true, position: { x: 12, y: 87 }, minPhase: 4 },
    { id: "tlx1", score: "safe", small: true, position: { x: 13, y: 20 }, minPhase: 4 },
  ],
  edges: [
    { from: "core", to: "tl", minPhase: 2 },
    { from: "core", to: "tr", minPhase: 2 },
    { from: "core", to: "bl", minPhase: 2 },
    { from: "core", to: "br", minPhase: 3 },
    { from: "tr", to: "trx1", minPhase: 4 },
    { from: "tr", to: "trx2", minPhase: 4 },
    { from: "br", to: "brx1", minPhase: 4 },
    { from: "br", to: "brx2", minPhase: 4 },
    { from: "bl", to: "blx1", minPhase: 4 },
    { from: "tl", to: "tlx1", minPhase: 4 },
  ],
}

/**
 * The mobile radar (mobile-radar-story.html) is a PURPOSE-BUILT, simplified
 * graph — fewer nodes, 4 beats not 5 — per the responsive strategy (the radar
 * degrades gracefully, it is not the desktop graph shrunk). Same component +
 * same resolver; only the data + heal phase differ.
 */
export const HEAL_PHASE_MOBILE = 4

export const exampleGraphMobile: RadarGraph = {
  nodes: [
    { id: "core", label: "YOUR PROTOCOL", sublabel: "PRIMARY", score: "safe", isPrimary: true, position: { x: 50, y: 50 }, minPhase: 1 },
    { id: "tl", score: "safe", position: { x: 28, y: 29 }, minPhase: 2 },
    { id: "tr", score: "safe", position: { x: 73, y: 32 }, minPhase: 2 },
    { id: "bl", score: "safe", position: { x: 30, y: 74 }, minPhase: 2 },
    { id: "trx1", score: "moderate", small: true, external: true, position: { x: 92, y: 17 }, minPhase: 3 },
    { id: "trx2", score: "unsafe", small: true, external: true, position: { x: 95, y: 38 }, minPhase: 3 },
  ],
  edges: [
    { from: "core", to: "tl", minPhase: 2 },
    { from: "core", to: "tr", minPhase: 2 },
    { from: "core", to: "bl", minPhase: 2 },
    { from: "tr", to: "trx1", minPhase: 3 },
    { from: "tr", to: "trx2", minPhase: 3 },
  ],
}
