import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ModuleCard } from "../ModuleCard"
import type { ModuleRunResponse } from "@/lib/scan-response"

function makeModule(overrides: Partial<ModuleRunResponse> = {}): ModuleRunResponse {
  return {
    id: "mr-1",
    module: "GOVERNANCE",
    status: "QUEUED",
    grade: null,
    score: null,
    findingsCount: null,
    startedAt: null,
    completedAt: null,
    attemptCount: 0,
    errorMessage: null,
    errorStack: null,
    detectorVersions: {},
    rpcCallsUsed: 0,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe("ModuleCard", () => {
  it("renders QUEUED state with 'Awaiting detection' copy", () => {
    render(<ModuleCard module={makeModule({ status: "QUEUED" })} />)
    expect(screen.getByText("Governance")).toBeInTheDocument()
    expect(screen.getByText("Queued")).toBeInTheDocument()
    expect(screen.getByText("Awaiting detection")).toBeInTheDocument()
  })

  it("renders RUNNING state", () => {
    render(<ModuleCard module={makeModule({ status: "RUNNING" })} />)
    expect(screen.getByText("Running")).toBeInTheDocument()
    expect(screen.getByText("Awaiting detection")).toBeInTheDocument()
  })

  it("renders COMPLETE with grade + score + findingsCount", () => {
    render(
      <ModuleCard
        module={makeModule({ status: "COMPLETE", grade: "A", score: 95, findingsCount: 2 })}
      />,
    )
    expect(screen.getByText("Complete")).toBeInTheDocument()
    expect(screen.getByText("A")).toBeInTheDocument()
    expect(screen.getByText("95/100")).toBeInTheDocument()
    expect(screen.getByText("2 findings")).toBeInTheDocument()
  })

  it("singularizes '1 finding' when findingsCount is 1", () => {
    render(
      <ModuleCard
        module={makeModule({ status: "COMPLETE", grade: "B", score: 80, findingsCount: 1 })}
      />,
    )
    expect(screen.getByText("1 finding")).toBeInTheDocument()
  })

  it("renders '0 findings' on a clean COMPLETE scan (I.2 follow-up — was hidden pre-fix)", () => {
    // Before the I.2 follow-up, ModuleCard gated rendering on `> 0`
    // and hid the line entirely when findingsCount was 0. Clean scans
    // (Uniswap V3 etc.) showed only the grade letter + score; the
    // I.1 FIX 2 persistence work was invisible without a DB query.
    // The render now distinguishes "persisted 0" from "still null".
    render(
      <ModuleCard
        module={makeModule({
          status: "COMPLETE",
          grade: "A",
          score: 100,
          findingsCount: 0,
        })}
      />,
    )
    expect(screen.getByText("A")).toBeInTheDocument()
    expect(screen.getByText("100/100")).toBeInTheDocument()
    // English plural — "0 findings", not "0 finding".
    expect(screen.getByText("0 findings")).toBeInTheDocument()
  })

  it("does NOT render findingsCount line when findingsCount is null (loading state)", () => {
    // The null-guard hides the line during QUEUED/RUNNING before the
    // persist transaction writes the count. The outer `hasGrade`
    // ternary normally also hides the whole block during pre-terminal
    // states, but locking in the null-guard separately protects against
    // a future shape change that delivers grade before findingsCount.
    render(
      <ModuleCard
        module={makeModule({
          status: "COMPLETE",
          grade: "B",
          score: 80,
          findingsCount: null,
        })}
      />,
    )
    expect(screen.getByText("B")).toBeInTheDocument()
    expect(screen.getByText("80/100")).toBeInTheDocument()
    // No findings-count line in the DOM at all.
    expect(screen.queryByText(/finding/i)).toBeNull()
  })

  it("renders FAILED with errorMessage alert", () => {
    render(
      <ModuleCard
        module={makeModule({ status: "FAILED", errorMessage: "RPC timeout after 3 retries" })}
      />,
    )
    expect(screen.getByText("Failed")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("RPC timeout after 3 retries")
  })

  it("renders SKIPPED with 'Not included' copy", () => {
    render(<ModuleCard module={makeModule({ status: "SKIPPED", module: "FRONTEND" })} />)
    expect(screen.getByText("Skipped")).toBeInTheDocument()
    expect(screen.getByText("Not included in this scan")).toBeInTheDocument()
  })

  it("does NOT render errorMessage on SKIPPED — audit-only field (H.7)", () => {
    // H.6 introduced `module_not_implemented` / `module_disabled_by_user` /
    // `domain_required` on SKIPPED rows for the audit trail. H.7 hides
    // these from the UI — they're internal strings, not user copy. The
    // FAILED branch keeps its alert (covered by the test above).
    render(
      <ModuleCard
        module={makeModule({
          status: "SKIPPED",
          module: "ORACLE",
          errorMessage: "module_not_implemented",
        })}
      />,
    )
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText(/module_not_implemented/)).toBeNull()
  })

  it("falls back to raw module name when not in MODULE_LABELS map", () => {
    render(<ModuleCard module={makeModule({ module: "UNKNOWN" })} />)
    expect(screen.getByText("UNKNOWN")).toBeInTheDocument()
  })

  describe("RUNNING pulse indicator (G.3 / spec §7.3)", () => {
    it("renders an aria-live pulse when status is RUNNING", () => {
      render(<ModuleCard module={makeModule({ status: "RUNNING" })} />)
      const pulse = screen.getByRole("status")
      expect(pulse).toHaveAttribute("aria-live", "polite")
      expect(pulse.getAttribute("aria-label") ?? "").toMatch(/running/i)
    })

    it("pulse honors prefers-reduced-motion via motion-reduce:animate-none", () => {
      render(<ModuleCard module={makeModule({ status: "RUNNING" })} />)
      const pulse = screen.getByRole("status")
      expect(pulse.className).toContain("animate-pulse")
      expect(pulse.className).toContain("motion-reduce:animate-none")
    })

    it("does not render a pulse for non-RUNNING statuses", () => {
      for (const status of ["QUEUED", "COMPLETE", "FAILED", "SKIPPED"] as const) {
        const { container, unmount } = render(
          <ModuleCard module={makeModule({ status })} />,
        )
        expect(
          container.querySelector('[role="status"]'),
          `expected no pulse for status=${status}`,
        ).toBeNull()
        unmount()
      }
    })
  })
})
