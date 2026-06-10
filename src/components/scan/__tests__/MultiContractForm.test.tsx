import { describe, it, expect, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { MultiContractForm } from "../MultiContractForm"

afterEach(() => cleanup())

const VALID = "0x" + "1".repeat(40)

function primaryInput() {
  return screen.getByLabelText(/protocol address/i)
}
function scanButton() {
  return screen.getByRole("button", { name: /scan protocol/i })
}
function relatedAddressInputs() {
  return screen.getAllByLabelText("Related contract address")
}

describe("MultiContractForm", () => {
  it("disables the scan button until a valid primary address is entered", () => {
    render(<MultiContractForm />)
    expect(scanButton()).toBeDisabled()

    fireEvent.change(primaryInput(), { target: { value: "0xnope" } })
    expect(scanButton()).toBeDisabled()
    expect(screen.getByText(/not a valid address/i)).toBeInTheDocument()

    fireEvent.change(primaryInput(), { target: { value: VALID } })
    expect(scanButton()).toBeEnabled()
  })

  it("adds and removes related rows, with the count reflecting it", () => {
    render(<MultiContractForm />)
    expect(relatedAddressInputs()).toHaveLength(1) // starts with one empty row
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
    fireEvent.change(textarea, {
      target: { value: `${"0x" + "a".repeat(40)}\n${"0x" + "b".repeat(40)}` },
    })
    fireEvent.click(screen.getByRole("button", { name: /add pasted/i }))
    // 1 initial empty row + 2 pasted = 3
    expect(relatedAddressInputs()).toHaveLength(3)
  })
})
