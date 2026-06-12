import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react"
import { MultiContractForm } from "../MultiContractForm"

// useRouter — the form navigates to /scan/[id] on success (mirrors ScanForm).
const mockPush = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mockPush.mockClear()
})

const PRIMARY = "0x" + "1".repeat(40)
const A = "0x" + "a".repeat(40)
const B = "0x" + "b".repeat(40)

function primaryInput() {
  return screen.getByLabelText(/protocol address/i)
}
function scanButton() {
  return screen.getByRole("button", { name: /scan protocol/i })
}
function relatedAddressInputs() {
  return screen.getAllByLabelText("Related contract address")
}

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ status, json: () => Promise.resolve(body) })
}

describe("MultiContractForm — validation + interaction", () => {
  it("disables the scan button until a valid primary address is entered", () => {
    render(<MultiContractForm />)
    expect(scanButton()).toBeDisabled()

    fireEvent.change(primaryInput(), { target: { value: "0xnope" } })
    expect(scanButton()).toBeDisabled()
    expect(screen.getByText(/not a valid address/i)).toBeInTheDocument()

    fireEvent.change(primaryInput(), { target: { value: PRIMARY } })
    expect(scanButton()).toBeEnabled()
  })

  it("prefills the primary from initialPrimary", () => {
    render(<MultiContractForm initialPrimary={PRIMARY} />)
    expect((primaryInput() as HTMLInputElement).value).toBe(PRIMARY)
    expect(scanButton()).toBeEnabled()
  })

  it("adds and removes related rows, with the count reflecting it", () => {
    render(<MultiContractForm />)
    expect(relatedAddressInputs()).toHaveLength(1)
    expect(screen.getByText("1/20")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /add contract/i }))
    expect(relatedAddressInputs()).toHaveLength(2)
    expect(screen.getByText("2/20")).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole("button", { name: /remove contract/i })[0])
    expect(relatedAddressInputs()).toHaveLength(1)
  })

  it("paste mode parses addresses into rows", () => {
    render(<MultiContractForm />)
    fireEvent.click(screen.getByRole("button", { name: /paste multiple/i }))
    const textarea = screen.getByLabelText(/paste multiple addresses/i)
    fireEvent.change(textarea, { target: { value: `${A}\n${B}` } })
    fireEvent.click(screen.getByRole("button", { name: /add pasted/i }))
    expect(relatedAddressInputs()).toHaveLength(3) // 1 initial empty + 2 pasted
  })
})

describe("MultiContractForm — submit (mirrors ScanForm)", () => {
  it("POSTs the schema-shaped payload (with relatedContracts) and navigates to /scan/[id]", async () => {
    const fetchMock = mockFetch(202, { scanId: "scan-xyz-123" })
    vi.stubGlobal("fetch", fetchMock)

    render(<MultiContractForm initialPrimary={PRIMARY} />)
    fireEvent.change(relatedAddressInputs()[0], { target: { value: A } })

    await act(async () => {
      fireEvent.click(scanButton())
    })

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/scan/scan-xyz-123"))

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/scan",
      expect.objectContaining({ method: "POST" }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      chain: "ETHEREUM",
      primaryContractAddress: PRIMARY,
      relatedContracts: [{ address: A, role: "RELATED" }],
      modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
    })
  })

  it("renders a server error message readably (no raw JSON) and does not navigate", async () => {
    const fetchMock = mockFetch(400, {
      error: "unsupported_chain_for_plan_03",
      message: "Plan 03 only supports ETHEREUM scans.",
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<MultiContractForm initialPrimary={PRIMARY} />)
    await act(async () => {
      fireEvent.click(scanButton())
    })

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument())
    expect(screen.getByText(/only supports ethereum/i)).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })
})
