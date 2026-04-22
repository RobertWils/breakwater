"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"

interface UnlockCTAProps {
  scanId: string
}

type CTAState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string }

export function UnlockCTA({ scanId }: UnlockCTAProps) {
  const [email, setEmail] = useState("")
  const [state, setState] = useState<CTAState>({ kind: "idle" })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (state.kind === "submitting") return

    setState({ kind: "submitting" })

    try {
      const result = await signIn("email", {
        email: email.trim().toLowerCase(),
        callbackUrl: `/scan/${scanId}`,
        redirect: false,
      })

      if (result?.error) {
        setState({
          kind: "error",
          message: "Couldn't send magic link. Please try again.",
        })
        return
      }

      setState({ kind: "sent", email: email.trim().toLowerCase() })
    } catch {
      setState({
        kind: "error",
        message: "Network error. Please try again.",
      })
    }
  }

  if (state.kind === "sent") {
    return (
      <section
        aria-labelledby="unlock-sent"
        className="glass-card-teal p-8 text-center space-y-3"
      >
        <h2 id="unlock-sent" className="text-xl font-semibold text-teal">
          Check your email
        </h2>
        <p className="text-muted">
          We sent a magic link to <span className="text-primary font-mono">{state.email}</span>.
          Click the link to unlock your scan findings.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="unlock-heading"
      className="glass-card-teal p-8 space-y-4"
    >
      <div>
        <h2 id="unlock-heading" className="text-xl font-semibold text-primary">
          Get notified when detection completes
        </h2>
        <p className="text-sm text-muted mt-2">
          Enter your email to unlock full scan findings when our detectors go live.
          No signup friction — one magic link, always free.
        </p>
      </div>

      <form onSubmit={handleSubmit} autoComplete="off" className="flex flex-col sm:flex-row gap-3">
        <label htmlFor="unlock-email" className="sr-only">
          Email address
        </label>
        <input
          id="unlock-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          disabled={state.kind === "submitting"}
          autoComplete="email"
          className="flex-1 px-4 py-3 bg-[#0C1C3A] border border-subtle rounded-lg text-primary placeholder:text-muted font-mono focus:border-teal focus:outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={state.kind === "submitting" || !email.trim()}
          className="px-6 py-3 bg-teal text-[#0C1C3A] font-semibold rounded-lg hover:bg-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
        >
          {state.kind === "submitting" ? "Sending..." : "Send magic link"}
        </button>
      </form>

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-sev-critical">
          {state.message}
        </p>
      )}
    </section>
  )
}
