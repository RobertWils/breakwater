import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"

import type { ScanResponse } from "@/lib/scan-response"

// Mock useScanPolling — ScanShell's job is to thread the polled result
// into its children. The polling behavior itself is covered in
// src/hooks/__tests__/useScanPolling.test.ts. Hoisted so the vi.mock
// factory below can see the spy.
type PolledModuleState = { module: string; status: string; grade: string | null }

const { useScanPollingMock } = vi.hoisted(() => ({
  useScanPollingMock: vi.fn<
    () => {
      currentStatus: string
      errorCount: number
      polledModules: { module: string; status: string; grade: string | null }[] | null
    }
  >(() => ({ currentStatus: "QUEUED", errorCount: 0, polledModules: null })),
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

function makeScan(overrides: Partial<ScanResponse> = {}): ScanResponse {
  return {
    id: "scan-1",
    status: "QUEUED",
    compositeScore: null,
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
    findings: [],
    ...overrides,
  }
}

beforeEach(() => {
  useScanPollingMock.mockReturnValue({ currentStatus: "QUEUED", errorCount: 0, polledModules: null })
})

afterEach(() => {
  cleanup()
  useScanPollingMock.mockClear()
})

describe("ScanShell — composition + polling integration (Plan 02 G.3)", () => {
  it("calls useScanPolling with scan.id and scan.status on mount", () => {
    render(<ScanShell scan={makeScan()} tier="unauth" />)
    expect(useScanPollingMock).toHaveBeenCalledTimes(1)
    expect(useScanPollingMock).toHaveBeenCalledWith("scan-1", "QUEUED")
  })

  it("renders ProtocolGraphDisclaimer regardless of status", () => {
    render(<ScanShell scan={makeScan({ status: "COMPLETE" })} tier="email" />)
    const note = screen.getByRole("note")
    expect(note).toBeInTheDocument()
    expect(note.textContent).toMatch(/core contract address/i)
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

  it("renders a ModuleCard for each module", () => {
    render(<ScanShell scan={makeScan()} tier="unauth" />)
    expect(screen.getByText("Governance")).toBeInTheDocument()
  })

  it("threads currentStatus through CompositePanel — polling override wins over stale scan.status", () => {
    useScanPollingMock.mockReturnValue({
      currentStatus: "RUNNING",
      errorCount: 0,
      polledModules: null,
    })
    render(<ScanShell scan={makeScan({ status: "QUEUED" })} tier="unauth" />)
    // CompositePanel surfaces "Running" copy. (ModuleCard's own status
    // badge also renders "Queued" — that's the module status, not the
    // scan status, so we don't assert it absent globally.)
    expect(screen.getByText("Running")).toBeInTheDocument()
  })

  it("shows the connection-issues indicator when errorCount > 0", () => {
    useScanPollingMock.mockReturnValue({
      currentStatus: "RUNNING",
      errorCount: 3,
      polledModules: null,
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

  it("renders the composite grade letter when scan.compositeGrade is populated", () => {
    useScanPollingMock.mockReturnValue({
      currentStatus: "COMPLETE",
      errorCount: 0,
      polledModules: null,
    })
    render(
      <ScanShell
        scan={makeScan({
          status: "COMPLETE",
          compositeGrade: "B",
          compositeScore: 80,
        })}
        tier="email"
      />,
    )
    expect(screen.getByText("B")).toBeInTheDocument()
    expect(screen.getByText("Score: 80/100")).toBeInTheDocument()
  })

  describe("polled-module merge (G.5 I1)", () => {
    function makeScanWithModules(modules: ScanResponse["modules"]): ScanResponse {
      return makeScan({ modules })
    }

    function moduleRow(
      overrides: Partial<ScanResponse["modules"][number]> = {},
    ): ScanResponse["modules"][number] {
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

    // CompositePanel and ModuleCard share the same status label set
    // ("Queued"/"Running"/"Complete"), so `getByText` is ambiguous when
    // we want to assert on the per-module badge. Scope queries to the
    // modules <section aria-labelledby="modules-heading">.
    function modulesScope() {
      return within(screen.getByRole("region", { name: /scan modules/i }))
    }

    it("falls back to server snapshot when polledModules is null (initial render)", () => {
      // polledModules: null by default — ModuleCard renders the server-snapshot status badge.
      render(
        <ScanShell
          scan={makeScanWithModules([moduleRow({ status: "QUEUED" })])}
          tier="email"
        />,
      )
      expect(modulesScope().getByText("Queued")).toBeInTheDocument()
    })

    it("uses polled module status over server snapshot when polledModules is populated", () => {
      const polled: PolledModuleState[] = [
        { module: "GOVERNANCE", status: "RUNNING", grade: null },
      ]
      useScanPollingMock.mockReturnValue({
        currentStatus: "RUNNING",
        errorCount: 0,
        polledModules: polled,
      })
      render(
        <ScanShell
          scan={makeScanWithModules([moduleRow({ status: "QUEUED" })])}
          tier="email"
        />,
      )
      // Server snapshot is QUEUED; polled override drives ModuleCard to RUNNING.
      expect(modulesScope().getByText("Running")).toBeInTheDocument()
      expect(modulesScope().queryByText("Queued")).toBeNull()
    })

    it("polled module COMPLETE status surfaces the polled grade letter via ModuleCard", () => {
      const polled: PolledModuleState[] = [
        { module: "GOVERNANCE", status: "COMPLETE", grade: "B" },
      ]
      useScanPollingMock.mockReturnValue({
        currentStatus: "COMPLETE",
        errorCount: 0,
        polledModules: polled,
      })
      render(
        <ScanShell
          scan={makeScanWithModules([
            moduleRow({ status: "QUEUED", grade: null }),
          ])}
          tier="email"
        />,
      )
      expect(modulesScope().getByText("Complete")).toBeInTheDocument()
      // Grade letter appears in the modules section regardless of
      // scan.compositeGrade.
      expect(modulesScope().getByText("B")).toBeInTheDocument()
    })

    it("polled module with null grade keeps the server-side grade (no blank-out)", () => {
      // If a late stale poll arrives after router.refresh has populated the
      // grade, we must not overwrite it with null.
      const polled: PolledModuleState[] = [
        { module: "GOVERNANCE", status: "RUNNING", grade: null },
      ]
      useScanPollingMock.mockReturnValue({
        currentStatus: "RUNNING",
        errorCount: 0,
        polledModules: polled,
      })
      render(
        <ScanShell
          scan={makeScanWithModules([
            moduleRow({ status: "COMPLETE", grade: "A", score: 95 }),
          ])}
          tier="email"
        />,
      )
      const scope = modulesScope()
      // Status follows the poll (RUNNING); grade falls back to server (A).
      expect(scope.getByText("Running")).toBeInTheDocument()
      expect(scope.getByText("A")).toBeInTheDocument()
    })

    it("modules not present in polledModules keep server snapshot unchanged", () => {
      const polled: PolledModuleState[] = [
        { module: "GOVERNANCE", status: "RUNNING", grade: null },
      ]
      useScanPollingMock.mockReturnValue({
        currentStatus: "RUNNING",
        errorCount: 0,
        polledModules: polled,
      })
      render(
        <ScanShell
          scan={makeScanWithModules([
            moduleRow({ id: "mr-1", module: "GOVERNANCE", status: "QUEUED" }),
            moduleRow({ id: "mr-2", module: "ORACLE", status: "QUEUED" }),
          ])}
          tier="email"
        />,
      )
      const scope = modulesScope()
      // GOVERNANCE is RUNNING (polled), ORACLE stays QUEUED (server).
      expect(scope.getByText("Running")).toBeInTheDocument()
      expect(scope.getByText("Queued")).toBeInTheDocument()
    })
  })
})
