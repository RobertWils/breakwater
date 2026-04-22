import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react"
import { UnlockCTA } from "../UnlockCTA"

const mockSignIn = vi.fn()
vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}))

beforeEach(() => {
  mockSignIn.mockReset()
})

afterEach(() => {
  cleanup()
})

describe("UnlockCTA", () => {
  it("renders initial heading and disabled submit button when email empty", () => {
    render(<UnlockCTA scanId="abc" />)
    expect(screen.getByRole("heading", { name: /get notified/i })).toBeInTheDocument()
    const button = screen.getByRole("button", { name: /send magic link/i })
    expect(button).toBeDisabled()
  })

  it("submits signIn with callbackUrl=/scan/[id] and lowercased email", async () => {
    mockSignIn.mockResolvedValue({ error: undefined })
    render(<UnlockCTA scanId="scan-xyz" />)

    const input = screen.getByLabelText(/email address/i)
    fireEvent.change(input, { target: { value: "Foo@Bar.COM" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send magic link/i }))
    })

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith("email", {
        email: "foo@bar.com",
        callbackUrl: "/scan/scan-xyz",
        redirect: false,
      })
    })
  })

  it("shows 'Check your email' sent state after successful submit", async () => {
    mockSignIn.mockResolvedValue({ error: undefined })
    render(<UnlockCTA scanId="abc" />)

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "user@example.com" },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send magic link/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /check your email/i })).toBeInTheDocument()
    })
    expect(screen.getByText("user@example.com")).toBeInTheDocument()
  })

  it("shows error when signIn returns error", async () => {
    mockSignIn.mockResolvedValue({ error: "EmailSignin" })
    render(<UnlockCTA scanId="abc" />)

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "user@example.com" },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send magic link/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/couldn't send magic link/i)
    })
  })

  it("shows network error when signIn rejects", async () => {
    mockSignIn.mockRejectedValue(new Error("network down"))
    render(<UnlockCTA scanId="abc" />)

    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: "user@example.com" },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send magic link/i }))
    })

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/network error/i)
    })
  })
})
