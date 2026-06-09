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
  // Desktop cockpit beats are <section>; mobile beats are <div>.
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-beat-phase]"),
  ).filter((el) => el.tagName === "SECTION")
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

  it("the full-width wrapper above the cockpit is pointer-events-none (no auto layer over the card)", () => {
    render(<SonarLanding counts={{ contracts: 1, detectorRuns: 2, scans: 3 }} />)
    const beats = desktopBeats()
    expect(beats).toHaveLength(5)
    // The shared parent wrapper of the beat sections spans full width and sits
    // above the fixed cockpit (z-10 > z-5). If it were pointer-events-auto its
    // empty area would catch clicks meant for the scan card — so it must be
    // pointer-events-none even though the sections inside already are.
    const wrapper = beats[0].parentElement
    expect(wrapper).not.toBeNull()
    expect(wrapper!.className).toContain("pointer-events-none")
    expect(wrapper!.className).toContain("z-10")
    // All beats share that one wrapper.
    beats.forEach((b) => expect(b.parentElement).toBe(wrapper))
  })

  it("the fixed cockpit reserves bottom clearance so the footer can't clip the card", () => {
    render(<SonarLanding counts={{ contracts: 1, detectorRuns: 2, scans: 3 }} />)
    // The fixed, vertically-centered cockpit must reserve bottom space (≈ footer
    // height) so the taller card (with the $1.1B+ stat) never centers down into
    // the normal-flow footer's strip at full scroll.
    const cockpit = document.querySelector(".fixed.inset-0")
    expect(cockpit).not.toBeNull()
    expect(cockpit!.className).toContain("pb-44")
  })

  it("beat text re-enables pointer events (selectable) without blocking the card", () => {
    render(<SonarLanding counts={{ contracts: 1, detectorRuns: 2, scans: 3 }} />)
    // Every beat headline lives in a pointer-events-auto wrapper.
    const textWrappers = document.querySelectorAll(".pointer-events-auto")
    expect(textWrappers.length).toBeGreaterThan(0)
  })

  it("scroll-phase sections avoid min-h-screen; the last beat is compact (60vh)", () => {
    render(<SonarLanding counts={{ contracts: 1, detectorRuns: 2, scans: 3 }} />)
    const beats = desktopBeats()
    beats.forEach((el) => expect(el.className).not.toContain("min-h-screen"))
    // Middle beats: tall + bottom-aligned. Last beat: compact + centered, so
    // its text doesn't float above a big empty band before the footer.
    beats.slice(0, -1).forEach((el) => {
      expect(el.className).toContain("min-h-[80vh]")
      expect(el.className).toContain("items-end")
    })
    const last = beats[beats.length - 1]
    expect(last.className).toContain("min-h-[60vh]")
    expect(last.className).toContain("items-center")
  })
})
