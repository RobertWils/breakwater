import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { CompositePanel } from "../CompositePanel"
import type { ContractResponse, ScanResponse } from "@/lib/scan-response"

function makeContract(
  overrides: Partial<ContractResponse> = {},
): ContractResponse {
  return {
    id: "c-1",
    address: "0x" + "1".repeat(40),
    role: "PRIMARY",
    label: null,
    isPrimary: true,
    compositeScore: 80,
    compositeGrade: "B",
    isPartialGrade: false,
    crossChainTwins: [],
    modules: [],
    findingsCount: 0,
    proxyImplementationWarning: null,
    ...overrides,
  }
}

function makeScan(overrides: Partial<ScanResponse> = {}): ScanResponse {
  return {
    id: "scan-1",
    status: "QUEUED",
    averageContractScore: null,
    worstContractScore: null,
    isPartialCoverage: false,
    contracts: [],
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
    findings: [],
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe("CompositePanel — pre-grade status copy", () => {
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

  it("renders COMPLETE status copy when no grade (defensive — should be rare in practice)", () => {
    render(<CompositePanel scan={makeScan({ status: "COMPLETE" })} />)
    expect(screen.getByText("Complete")).toBeInTheDocument()
  })

  it("renders EXPIRED status copy", () => {
    render(<CompositePanel scan={makeScan({ status: "EXPIRED" })} />)
    expect(screen.getByText("Expired")).toBeInTheDocument()
  })

  it("falls back to QUEUED copy for unknown status", () => {
    render(<CompositePanel scan={makeScan({ status: "UNKNOWN" as never })} />)
    expect(screen.getByText("Queued")).toBeInTheDocument()
  })
})

describe("CompositePanel — Plan 03 §7.4 protocol grade display", () => {
  it("renders the grade letter + 'Protocol grade' label when compositeGrade present", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "A",
          averageContractScore: 92,
          worstContractScore: 92,
          contracts: [makeContract({ compositeGrade: "A", compositeScore: 92 })],
        })}
      />,
    )
    expect(screen.getByText("Protocol grade")).toBeInTheDocument()
    expect(screen.getByText("A")).toBeInTheDocument()
    // Status copy must be suppressed once a grade exists.
    expect(screen.queryByText("Complete")).not.toBeInTheDocument()
  })

  it("renders Worst contract score + Average contract score lines per spec §7.4", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "F",
          averageContractScore: 50,
          worstContractScore: 0,
          contracts: [
            makeContract({ id: "c1", compositeGrade: "A", compositeScore: 100 }),
            makeContract({ id: "c2", compositeGrade: "F", compositeScore: 0 }),
          ],
        })}
      />,
    )
    expect(screen.getByText("Worst contract score")).toBeInTheDocument()
    expect(screen.getByText("0/100")).toBeInTheDocument()
    expect(screen.getByText("Average contract score")).toBeInTheDocument()
    // "50/100 across 2 contracts" is split across span elements; the
    // average value lives in one node, the across-N-contracts in another.
    expect(screen.getByText("50/100", { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/across 2 contracts/i)).toBeInTheDocument()
  })

  it("singular 'contract' when contracts.length === 1", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "B",
          averageContractScore: 80,
          worstContractScore: 80,
          contracts: [makeContract({ compositeGrade: "B", compositeScore: 80 })],
        })}
      />,
    )
    expect(screen.getByText(/across 1 contract$/i)).toBeInTheDocument()
  })

  it("omits the worst-contract-score line when worstContractScore is null", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "B",
          averageContractScore: 80,
          worstContractScore: null,
        })}
      />,
    )
    expect(screen.queryByText("Worst contract score")).toBeNull()
  })

  it("omits the average-contract-score line when averageContractScore is null", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "B",
          averageContractScore: null,
          worstContractScore: 80,
        })}
      />,
    )
    expect(screen.queryByText("Average contract score")).toBeNull()
  })
})

describe("CompositePanel — §6.3 two-clause partial flag", () => {
  it("isPartialGrade only → 'Partial grade — detector errors'", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "B",
          averageContractScore: 80,
          worstContractScore: 80,
          isPartialGrade: true,
        })}
      />,
    )
    expect(screen.getByText(/Partial grade — detector errors/)).toBeInTheDocument()
  })

  it("isPartialCoverage only → 'Partial coverage — some contracts failed'", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "A",
          averageContractScore: 100,
          worstContractScore: 100,
          isPartialCoverage: true,
        })}
      />,
    )
    expect(
      screen.getByText(/Partial coverage — some contracts failed/),
    ).toBeInTheDocument()
  })

  it("both flags → 'Partial — coverage gap + detector errors'", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "C",
          averageContractScore: 65,
          worstContractScore: 60,
          isPartialGrade: true,
          isPartialCoverage: true,
        })}
      />,
    )
    expect(
      screen.getByText(/Partial — coverage gap \+ detector errors/),
    ).toBeInTheDocument()
  })

  it("no flag → no partial line", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "A",
          averageContractScore: 100,
          worstContractScore: 100,
        })}
      />,
    )
    expect(screen.queryByText(/Partial/i)).toBeNull()
  })
})

describe("CompositePanel — currentStatus override (Plan 02 G.3 carry-over)", () => {
  it("uses currentStatus for status copy when scan.status is stale", () => {
    render(
      <CompositePanel
        scan={makeScan({ status: "QUEUED" })}
        currentStatus="RUNNING"
      />,
    )
    expect(screen.getByText("Running")).toBeInTheDocument()
    expect(screen.queryByText("Queued")).not.toBeInTheDocument()
  })

  it("falls back to scan.status when currentStatus is undefined", () => {
    render(<CompositePanel scan={makeScan({ status: "RUNNING" })} />)
    expect(screen.getByText("Running")).toBeInTheDocument()
  })

  it("does not override grade rendering — compositeGrade still wins", () => {
    render(
      <CompositePanel
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "A",
          averageContractScore: 92,
          worstContractScore: 92,
        })}
        currentStatus="RUNNING"
      />,
    )
    expect(screen.getByText("A")).toBeInTheDocument()
    expect(screen.queryByText("Running")).not.toBeInTheDocument()
  })
})
