import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { ProtocolGraphDisclaimer } from "../ProtocolGraphDisclaimer"
import type { ContractResponse } from "@/lib/scan-response"

afterEach(() => {
  cleanup()
})

type C = Pick<ContractResponse, "discoverySource">
const supplied: C = { discoverySource: "MANUAL" }
const discovered: C = { discoverySource: "AUTO" }
const legacy: C = {} // no discoverySource → treated as supplied

describe("ProtocolGraphDisclaimer (Plan 05 Fase 1.6 — supplied vs discovered)", () => {
  it("renders with note role + aria-label + semantic <aside>", () => {
    const { container } = render(<ProtocolGraphDisclaimer contracts={[supplied]} />)
    const note = screen.getByRole("note")
    expect(note).toHaveAttribute("aria-label", "Scan scope notice")
    expect(container.querySelector("aside")).not.toBeNull()
  })

  it("NEVER claims discovery is on the roadmap (the old, now-false copy)", () => {
    render(<ProtocolGraphDisclaimer contracts={[supplied, discovered]} />)
    expect(screen.getByRole("note").textContent).not.toMatch(/roadmap/i)
  })

  it("distinguishes supplied from auto-discovered, data-driven", () => {
    render(<ProtocolGraphDisclaimer contracts={[supplied, discovered]} />)
    const text = screen.getByRole("note").textContent ?? ""
    expect(text).toMatch(/1 contract you supplied/i)
    expect(text).toMatch(/plus 1 automatically discovered dependency/i)
  })

  it("pluralises supplied + discovered counts", () => {
    render(
      <ProtocolGraphDisclaimer
        contracts={[supplied, supplied, discovered, discovered]}
      />,
    )
    const text = screen.getByRole("note").textContent ?? ""
    expect(text).toMatch(/2 contracts you supplied/i)
    expect(text).toMatch(/plus 2 automatically discovered dependencies/i)
  })

  it("treats a contract with no discoverySource as supplied (legacy/back-compat)", () => {
    render(<ProtocolGraphDisclaimer contracts={[legacy, legacy]} />)
    const text = screen.getByRole("note").textContent ?? ""
    expect(text).toMatch(/2 contracts you supplied/i)
    expect(text).not.toMatch(/automatically discovered/i)
  })

  it("describes what discovery does this phase + the multi-hop boundary", () => {
    render(<ProtocolGraphDisclaimer contracts={[supplied, discovered]} />)
    const text = screen.getByRole("note").textContent ?? ""
    expect(text).toMatch(/proxy implementations/i)
    expect(text).toMatch(/one level deep/i)
    expect(text).toMatch(/transitive \(multi-hop\).*not yet included/i)
  })

  it("when nothing was discovered, says so + nudges manual submission", () => {
    render(<ProtocolGraphDisclaimer contracts={[supplied]} />)
    const text = screen.getByRole("note").textContent ?? ""
    expect(text).toMatch(/added no further contracts/i)
    expect(text).toMatch(/submit related contracts manually/i)
  })

  it("surfaces a degraded discovery so it never implies full coverage", () => {
    render(
      <ProtocolGraphDisclaimer contracts={[supplied, discovered]} discoveryDegraded />,
    )
    expect(screen.getByRole("note").textContent).toMatch(/did not complete/i)
  })

  it("omits the degraded notice when discovery was clean", () => {
    render(<ProtocolGraphDisclaimer contracts={[supplied, discovered]} />)
    expect(screen.getByRole("note").textContent).not.toMatch(/did not complete/i)
  })
})
