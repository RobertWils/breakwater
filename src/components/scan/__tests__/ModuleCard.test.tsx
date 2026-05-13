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
