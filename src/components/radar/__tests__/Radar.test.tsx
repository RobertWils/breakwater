import { describe, it, expect, afterEach } from "vitest"
import { render, cleanup } from "@testing-library/react"
import { Radar } from "../Radar"
import { exampleGraph, HEAL_PHASE } from "../exampleGraph"
import type { RadarGraph } from "../types"

afterEach(() => cleanup())

function blip(container: HTMLElement, id: string): HTMLElement | null {
  return container.querySelector(`[data-node-id="${id}"]`)
}

describe("Radar — resolver ↔ visual wiring (spec §1 + §2)", () => {
  it("phase 4: core inherits unsafe (red); a clean sibling branch stays green", () => {
    const { container } = render(
      <Radar graph={exampleGraph} phase={4} healPhase={HEAL_PHASE} />,
    )
    // Worst-wins reaches the primary.
    expect(blip(container, "core")!.className).toContain("is-unsafe")
    expect(blip(container, "tr")!.className).toContain("is-unsafe")
    // Sibling branches keep their own colour.
    expect(blip(container, "br")!.className).toContain("is-moderate")
    expect(blip(container, "bl")!.className).not.toMatch(/is-(moderate|unsafe)/)
    expect(blip(container, "tl")!.className).not.toMatch(/is-(moderate|unsafe)/)
  })

  it("phase reveal: leaf nodes are hidden before their minPhase", () => {
    const { container } = render(<Radar graph={exampleGraph} phase={2} />)
    expect(blip(container, "core")!.className).toContain("is-shown")
    expect(blip(container, "tr")!.className).toContain("is-shown")
    // trx2 (minPhase 4) present in DOM but not yet shown.
    expect(blip(container, "trx2")!.className).not.toContain("is-shown")
  })

  it("heal phase: externals neutralized, graph heals green, shield shows", () => {
    const { container } = render(
      <Radar graph={exampleGraph} phase={HEAL_PHASE} healPhase={HEAL_PHASE} />,
    )
    // Core back to green (no danger class).
    expect(blip(container, "core")!.className).not.toMatch(/is-(moderate|unsafe)/)
    // External dangerous leaf killed.
    expect(blip(container, "trx2")!.className).toContain("is-killed")
    // Shield ring visible.
    expect(container.querySelector(".radar-shield--show")).not.toBeNull()
  })

  it("size variant: desktop labels every node; mobile keeps only the primary's tag", () => {
    const { container: lg } = render(<Radar graph={exampleGraph} phase={4} size="lg" />)
    expect(lg.querySelector(".radar--lg")).not.toBeNull()
    // Desktop labels the non-primary heads too (e.g. TIMELOCK on `tr`).
    expect(lg.querySelector('[data-node-id="tr"] .radar-blip-label')).not.toBeNull()

    const { container: sm } = render(<Radar graph={exampleGraph} phase={4} size="sm" />)
    expect(sm.querySelector(".radar--sm")).not.toBeNull()
    // Mobile keeps the primary's tag…
    expect(sm.querySelector('[data-node-id="core"] .radar-blip-label')).not.toBeNull()
    // …but drops the non-primary labels.
    expect(sm.querySelector('[data-node-id="tr"] .radar-blip-label')).toBeNull()
  })

  it("no phase prop: renders the whole graph fully resolved (all shown, core unsafe)", () => {
    const { container } = render(<Radar graph={exampleGraph} />)
    expect(blip(container, "trx2")!.className).toContain("is-shown")
    expect(blip(container, "core")!.className).toContain("is-unsafe")
  })

  it("renders an arbitrary graph (not hardcoded to the demo nodes)", () => {
    const custom: RadarGraph = {
      nodes: [
        { id: "p", score: "safe", isPrimary: true, position: { x: 50, y: 50 } },
        { id: "dep", score: "unsafe", position: { x: 70, y: 30 } },
      ],
      edges: [{ from: "p", to: "dep" }],
    }
    const { container } = render(<Radar graph={custom} />)
    expect(blip(container, "p")!.className).toContain("is-unsafe")
    expect(blip(container, "dep")!.className).toContain("is-unsafe")
  })
})
