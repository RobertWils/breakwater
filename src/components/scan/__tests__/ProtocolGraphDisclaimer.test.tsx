import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import { ProtocolGraphDisclaimer } from "../ProtocolGraphDisclaimer"

afterEach(() => {
  cleanup()
})

describe("ProtocolGraphDisclaimer (Plan 03 §7.4 — two-variant copy)", () => {
  it("renders with note role + aria-label for assistive tech", () => {
    render(<ProtocolGraphDisclaimer contractCount={1} />)
    const note = screen.getByRole("note")
    expect(note).toBeInTheDocument()
    expect(note).toHaveAttribute("aria-label", "Scan scope notice")
  })

  it("uses semantic <aside> so screen-readers separate it from main content", () => {
    const { container } = render(<ProtocolGraphDisclaimer contractCount={1} />)
    expect(container.querySelector("aside")).not.toBeNull()
  })

  describe("single-Contract variant (contractCount < 2)", () => {
    it("nudges the user to submit related contracts", () => {
      render(<ProtocolGraphDisclaimer contractCount={1} />)
      const note = screen.getByRole("note")
      expect(note.textContent).toMatch(/core contract address/i)
      expect(note.textContent).toMatch(/submit related contracts/i)
      expect(note.textContent).toMatch(/expand the graph/i)
    })

    it("uses single-Contract copy even with 0 contracts (defensive — should be rare)", () => {
      render(<ProtocolGraphDisclaimer contractCount={0} />)
      const note = screen.getByRole("note")
      expect(note.textContent).toMatch(/core contract address/i)
    })
  })

  describe("multi-Contract variant (contractCount >= 2)", () => {
    it("calls out the N contracts scanned + auto-discovery roadmap", () => {
      render(<ProtocolGraphDisclaimer contractCount={4} />)
      const note = screen.getByRole("note")
      expect(note.textContent).toMatch(/scanned 4 contracts/i)
      expect(note.textContent).toMatch(/automatic discovery/i)
      expect(note.textContent).toMatch(/bridges/i)
      expect(note.textContent).toMatch(/cross-chain twins/i)
    })

    it("scales the copy with contractCount (10 contracts → 'scanned 10 contracts')", () => {
      render(<ProtocolGraphDisclaimer contractCount={10} />)
      const note = screen.getByRole("note")
      expect(note.textContent).toMatch(/scanned 10 contracts/i)
    })
  })
})
