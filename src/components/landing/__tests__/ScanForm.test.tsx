import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react"
import { ScanForm } from "../ScanForm"

// Helper: create a fetch mock that resolves with a given status + body
function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    status,
    json: () => Promise.resolve(body),
  })
}

// Helper: create a fetch mock that rejects (network error)
function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new Error("Failed to fetch"))
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  cleanup()
})

describe("ScanForm", () => {
  // ── 1. Initial render ────────────────────────────────────────────────────
  it("renders with default chain ETHEREUM and submit button disabled when address is empty", () => {
    render(<ScanForm />)

    const chainSelect = screen.getByLabelText("Chain") as HTMLSelectElement
    expect(chainSelect.value).toBe("ETHEREUM")

    const submitButton = screen.getByRole("button", { name: /scan for free/i })
    expect(submitButton).toBeDisabled()
  })

  // ── 2. Chain switching updates placeholder ───────────────────────────────
  it("chain dropdown switches to SOLANA and updates address placeholder", () => {
    render(<ScanForm />)

    const chainSelect = screen.getByLabelText("Chain")
    const addressInput = screen.getByLabelText("Protocol address") as HTMLInputElement

    // Initially Ethereum placeholder
    expect(addressInput.placeholder).toBe("0x...")

    fireEvent.change(chainSelect, { target: { value: "SOLANA" } })

    expect((chainSelect as HTMLSelectElement).value).toBe("SOLANA")
    expect(addressInput.placeholder).toBe("Solana address")
  })

  // ── 3. Empty address → button disabled, no fetch ─────────────────────────
  it("submit button is disabled when address is empty and does not call fetch on click", () => {
    const fetchMock = mockFetch(202, { scanId: "abc" })
    vi.stubGlobal("fetch", fetchMock)

    render(<ScanForm />)

    const submitButton = screen.getByRole("button", { name: /scan for free/i })
    expect(submitButton).toBeDisabled()

    // Clicking a disabled button should not trigger form submission
    fireEvent.click(submitButton)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  // ── 4. 202 success state ─────────────────────────────────────────────────
  it("submit returning 202 shows success state with scanId and 'Submit another scan' button", async () => {
    const fetchMock = mockFetch(202, { scanId: "scan-abc-123" })
    vi.stubGlobal("fetch", fetchMock)

    render(<ScanForm />)

    const addressInput = screen.getByLabelText("Protocol address")
    fireEvent.change(addressInput, { target: { value: "0xdeadbeef1234567890abcdef1234567890abcdef" } })

    const submitButton = screen.getByRole("button", { name: /scan for free/i })
    await act(async () => {
      fireEvent.click(submitButton)
    })

    await waitFor(() => {
      expect(screen.getByText("Scan queued")).toBeInTheDocument()
    })

    expect(screen.getByText(/scan-abc-123/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /submit another scan/i })).toBeInTheDocument()
  })

  // ── 5. "Submit another scan" resets to idle with empty address ───────────
  it("clicking 'Submit another scan' resets to idle with empty address", async () => {
    const fetchMock = mockFetch(202, { scanId: "scan-xyz-456" })
    vi.stubGlobal("fetch", fetchMock)

    render(<ScanForm />)

    const addressInput = screen.getByLabelText("Protocol address")
    fireEvent.change(addressInput, { target: { value: "0xdeadbeef1234567890abcdef1234567890abcdef" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /scan for free/i }))
    })

    await waitFor(() => {
      expect(screen.getByText("Scan queued")).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: /submit another scan/i }))

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /scan for free/i })).toBeInTheDocument()
    })

    const newAddressInput = screen.getByLabelText("Protocol address") as HTMLInputElement
    expect(newAddressInput.value).toBe("")
  })

  // ── 6. 400 invalid_address → shows data.message ─────────────────────────
  it("submit returning 400 invalid_address shows the server message", async () => {
    const fetchMock = mockFetch(400, {
      error: "invalid_address",
      message: "Address is not a valid Ethereum address",
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ScanForm />)

    const addressInput = screen.getByLabelText("Protocol address")
    fireEvent.change(addressInput, { target: { value: "not-valid" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /scan for free/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument()
    })

    expect(screen.getByText("Address is not a valid Ethereum address")).toBeInTheDocument()
  })

  // ── 7. 409 curated_protocol → shows message + demoUrl link ──────────────
  it("submit returning 409 curated_protocol shows message and demoUrl anchor", async () => {
    const fetchMock = mockFetch(409, {
      error: "curated_protocol",
      message: "This protocol is a Breakwater demo. Cached results available.",
      demoUrl: "/demo/aave",
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ScanForm />)

    const addressInput = screen.getByLabelText("Protocol address")
    fireEvent.change(addressInput, { target: { value: "0xdeadbeef1234567890abcdef1234567890abcdef" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /scan for free/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument()
    })

    expect(screen.getByText("This protocol is a Breakwater demo. Cached results available.")).toBeInTheDocument()

    const demoLink = screen.getByRole("link", { name: /view cached demo results/i })
    expect(demoLink).toBeInTheDocument()
    expect(demoLink).toHaveAttribute("href", "/demo/aave")
  })

  // ── 8. 429 rate_limited → shows message + retry time in minutes ──────────
  it("submit returning 429 rate_limited shows message and retry time in minutes", async () => {
    const fetchMock = mockFetch(429, {
      error: "rate_limited",
      message: "Too many requests from your IP. Try again later.",
      retryAfterSec: 3600,
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ScanForm />)

    const addressInput = screen.getByLabelText("Protocol address")
    fireEvent.change(addressInput, { target: { value: "0xdeadbeef1234567890abcdef1234567890abcdef" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /scan for free/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument()
    })

    expect(screen.getByText("Too many requests from your IP. Try again later.")).toBeInTheDocument()
    // 3600 seconds → ceil(3600/60) = 60 minutes
    expect(screen.getByText(/try again in 60 minute\(s\)/i)).toBeInTheDocument()
  })

  // ── 9. 500 → fallback uses data.error / data.message ────────────────────
  it("submit returning 500 uses server data.message in the error fallback", async () => {
    const fetchMock = mockFetch(500, {
      error: "internal_error",
      message: "An unexpected error occurred",
    })
    vi.stubGlobal("fetch", fetchMock)

    render(<ScanForm />)

    const addressInput = screen.getByLabelText("Protocol address")
    fireEvent.change(addressInput, { target: { value: "0xdeadbeef1234567890abcdef1234567890abcdef" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /scan for free/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument()
    })

    expect(screen.getByText("An unexpected error occurred")).toBeInTheDocument()
  })

  // ── 10. Network error → "Network error" message ──────────────────────────
  it("fetch throwing a network error shows the network error message", async () => {
    vi.stubGlobal("fetch", mockFetchNetworkError())

    render(<ScanForm />)

    const addressInput = screen.getByLabelText("Protocol address")
    fireEvent.change(addressInput, { target: { value: "0xdeadbeef1234567890abcdef1234567890abcdef" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /scan for free/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument()
    })

    expect(screen.getByText("Network error. Check your connection and try again.")).toBeInTheDocument()
  })
})
