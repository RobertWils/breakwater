import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"

import type { ContractResponse, ScanResponse } from "@/lib/scan-response"

// Mock useScanPolling — ScanShell's job is to thread the polled result
// into its children. The polling behavior itself is covered in
// src/hooks/__tests__/useScanPolling.test.ts.
type PolledContractState = {
  id: string
  address: string
  label: string | null
  role: string
  isPrimary: boolean
  modules: { module: string; status: string; grade: string | null }[]
}

const { useScanPollingMock } = vi.hoisted(() => ({
  useScanPollingMock: vi.fn<
    () => {
      currentStatus: string
      errorCount: number
      polledContracts: PolledContractState[] | null
    }
  >(() => ({ currentStatus: "QUEUED", errorCount: 0, polledContracts: null })),
}))
vi.mock("@/hooks/useScanPolling", () => ({
  useScanPolling: useScanPollingMock,
}))

// next-auth/react is imported transitively by UnlockCTA → signIn.
// Stub it so we don't pull the auth runtime into a render test.
vi.mock("next-auth/react", () => ({
  signIn: vi.fn(),
}))

import { ScanShell } from "../ScanShell"

function makeContract(
  overrides: Partial<ContractResponse> = {},
): ContractResponse {
  return {
    id: "c-1",
    address: "0x" + "1".repeat(40),
    role: "PRIMARY",
    label: null,
    isPrimary: true,
    compositeScore: null,
    compositeGrade: null,
    isPartialGrade: false,
    crossChainTwins: [],
    modules: [
      {
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
      },
    ],
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
    contracts: [makeContract()],
    compositeGrade: null,
    isPartialGrade: false,
    createdAt: "2026-05-13T10:00:00.000Z",
    completedAt: null,
    expiresAt: "2026-06-13T10:00:00.000Z",
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

beforeEach(() => {
  useScanPollingMock.mockReturnValue({
    currentStatus: "QUEUED",
    errorCount: 0,
    polledContracts: null,
  })
})

afterEach(() => {
  cleanup()
  useScanPollingMock.mockClear()
})

describe("ScanShell — composition + polling integration (Plan 02 G.3, Phase G.4/G.5)", () => {
  it("calls useScanPolling with scan.id and scan.status on mount", () => {
    render(<ScanShell scan={makeScan()} tier="unauth" />)
    expect(useScanPollingMock).toHaveBeenCalledTimes(1)
    expect(useScanPollingMock).toHaveBeenCalledWith("scan-1", "QUEUED")
  })

  it("renders ProtocolGraphDisclaimer with single-Contract copy when contracts.length === 1", () => {
    render(<ScanShell scan={makeScan({ status: "COMPLETE" })} tier="email" />)
    const note = screen.getByRole("note", { name: /scan scope notice/i })
    expect(note).toBeInTheDocument()
    expect(note.textContent).toMatch(/core contract address/i)
  })

  it("renders ProtocolGraphDisclaimer with multi-Contract copy when contracts.length >= 2", () => {
    render(
      <ScanShell
        scan={makeScan({
          contracts: [
            makeContract({ id: "c-1", isPrimary: true, role: "PRIMARY" }),
            makeContract({ id: "c-2", isPrimary: false, role: "TIMELOCK" }),
          ],
        })}
        tier="email"
      />,
    )
    const note = screen.getByRole("note", { name: /scan scope notice/i })
    expect(note.textContent).toMatch(/scanned 2 contracts/i)
  })

  it("renders the protocol displayName via ScanHero", () => {
    render(
      <ScanShell
        scan={makeScan({
          protocol: {
            slug: "uni",
            displayName: "Uniswap V3",
            chain: "ETHEREUM",
            domain: null,
            ownershipStatus: "UNCLAIMED",
          },
        })}
        tier="unauth"
      />,
    )
    expect(screen.getByText("Uniswap V3")).toBeInTheDocument()
  })

  it("renders one ContractCard per contract (Phase G.2 wiring)", () => {
    render(
      <ScanShell
        scan={makeScan({
          contracts: [
            makeContract({ id: "c-1", role: "PRIMARY", isPrimary: true, modules: [] }),
            makeContract({ id: "c-2", role: "TIMELOCK", isPrimary: false, modules: [] }),
          ],
        })}
        tier="unauth"
      />,
    )
    // ContractList heading + per-Contract h3.
    expect(screen.getByRole("heading", { name: /Contracts \(2\)/ })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Primary" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Timelock" })).toBeInTheDocument()
  })

  it("threads currentStatus through CompositePanel — polling override wins over stale scan.status", () => {
    useScanPollingMock.mockReturnValue({
      currentStatus: "RUNNING",
      errorCount: 0,
      polledContracts: null,
    })
    render(<ScanShell scan={makeScan({ status: "QUEUED" })} tier="unauth" />)
    // CompositePanel surfaces "Running" copy.
    expect(screen.getByText("Running")).toBeInTheDocument()
  })

  it("shows the connection-issues indicator when errorCount > 0", () => {
    useScanPollingMock.mockReturnValue({
      currentStatus: "RUNNING",
      errorCount: 3,
      polledContracts: null,
    })
    render(<ScanShell scan={makeScan()} tier="unauth" />)
    const statuses = screen.getAllByRole("status")
    const connectionMsg = statuses.find((el) =>
      /connection issues detected/i.test(el.textContent ?? ""),
    )
    expect(connectionMsg).toBeDefined()
  })

  it("hides the connection-issues indicator when errorCount is 0", () => {
    render(<ScanShell scan={makeScan()} tier="unauth" />)
    expect(screen.queryByText(/connection issues detected/i)).toBeNull()
  })

  it("renders UnlockCTA for unauth tier", () => {
    render(<ScanShell scan={makeScan()} tier="unauth" />)
    expect(
      screen.getByText(/get notified when detection completes/i),
    ).toBeInTheDocument()
  })

  it("does not render UnlockCTA for email tier", () => {
    render(<ScanShell scan={makeScan()} tier="email" />)
    expect(
      screen.queryByText(/get notified when detection completes/i),
    ).toBeNull()
  })

  it("renders the composite grade letter when scan.compositeGrade is populated (Plan 04 §2: 'Protocol grade' label + single worst-wins 'Protocol score' line)", () => {
    useScanPollingMock.mockReturnValue({
      currentStatus: "COMPLETE",
      errorCount: 0,
      polledContracts: null,
    })
    render(
      <ScanShell
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "B",
          averageContractScore: 80,
          worstContractScore: 80,
        })}
        tier="email"
      />,
    )
    expect(screen.getByText("Protocol grade")).toBeInTheDocument()
    expect(screen.getByText("Protocol score")).toBeInTheDocument()
    expect(screen.getByText("80/100")).toBeInTheDocument()
    // Plan 04 §2: the old "Average contract score" line is gone.
    expect(screen.queryByText("Average contract score")).toBeNull()
  })

  describe("polled per-(Contract, module) merge (Plan 03 §7.3)", () => {
    // ContractCard nests ModuleCards in a <div role="region"
    // aria-label="<Role> modules — <label|address>">. Scope queries to the region so we
    // don't match "Queued" / "Running" against the composite panel.
    function modulesScope(scope: ReturnType<typeof render>["container"]) {
      const regions = scope.querySelectorAll(
        // Phase G remediation #3: region label is now
        // "<Role> modules — <label|address>" so the suffix is
        // dynamic; match on the " modules " bridge instead of the
        // old suffix-of-string.
        '[role="region"][aria-label*=" modules "]',
      )
      // For multi-Contract tests we may need to filter per region; the
      // helper here returns the first region's `within` scope.
      if (regions.length === 0) {
        throw new Error("No modules region found")
      }
      return within(regions[0] as HTMLElement)
    }

    it("falls back to server snapshot when polledContracts is null (initial render)", () => {
      const { container } = render(
        <ScanShell scan={makeScan()} tier="email" />,
      )
      // ModuleCard reads server snapshot status = QUEUED.
      expect(modulesScope(container).getByText("Queued")).toBeInTheDocument()
    })

    it("uses polled module status over server snapshot when polledContracts has a matching entry", () => {
      useScanPollingMock.mockReturnValue({
        currentStatus: "RUNNING",
        errorCount: 0,
        polledContracts: [
          {
            id: "c-1",
            address: "0x" + "1".repeat(40),
            label: null,
            role: "PRIMARY",
            isPrimary: true,
            modules: [
              { module: "GOVERNANCE", status: "RUNNING", grade: null },
            ],
          },
        ],
      })
      const { container } = render(
        <ScanShell scan={makeScan()} tier="email" />,
      )
      // Server snapshot is QUEUED; polled override drives ModuleCard
      // status badge to "Running".
      expect(modulesScope(container).getByText("Running")).toBeInTheDocument()
    })

    it("polled module COMPLETE status surfaces the polled grade letter via ModuleCard", () => {
      useScanPollingMock.mockReturnValue({
        currentStatus: "COMPLETE",
        errorCount: 0,
        polledContracts: [
          {
            id: "c-1",
            address: "0x" + "1".repeat(40),
            label: null,
            role: "PRIMARY",
            isPrimary: true,
            modules: [
              { module: "GOVERNANCE", status: "COMPLETE", grade: "B" },
            ],
          },
        ],
      })
      const { container } = render(
        <ScanShell scan={makeScan()} tier="email" />,
      )
      expect(modulesScope(container).getByText("Complete")).toBeInTheDocument()
      expect(modulesScope(container).getByText("B")).toBeInTheDocument()
    })

    it("polled module with null grade keeps the server-side grade (no blank-out on late stale polls)", () => {
      useScanPollingMock.mockReturnValue({
        currentStatus: "RUNNING",
        errorCount: 0,
        polledContracts: [
          {
            id: "c-1",
            address: "0x" + "1".repeat(40),
            label: null,
            role: "PRIMARY",
            isPrimary: true,
            modules: [
              { module: "GOVERNANCE", status: "RUNNING", grade: null },
            ],
          },
        ],
      })
      const { container } = render(
        <ScanShell
          scan={makeScan({
            contracts: [
              makeContract({
                modules: [
                  {
                    id: "mr-1",
                    module: "GOVERNANCE",
                    status: "COMPLETE",
                    grade: "A",
                    score: 95,
                    findingsCount: 0,
                    startedAt: null,
                    completedAt: null,
                    attemptCount: 0,
                    errorMessage: null,
                    errorStack: null,
                    detectorVersions: {},
                    rpcCallsUsed: 0,
                  },
                ],
              }),
            ],
          })}
          tier="email"
        />,
      )
      // Status follows the poll (RUNNING); grade falls back to server (A).
      expect(modulesScope(container).getByText("Running")).toBeInTheDocument()
      expect(modulesScope(container).getByText("A")).toBeInTheDocument()
    })

    it("contracts not present in polledContracts keep server snapshot unchanged", () => {
      useScanPollingMock.mockReturnValue({
        currentStatus: "RUNNING",
        errorCount: 0,
        polledContracts: [
          {
            id: "c-1",
            address: "0x" + "1".repeat(40),
            label: null,
            role: "PRIMARY",
            isPrimary: true,
            modules: [
              { module: "GOVERNANCE", status: "RUNNING", grade: null },
            ],
          },
        ],
      })
      const { container } = render(
        <ScanShell
          scan={makeScan({
            contracts: [
              makeContract({ id: "c-1", role: "PRIMARY", isPrimary: true }),
              makeContract({
                id: "c-2",
                role: "TIMELOCK",
                isPrimary: false,
                modules: [
                  {
                    id: "mr-2",
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
                  },
                ],
              }),
            ],
          })}
          tier="email"
        />,
      )
      const regions = container.querySelectorAll(
        // Phase G remediation #3: region label is now
        // "<Role> modules — <label|address>" so the suffix is
        // dynamic; match on the " modules " bridge instead of the
        // old suffix-of-string.
        '[role="region"][aria-label*=" modules "]',
      )
      expect(regions).toHaveLength(2)
      // c-1 (PRIMARY) merged → RUNNING. c-2 (TIMELOCK) untouched → QUEUED.
      expect(within(regions[0] as HTMLElement).getByText("Running")).toBeInTheDocument()
      expect(within(regions[1] as HTMLElement).getByText("Queued")).toBeInTheDocument()
    })
  })
})
