"use client"

import { useState } from "react"
import type { FormEvent } from "react"

type Chain = "ETHEREUM" | "SOLANA"
type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; scanId: string }
  | { kind: "error"; code: string; message: string; retryAfterSec?: number; demoUrl?: string }

export function ScanForm() {
  const [chain, setChain] = useState<Chain>("ETHEREUM")
  const [address, setAddress] = useState("")
  const [state, setState] = useState<FormState>({ kind: "idle" })

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (state.kind === "submitting") return
    setState({ kind: "submitting" })

    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chain,
          primaryContractAddress: address.trim(),
          modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
        }),
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 202 || res.status === 200) {
        setState({ kind: "success", scanId: data.scanId })
        return
      }
      if (res.status === 400) {
        setState({ kind: "error", code: data.error ?? "bad_request", message: data.message ?? "Invalid submission" })
        return
      }
      if (res.status === 409) {
        setState({
          kind: "error",
          code: data.error ?? "conflict",
          message: data.message ?? "This protocol is a Breakwater demo. Cached results available.",
          demoUrl: typeof data.demoUrl === "string" ? data.demoUrl : undefined,
        })
        return
      }
      if (res.status === 429) {
        setState({
          kind: "error",
          code: data.error ?? "rate_limited",
          message: data.message ?? "Too many requests. Try again later.",
          retryAfterSec: typeof data.retryAfterSec === "number" ? data.retryAfterSec : undefined,
        })
        return
      }
      // Fallback (500 or any other): use server error/message if present.
      setState({
        kind: "error",
        code: data.error ?? "unknown",
        message: data.message ?? "Something went wrong. Please try again.",
      })
    } catch {
      setState({ kind: "error", code: "network", message: "Network error. Check your connection and try again." })
    }
  }

  if (state.kind === "success") {
    return (
      <div className="glass-card-teal p-8 space-y-4">
        <h2 className="text-2xl font-semibold text-teal">Scan queued</h2>
        <p className="text-muted">Your scan has been received and is in the queue.</p>
        <div className="font-mono text-sm text-muted break-all">Scan ID: {state.scanId}</div>
        <p className="text-sm text-muted pt-2 border-t border-subtle">
          Results will be available once our detectors complete. The scan results page is coming in a future release.
        </p>
        <button
          onClick={() => { setState({ kind: "idle" }); setAddress("") }}
          className="text-sm text-sky hover:underline"
        >
          Submit another scan →
        </button>
      </div>
    )
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="glass-card-teal p-8 space-y-5">
        <h2 className="text-2xl font-semibold">Free scan</h2>

        <div className="space-y-2">
          <label htmlFor="chain" className="block text-sm font-medium text-muted">Chain</label>
          <select
            id="chain"
            value={chain}
            onChange={(e) => setChain(e.target.value as Chain)}
            disabled={state.kind === "submitting"}
            className="w-full px-4 py-3 bg-elevated/50 border border-subtle rounded-lg text-primary focus:border-teal focus:outline-none disabled:opacity-50"
          >
            <option value="ETHEREUM">Ethereum</option>
            <option value="SOLANA">Solana</option>
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="address" className="block text-sm font-medium text-muted">Primary contract address</label>
          <input
            id="address"
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={chain === "ETHEREUM" ? "0x..." : "Solana address"}
            disabled={state.kind === "submitting"}
            required
            className="w-full px-4 py-3 bg-elevated/50 border border-subtle rounded-lg text-primary placeholder:text-muted/50 font-mono focus:border-teal focus:outline-none disabled:opacity-50"
          />
        </div>

        {state.kind === "error" && (
          <div role="alert" className="p-4 bg-sev-critical/10 border border-sev-critical/30 rounded-lg space-y-2">
            <p className="text-sm text-sev-critical font-medium">{state.message}</p>
            {state.retryAfterSec !== undefined && (
              <p className="text-xs text-muted">
                Try again in {Math.ceil(state.retryAfterSec / 60)} minute(s).
              </p>
            )}
            {state.demoUrl && (
              <a href={state.demoUrl} className="inline-block text-sm text-sky hover:underline">
                View cached demo results →
              </a>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={state.kind === "submitting" || !address.trim()}
          className="w-full px-6 py-4 bg-teal text-[#0C1C3A] font-semibold rounded-lg hover:bg-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {state.kind === "submitting" ? "Scanning..." : "Scan for free"}
        </button>
      </form>

      <p className="text-xs text-muted text-center mt-4">
        Free scan · No signup required · Results in under 60 seconds
      </p>
    </div>
  )
}
