import { afterEach, describe, expect, it } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import type { ContractResponse } from "@/lib/scan-response"

import { ContractList } from "../ContractList"

function makeContract(
  overrides: Partial<ContractResponse> = {},
): ContractResponse {
  return {
    id: `c-${Math.random()}`,
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

afterEach(() => cleanup())

describe("ContractList (Plan 03 §7.4)", () => {
  it("renders nothing when contracts array is empty (no noise on results-pending scans)", () => {
    const { container } = render(<ContractList contracts={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders one ContractCard per contract with a count in the heading", () => {
    render(
      <ContractList
        contracts={[
          makeContract({ id: "c-a", role: "PRIMARY", isPrimary: true }),
          makeContract({ id: "c-b", role: "TIMELOCK", isPrimary: false }),
          makeContract({ id: "c-c", role: "DECLARED_MULTISIG", isPrimary: false }),
        ]}
      />,
    )
    expect(
      screen.getByRole("heading", { name: /Contracts \(3\)/ }),
    ).toBeInTheDocument()
    // All three roles surface as h3 headings (fallback when label null).
    expect(screen.getByRole("heading", { name: "Primary" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Timelock" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Multisig" })).toBeInTheDocument()
  })

  it("renders the contracts in the order supplied by the response builder", () => {
    // Response builder sorts; ContractList must NOT re-sort. If a test
    // ever sees mis-ordered output here, the contract is broken.
    const { container } = render(
      <ContractList
        contracts={[
          makeContract({ id: "c-1", role: "PRIMARY", isPrimary: true, label: "A" }),
          makeContract({ id: "c-2", role: "TIMELOCK", isPrimary: false, label: "B" }),
          makeContract({ id: "c-3", role: "RELATED", isPrimary: false, label: "C" }),
        ]}
      />,
    )
    const headings = Array.from(
      container.querySelectorAll("h3"),
    ).map((h) => h.textContent)
    expect(headings).toEqual(["A", "B", "C"])
  })
})
