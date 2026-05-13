import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { ProtocolGraphDisclaimer } from "../ProtocolGraphDisclaimer"

afterEach(() => {
  cleanup()
})

describe("ProtocolGraphDisclaimer (Plan 02 G.3 — Plan 03+ scope notice)", () => {
  it("renders with note role + aria-label for assistive tech", () => {
    render(<ProtocolGraphDisclaimer />)
    const note = screen.getByRole("note")
    expect(note).toBeInTheDocument()
    expect(note).toHaveAttribute("aria-label", "Scan scope notice")
  })

  it("mentions the core-contract scope and the Plan 03+ enhancements", () => {
    render(<ProtocolGraphDisclaimer />)
    const note = screen.getByRole("note")
    expect(note.textContent).toMatch(/core contract address/i)
    expect(note.textContent).toMatch(/bridges/i)
    expect(note.textContent).toMatch(/cross-chain/i)
  })

  it("uses semantic <aside> so screen-readers separate it from main content", () => {
    const { container } = render(<ProtocolGraphDisclaimer />)
    expect(container.querySelector("aside")).not.toBeNull()
  })
})
