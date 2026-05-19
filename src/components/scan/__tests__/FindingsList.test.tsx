import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { FindingsList } from "../FindingsList"
import type {
  FindingResponse,
  FindingResponseEmail,
  FindingResponseUnauth,
} from "@/lib/scan-response"

function makeUnauthFinding(
  overrides: Partial<FindingResponseUnauth> = {},
): FindingResponseUnauth {
  return {
    tier: "UNAUTH",
    severity: "HIGH",
    publicTitle: "Potential governance hijack",
    remediationHint: "Review proposal thresholds",
    ...overrides,
  }
}

function makeEmailFinding(
  overrides: Partial<FindingResponseEmail> = {},
): FindingResponseEmail {
  return {
    tier: "EMAIL",
    id: "f-1",
    moduleRunId: "mr-1",
    module: "GOVERNANCE",
    severity: "HIGH",
    publicTitle: "Potential governance hijack",
    title: "Governance admin-key concentration",
    description: "Admin key holds sole upgrade authority.",
    evidence: { adminKeyCount: 1 },
    affectedComponent: "0xdeadbeef",
    references: [],
    remediationHint: "Distribute admin keys across multisig",
    publicRank: 1,
    detectorId: "gov-admin-key",
    detectorVersion: 1,
    createdAt: "2026-04-22T10:00:00.000Z",
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
})

