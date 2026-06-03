import { afterEach, describe, expect, it } from "vitest"
import { render, screen, cleanup, within } from "@testing-library/react"

import type { ContractResponse } from "@/lib/scan-response"

import { ContractCard } from "../ContractCard"

function makeContract(
  overrides: Partial<ContractResponse> = {},
): ContractResponse {
  return {
    id: "c-1",
    address: "0x1234567890abcdef1234567890abcdef12345678",
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

afterEach(() => cleanup())

describe("ContractCard (Plan 03 §7.4)", () => {
  it("renders role label + truncated address + grade chip + findings count", () => {
    render(
      <ContractCard
        contract={makeContract({ findingsCount: 3, compositeGrade: "B", compositeScore: 80 })}
      />,
    )
    // Heading falls back to the role label when contract.label is null.
    expect(screen.getByRole("heading", { name: "Primary" })).toBeInTheDocument()
    // Truncated to first 8 + last 4 (uses Unicode ellipsis U+2026).
    expect(screen.getByText(/0x123456.*5678/)).toBeInTheDocument()
    expect(screen.getByLabelText("Grade B")).toBeInTheDocument()
    expect(screen.getByText("80/100")).toBeInTheDocument()
    expect(screen.getByText(/3 findings on this contract/i)).toBeInTheDocument()
  })

  it("uses 1-finding singular when findingsCount === 1", () => {
    render(<ContractCard contract={makeContract({ findingsCount: 1 })} />)
    expect(screen.getByText(/1 finding on this contract/i)).toBeInTheDocument()
  })

  it("renders custom user-supplied label when present (label wins over role label as heading)", () => {
    render(
      <ContractCard
        contract={makeContract({
          label: "Aave V3 Pool",
          role: "PRIMARY",
        })}
      />,
    )
    expect(screen.getByRole("heading", { name: "Aave V3 Pool" })).toBeInTheDocument()
    // Role label still appears in the subheader chip.
    expect(screen.getByText("Primary")).toBeInTheDocument()
  })

  it("hides the grade chip when compositeGrade is null (FAILED or SKIPPED contract)", () => {
    render(
      <ContractCard
        contract={makeContract({ compositeGrade: null, compositeScore: null })}
      />,
    )
    expect(screen.queryByLabelText(/^Grade/)).toBeNull()
  })

  it("renders the proxy detect-and-warn aside when proxyImplementationWarning is set (§5.3)", () => {
    render(
      <ContractCard
        contract={makeContract({
          proxyImplementationWarning: {
            detectedAddress: "0xIMPLABCDEF1234567890ABCDEF1234567890",
          },
        })}
      />,
    )
    const aside = screen.getByRole("note", { name: /proxy implementation detected/i })
    expect(aside).toBeInTheDocument()
    expect(within(aside).getByText(/proxy implementation detected at/i)).toBeInTheDocument()
    // Spec §5.3 phrasing: "Resubmit ... PROXY_IMPLEMENTATION ... related contract"
    expect(within(aside).getByText(/PROXY_IMPLEMENTATION/)).toBeInTheDocument()
  })

  it("does NOT render the proxy warning when proxyImplementationWarning is null", () => {
    render(
      <ContractCard
        contract={makeContract({ proxyImplementationWarning: null })}
      />,
    )
    expect(
      screen.queryByRole("note", { name: /proxy implementation detected/i }),
    ).toBeNull()
  })

  it("renders one ModuleCard per contract.modules entry", () => {
    render(
      <ContractCard
        contract={makeContract({
          modules: [
            {
              id: "mr-gov",
              module: "GOVERNANCE",
              status: "COMPLETE",
              grade: "B",
              score: 80,
              findingsCount: 0,
              startedAt: null,
              completedAt: null,
              attemptCount: 0,
              errorMessage: null,
              errorStack: null,
              detectorVersions: {},
              rpcCallsUsed: 0,
            },
            {
              id: "mr-oracle",
              module: "ORACLE",
              status: "SKIPPED",
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
        })}
      />,
    )
    expect(screen.getByText("Governance")).toBeInTheDocument()
    expect(screen.getByText("Oracle & Bridge")).toBeInTheDocument()
  })

  it("renders no module grid when contract has zero modules", () => {
    render(<ContractCard contract={makeContract({ modules: [] })} />)
    // No 'Primary modules' region should be present.
    expect(screen.queryByRole("region", { name: /modules/i })).toBeNull()
  })

  // Phase G remediation #3 (Codex Review #5 NTH 3): the modules region
  // aria-label was just "<Role> modules". A scan with two same-role
  // contracts (e.g., two DECLARED_MULTISIG) produced identical region
  // labels for screen readers. The label now includes a disambiguator
  // — contract.label if set, else the truncated address.

  it("modules region aria-label uses contract.label when present (Codex Review #5 NTH 3)", () => {
    const { container } = render(
      <ContractCard
        contract={makeContract({
          role: "DECLARED_MULTISIG",
          label: "Aave Guardian",
          modules: [
            {
              id: "mr-gov",
              module: "GOVERNANCE",
              status: "COMPLETE",
              grade: "B",
              score: 80,
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
        })}
      />,
    )
    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    expect(region!.getAttribute("aria-label")).toBe(
      "Multisig modules — Aave Guardian",
    )
  })

  it("modules region aria-label falls back to truncated address when contract.label is null", () => {
    const { container } = render(
      <ContractCard
        contract={makeContract({
          role: "DECLARED_MULTISIG",
          label: null,
          address: "0x1234567890abcdef1234567890abcdef12345678",
          modules: [
            {
              id: "mr-gov",
              module: "GOVERNANCE",
              status: "COMPLETE",
              grade: "B",
              score: 80,
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
        })}
      />,
    )
    const region = container.querySelector('[role="region"]')
    expect(region).not.toBeNull()
    // Uses first-8 + Unicode ellipsis + last-4 (matches the
    // ContractCard.truncateAddress helper).
    expect(region!.getAttribute("aria-label")).toMatch(
      /^Multisig modules — 0x123456.*5678$/,
    )
  })

  it("two same-role contracts produce distinct module-region aria-labels (the original NTH 3 motivation)", () => {
    // Render two ContractCards into the same container so we can
    // compare both regions' aria-labels.
    const { container } = render(
      <>
        <ContractCard
          contract={makeContract({
            id: "c-a",
            role: "DECLARED_MULTISIG",
            label: null,
            address: "0xa".repeat(40),
            modules: [
              {
                id: "mr-a",
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
          })}
        />
        <ContractCard
          contract={makeContract({
            id: "c-b",
            role: "DECLARED_MULTISIG",
            label: null,
            address: "0xb".repeat(40),
            modules: [
              {
                id: "mr-b",
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
          })}
        />
      </>,
    )
    const labels = Array.from(
      container.querySelectorAll('[role="region"]'),
    ).map((el) => el.getAttribute("aria-label"))
    expect(labels).toHaveLength(2)
    expect(labels[0]).not.toEqual(labels[1])
    // Both still start with "Multisig modules — " (same role, just
    // disambiguated by address).
    expect(labels[0]).toMatch(/^Multisig modules — 0x/)
    expect(labels[1]).toMatch(/^Multisig modules — 0x/)
  })
})
