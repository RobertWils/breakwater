import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { CompositePanel } from "../CompositePanel"
import type { ScanResponse } from "@/lib/scan-response"

function makeScan(overrides: Partial<ScanResponse> = {}): ScanResponse {
  return {
    id: "scan-1",
    status: "QUEUED",
    compositeScore: null,
    compositeGrade: null,
    isPartialGrade: false,
    createdAt: "2026-04-22T10:00:00.000Z",
    completedAt: null,
    expiresAt: "2026-05-22T10:00:00.000Z",
    protocol: {
      slug: "test",
      displayName: "Test Protocol",
      chain: "ETHEREUM",
      domain: null,
      ownershipStatus: "UNCLAIMED",
    },
    modules: [],
    findings: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe("CompositePanel", () => {
  it("renders QUEUED status copy when no grade", () => {
    render(<CompositePanel scan={makeScan({ status: "QUEUED" })} />)
    expect(screen.getByText("Queued")).toBeInTheDocument()
    expect(
      screen.getByText("Your scan is in queue. Detection begins when our modules go live."),
    ).toBeInTheDocument()
  })

  it("renders RUNNING status copy", () => {
    render(<CompositePanel scan={makeScan({ status: "RUNNING" })} />)
    expect(screen.getByText("Running")).toBeInTheDocument()
  })

  it("renders COMPLETE status copy", () => {
    render(<CompositePanel scan={makeScan({ status: "COMPLETE" })} />)
    expect(screen.getByText("Complete")).toBeInTheDocument()
  })

  it("renders EXPIRED status copy", () => {
    render(<CompositePanel scan={makeScan({ status: "EXPIRED" })} />)
    expect(screen.getByText("Expired")).toBeInTheDocument()
  })

  it("renders grade when compositeGrade present, suppressing status copy", () => {
    render(
      <CompositePanel
        scan={makeScan({ status: "COMPLETE", compositeGrade: "A", compositeScore: 92 })}
      />,
    )
    expect(screen.getByText("A")).toBeInTheDocument()
    expect(screen.getByText("Score: 92/100")).toBeInTheDocument()
    expect(screen.queryByText("Complete")).not.toBeInTheDocument()
  })

  it("shows partial grade marker when isPartialGrade is true", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "B",
          compositeScore: 80,
          isPartialGrade: true,
        })}
      />,
    )
    expect(screen.getByText("Partial grade — some modules skipped")).toBeInTheDocument()
  })

  it("falls back to QUEUED copy for unknown status", () => {
    render(<CompositePanel scan={makeScan({ status: "UNKNOWN" as never })} />)
    expect(screen.getByText("Queued")).toBeInTheDocument()
  })
})
