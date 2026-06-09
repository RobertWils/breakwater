import { describe, it, expect, beforeAll, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { SonarLanding } from "../SonarLanding"

// ScanForm (rendered inside SonarLanding) calls useRouter.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// jsdom has no IntersectionObserver; SonarLanding registers one in useEffect.
beforeAll(() => {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  // @ts-expect-error – minimal test stub
  global.IntersectionObserver = IO
})

afterEach(() => cleanup())

function desktopBeats(): HTMLElement[] {
  // Desktop cockpit beats use items-end; mobile beats use items-center.
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-beat-phase]"),
  ).filter((el) => el.className.includes("items-end"))
}

describe("SonarLanding — scan-card reachability (regression: overlay must not block input)", () => {
  it("scroll-phase sections are pointer-events-none so the fixed scan card underneath stays clickable", () => {
    render(<SonarLanding counts={{ contracts: 1, detectorRuns: 2, scans: 3 }} />)

    const beats = desktopBeats()
    expect(beats).toHaveLength(5)
    // The overlay sections must let pointer events through to the card.
    beats.forEach((el) => expect(el.className).toContain("pointer-events-none"))

    // The scan form (the element that was being covered) renders + is present
    // for interaction — both layout instances (d- / m- prefixes) carry it.
    expect(screen.getAllByLabelText("Protocol address").length).toBeGreaterThan(0)
  })

  it("beat text re-enables pointer events (selectable) without blocking the card", () => {
    render(<SonarLanding counts={{ contracts: 1, detectorRuns: 2, scans: 3 }} />)
    // Every beat headline lives in a pointer-events-auto wrapper.
    const textWrappers = document.querySelectorAll(".pointer-events-auto")
    expect(textWrappers.length).toBeGreaterThan(0)
  })

  it("scroll-phase sections use min-h-[80vh] (no empty screen above each phase)", () => {
    render(<SonarLanding counts={{ contracts: 1, detectorRuns: 2, scans: 3 }} />)
    desktopBeats().forEach((el) => {
      expect(el.className).toContain("min-h-[80vh]")
      expect(el.className).not.toContain("min-h-screen")
    })
  })
})
