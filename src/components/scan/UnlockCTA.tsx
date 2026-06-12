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
        callbackUrl: `/scan/${scanId}?unlock=true`,
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
        role="status"
        aria-live="polite"
        className="sonar-card p-8 text-center space-y-3"
      >
        <h2 id="unlock-sent" className="font-display text-xl font-semibold text-sonar">
          Check your email
        </h2>
        <p className="text-sonar-muted">
          We sent a magic link to <span className="text-foam font-data">{state.email}</span>.
          Click the link to unlock your scan findings.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="unlock-heading"
      className="sonar-card p-8 space-y-4"
    >
      <div>
        <h2 id="unlock-heading" className="font-display text-xl font-semibold text-foam">
          Get notified when detection completes
        </h2>
        <p className="text-sm text-sonar-muted mt-2">
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
          className="sonar-input flex-1 appearance-none rounded-lg px-4 py-3 text-sm disabled:opacity-[0.85]"
        />
        <button
          type="submit"
          disabled={state.kind === "submitting" || !email.trim()}
          className="sonar-btn rounded-lg px-6 py-3 font-bold whitespace-nowrap"
        >
          {state.kind === "submitting" ? "Sending..." : "Send magic link"}
        </button>
      </form>

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-red">
          {state.message}
        </p>
      )}
    </section>
  )
}