describe("FindingsList", () => {
  it("renders empty state heading + in-progress copy when running with no findings", () => {
    render(<FindingsList findings={[]} tier="unauth" status="RUNNING" hasAnyHiddenFindings={false} />)
    expect(screen.getByRole("heading", { name: /findings/i })).toBeInTheDocument()
    expect(
      screen.getByText(/results will appear here when detection completes/i),
    ).toBeInTheDocument()
  })

  describe("empty-state copy branches on scan status (G.5 N2)", () => {
    it("COMPLETE + no findings → 'No findings detected.'", () => {
      render(<FindingsList findings={[]} tier="email" status="COMPLETE" hasAnyHiddenFindings={false} />)
      expect(screen.getByText(/no findings detected/i)).toBeInTheDocument()
      expect(screen.queryByText(/will appear here/i)).toBeNull()
    })

    it("FAILED + no findings → 'Scan failed. Findings unavailable.'", () => {
      render(<FindingsList findings={[]} tier="email" status="FAILED" hasAnyHiddenFindings={false} />)
      expect(screen.getByText(/scan failed.*findings unavailable/i)).toBeInTheDocument()
      expect(screen.queryByText(/no findings detected/i)).toBeNull()
    })

    it("EXPIRED + no findings → expiry-specific copy", () => {
      render(<FindingsList findings={[]} tier="email" status="EXPIRED" hasAnyHiddenFindings={false} />)
      expect(
        screen.getByText(/this scan has expired.*findings are no longer available/i),
      ).toBeInTheDocument()
    })

    it("QUEUED + no findings → in-progress copy", () => {
      render(<FindingsList findings={[]} tier="email" status="QUEUED" hasAnyHiddenFindings={false} />)
      expect(
        screen.getByText(/results will appear here when detection completes/i),
      ).toBeInTheDocument()
    })

    it("PARTIAL_COMPLETE (non-terminal) + no findings → in-progress copy", () => {
      render(<FindingsList findings={[]} tier="email" status="PARTIAL_COMPLETE" hasAnyHiddenFindings={false} />)
      expect(
        screen.getByText(/results will appear here when detection completes/i),
      ).toBeInTheDocument()
    })
  })

  it("renders multiple findings with severity badges", () => {
    const findings: FindingResponse[] = [
      makeEmailFinding({ id: "f-1", severity: "CRITICAL", publicTitle: "Finding A" }),
      makeEmailFinding({ id: "f-2", severity: "MEDIUM", publicTitle: "Finding B" }),
      makeEmailFinding({ id: "f-3", severity: "LOW", publicTitle: "Finding C" }),
    ]
    render(<FindingsList findings={findings} tier="email" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.getByRole("heading", { name: /findings \(3\)/i })).toBeInTheDocument()
    expect(screen.getByText("Finding A")).toBeInTheDocument()
    expect(screen.getByText("Finding B")).toBeInTheDocument()
    expect(screen.getByText("Finding C")).toBeInTheDocument()
    expect(screen.getByText("Critical")).toBeInTheDocument()
    expect(screen.getByText("Medium")).toBeInTheDocument()
    expect(screen.getByText("Low")).toBeInTheDocument()
  })

  it("unauth tier shows 'unlock all' hint when hasAnyHiddenFindings is true", () => {
    const findings: FindingResponse[] = [makeUnauthFinding()]
    render(<FindingsList findings={findings} tier="unauth" status="RUNNING" hasAnyHiddenFindings={true} />)

    expect(
      screen.getByText(/showing top finding per module.*enter email below to unlock all/i),
    ).toBeInTheDocument()
  })

  it("unauth tier does NOT show hint when hasAnyHiddenFindings is false", () => {
    const findings: FindingResponse[] = [makeUnauthFinding()]
    render(<FindingsList findings={findings} tier="unauth" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.queryByText(/unlock all/i)).not.toBeInTheDocument()
  })

  it("email tier does NOT show hidden findings hint", () => {
    const findings: FindingResponse[] = [makeEmailFinding()]
    render(<FindingsList findings={findings} tier="email" status="RUNNING" hasAnyHiddenFindings={true} />)

    expect(screen.queryByText(/unlock all/i)).not.toBeInTheDocument()
  })

  it("maps each severity to the correct label", () => {
    const findings: FindingResponse[] = [
      makeEmailFinding({ id: "f-1", severity: "CRITICAL", publicTitle: "A" }),
      makeEmailFinding({ id: "f-2", severity: "HIGH", publicTitle: "B" }),
      makeEmailFinding({ id: "f-3", severity: "MEDIUM", publicTitle: "C" }),
      makeEmailFinding({ id: "f-4", severity: "LOW", publicTitle: "D" }),
      makeEmailFinding({ id: "f-5", severity: "INFO", publicTitle: "E" }),
    ]
    render(<FindingsList findings={findings} tier="email" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.getByText("Critical")).toBeInTheDocument()
    expect(screen.getByText("High")).toBeInTheDocument()
    expect(screen.getByText("Medium")).toBeInTheDocument()
    expect(screen.getByText("Low")).toBeInTheDocument()
    expect(screen.getByText("Info")).toBeInTheDocument()
  })

  it("unknown severity falls back to Info styling", () => {
    const findings: FindingResponse[] = [
      makeEmailFinding({ severity: "UNKNOWN" as never, publicTitle: "Weird finding" }),
    ]
    render(<FindingsList findings={findings} tier="email" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.getByText("Info")).toBeInTheDocument()
  })

  it("email tier renders module + detectorId subheader and description", () => {
    const findings: FindingResponse[] = [
      makeEmailFinding({
        module: "GOVERNANCE",
        detectorId: "gov-admin-key",
        description: "Admin key holds sole upgrade authority.",
      }),
    ]
    render(<FindingsList findings={findings} tier="email" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.getByText(/GOVERNANCE · gov-admin-key/)).toBeInTheDocument()
    expect(screen.getByText("Admin key holds sole upgrade authority.")).toBeInTheDocument()
  })

  it("unauth tier finding does not render module subheader or description", () => {
    const findings: FindingResponse[] = [
      makeUnauthFinding({ publicTitle: "Teaser" }),
    ]
    render(<FindingsList findings={findings} tier="unauth" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.getByText("Teaser")).toBeInTheDocument()
    expect(screen.queryByText(/GOVERNANCE/)).not.toBeInTheDocument()
  })
})
