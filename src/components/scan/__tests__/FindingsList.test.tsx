import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { FindingsList } from "../FindingsList"
import type {
  ContractResponse,
  FindingResponse,
  FindingResponseEmail,
  FindingResponseUnauth,
} from "@/lib/scan-response"

function makeContract(
  overrides: Partial<ContractResponse> = {},
): ContractResponse {
  return {
    id: "contract-1",
    address: "0x" + "1".repeat(40),
    role: "PRIMARY",
    label: null,
    isPrimary: true,
    compositeScore: null,
    compositeGrade: null,
    isPartialGrade: false,
    crossChainTwins: [],
    modules: [],
    findingsCount: 0,
    proxyImplementationWarning: null,
    ...overrides,
  }
}

// Default single-Contract fixture matching the contractId stamped on
// the default makeUnauth/EmailFinding factories below.
const defaultContracts: ContractResponse[] = [makeContract()]

function makeUnauthFinding(
  overrides: Partial<FindingResponseUnauth> = {},
): FindingResponseUnauth {
  return {
    tier: "UNAUTH",
    // Plan 03 §7.2: all FindingResponse variants carry contractId so the
    // UI can group by Contract without joining tables.
    contractId: "contract-1",
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
    contractId: "contract-1",
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
    render(<FindingsList findings={[]} contracts={defaultContracts} tier="unauth" status="RUNNING" hasAnyHiddenFindings={false} />)
    expect(screen.getByRole("heading", { name: /findings/i })).toBeInTheDocument()
    expect(
      screen.getByText(/results will appear here when detection completes/i),
    ).toBeInTheDocument()
  })

  describe("empty-state copy branches on scan status (G.5 N2)", () => {
    it("COMPLETE + no findings → 'No findings detected.'", () => {
      render(<FindingsList findings={[]} contracts={defaultContracts} tier="email" status="COMPLETE" hasAnyHiddenFindings={false} />)
      expect(screen.getByText(/no findings detected/i)).toBeInTheDocument()
      expect(screen.queryByText(/will appear here/i)).toBeNull()
    })

    it("FAILED + no findings → 'Scan failed. Findings unavailable.'", () => {
      render(<FindingsList findings={[]} contracts={defaultContracts} tier="email" status="FAILED" hasAnyHiddenFindings={false} />)
      expect(screen.getByText(/scan failed.*findings unavailable/i)).toBeInTheDocument()
      expect(screen.queryByText(/no findings detected/i)).toBeNull()
    })

    it("EXPIRED + no findings → expiry-specific copy", () => {
      render(<FindingsList findings={[]} contracts={defaultContracts} tier="email" status="EXPIRED" hasAnyHiddenFindings={false} />)
      expect(
        screen.getByText(/this scan has expired.*findings are no longer available/i),
      ).toBeInTheDocument()
    })

    it("QUEUED + no findings → in-progress copy", () => {
      render(<FindingsList findings={[]} contracts={defaultContracts} tier="email" status="QUEUED" hasAnyHiddenFindings={false} />)
      expect(
        screen.getByText(/results will appear here when detection completes/i),
      ).toBeInTheDocument()
    })

    it("PARTIAL_COMPLETE (non-terminal) + no findings → in-progress copy", () => {
      render(<FindingsList findings={[]} contracts={defaultContracts} tier="email" status="PARTIAL_COMPLETE" hasAnyHiddenFindings={false} />)
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
    render(<FindingsList findings={findings} contracts={defaultContracts} tier="email" status="RUNNING" hasAnyHiddenFindings={false} />)

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
    render(<FindingsList findings={findings} contracts={defaultContracts} tier="unauth" status="RUNNING" hasAnyHiddenFindings={true} />)

    expect(
      screen.getByText(/showing top finding per module.*enter email below to unlock all/i),
    ).toBeInTheDocument()
  })

  it("unauth tier does NOT show hint when hasAnyHiddenFindings is false", () => {
    const findings: FindingResponse[] = [makeUnauthFinding()]
    render(<FindingsList findings={findings} contracts={defaultContracts} tier="unauth" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.queryByText(/unlock all/i)).not.toBeInTheDocument()
  })

  it("email tier does NOT show hidden findings hint", () => {
    const findings: FindingResponse[] = [makeEmailFinding()]
    render(<FindingsList findings={findings} contracts={defaultContracts} tier="email" status="RUNNING" hasAnyHiddenFindings={true} />)

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
    render(<FindingsList findings={findings} contracts={defaultContracts} tier="email" status="RUNNING" hasAnyHiddenFindings={false} />)

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
    render(<FindingsList findings={findings} contracts={defaultContracts} tier="email" status="RUNNING" hasAnyHiddenFindings={false} />)

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
    render(<FindingsList findings={findings} contracts={defaultContracts} tier="email" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.getByText(/GOVERNANCE · gov-admin-key/)).toBeInTheDocument()
    expect(screen.getByText("Admin key holds sole upgrade authority.")).toBeInTheDocument()
  })

  it("unauth tier finding does not render module subheader or description", () => {
    const findings: FindingResponse[] = [
      makeUnauthFinding({ publicTitle: "Teaser" }),
    ]
    render(<FindingsList findings={findings} contracts={defaultContracts} tier="unauth" status="RUNNING" hasAnyHiddenFindings={false} />)

    expect(screen.getByText("Teaser")).toBeInTheDocument()
    expect(screen.queryByText(/GOVERNANCE/)).not.toBeInTheDocument()
  })

  describe("per-Contract grouping (Phase G.4 — spec §7.4)", () => {
    it("groups findings into one section per Contract; renders section header with role + truncated address", () => {
      const contracts = [
        {
          ...defaultContracts[0],
          id: "c-a",
          address: "0xa".repeat(20),
          role: "PRIMARY" as const,
          label: null,
        },
        {
          id: "c-b",
          address: "0xb".repeat(20),
          role: "TIMELOCK" as const,
          label: "Short Executor",
          isPrimary: false,
          compositeScore: null,
          compositeGrade: null,
          isPartialGrade: false,
          crossChainTwins: [],
          modules: [],
          findingsCount: 1,
          proxyImplementationWarning: null,
        },
      ]
      const findings: FindingResponse[] = [
        makeEmailFinding({ id: "fa-1", contractId: "c-a", publicTitle: "PRIMARY finding A1" }),
        makeEmailFinding({ id: "fa-2", contractId: "c-a", publicTitle: "PRIMARY finding A2" }),
        makeEmailFinding({ id: "fb-1", contractId: "c-b", publicTitle: "TIMELOCK finding B1" }),
      ]
      render(
        <FindingsList
          findings={findings}
          contracts={contracts}
          tier="email"
          status="COMPLETE"
          hasAnyHiddenFindings={false}
        />,
      )

      // Top-level total count.
      expect(screen.getByRole("heading", { name: /findings \(3\)/i })).toBeInTheDocument()

      // Section headers: PRIMARY (no label → falls back to role) and "Short Executor".
      expect(screen.getByRole("heading", { name: "Primary", level: 3 })).toBeInTheDocument()
      expect(screen.getByRole("heading", { name: "Short Executor", level: 3 })).toBeInTheDocument()

      // All 3 finding titles rendered in their respective sections.
      expect(screen.getByText("PRIMARY finding A1")).toBeInTheDocument()
      expect(screen.getByText("PRIMARY finding A2")).toBeInTheDocument()
      expect(screen.getByText("TIMELOCK finding B1")).toBeInTheDocument()
    })

    it("skips contracts that have no findings (no empty sections)", () => {
      const contracts = [
        defaultContracts[0], // contract-1 — has the finding
        {
          id: "c-empty",
          address: "0x" + "9".repeat(40),
          role: "RELATED" as const,
          label: null,
          isPrimary: false,
          compositeScore: null,
          compositeGrade: null,
          isPartialGrade: false,
          crossChainTwins: [],
          modules: [],
          findingsCount: 0,
          proxyImplementationWarning: null,
        },
      ]
      render(
        <FindingsList
          findings={[makeEmailFinding({ contractId: "contract-1" })]}
          contracts={contracts}
          tier="email"
          status="COMPLETE"
          hasAnyHiddenFindings={false}
        />,
      )

      // Only the contract-1 section exists; "Related" section is absent.
      expect(screen.getByRole("heading", { name: "Primary", level: 3 })).toBeInTheDocument()
      expect(screen.queryByRole("heading", { name: "Related", level: 3 })).toBeNull()
    })

    it("buckets findings whose contractId doesn't match any contract into a single 'Other findings' section (Phase G remediation #2)", () => {
      render(
        <FindingsList
          findings={[
            makeEmailFinding({ id: "ghost", contractId: "no-such-contract" }),
          ]}
          contracts={defaultContracts}
          tier="email"
          status="COMPLETE"
          hasAnyHiddenFindings={false}
        />,
      )
      expect(
        screen.getByRole("heading", { name: "Other findings", level: 3 }),
      ).toBeInTheDocument()
    })

    it("collapses multiple orphan contractId buckets into ONE 'Other findings' section — no duplicate heading ids (Codex Review #5 NTH 2)", () => {
      const { container } = render(
        <FindingsList
          findings={[
            makeEmailFinding({
              id: "ghost-a",
              contractId: "no-such-contract-a",
              publicTitle: "Ghost A",
            }),
            makeEmailFinding({
              id: "ghost-b",
              contractId: "no-such-contract-b",
              publicTitle: "Ghost B",
            }),
            makeEmailFinding({
              id: "ghost-c",
              contractId: "no-such-contract-c",
              publicTitle: "Ghost C",
            }),
          ]}
          contracts={defaultContracts}
          tier="email"
          status="COMPLETE"
          hasAnyHiddenFindings={false}
        />,
      )

      // Exactly one "Other findings" heading — orphans from THREE
      // distinct unmatched bucket keys collapse into a single section.
      const orphanHeadings = screen.getAllByRole("heading", {
        name: "Other findings",
        level: 3,
      })
      expect(orphanHeadings).toHaveLength(1)

      // And exactly one DOM element carries the stable orphan id.
      const orphanIds = container.querySelectorAll(
        '[id="findings-other-heading"]',
      )
      expect(orphanIds).toHaveLength(1)

      // All three orphan findings render inside that single section.
      expect(screen.getByText("Ghost A")).toBeInTheDocument()
      expect(screen.getByText("Ghost B")).toBeInTheDocument()
      expect(screen.getByText("Ghost C")).toBeInTheDocument()
    })
  })
})
