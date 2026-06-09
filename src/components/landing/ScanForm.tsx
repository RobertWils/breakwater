"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { FormEvent, ReactNode } from "react"

type Chain = "ETHEREUM" | "SOLANA"
type FormState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; code: string; message: string; retryAfterSec?: number; demoUrl?: string }

/**
 * `idPrefix` keeps element ids unique when the form is rendered more than
 * once on a page (e.g. the desktop cockpit + the mobile layout both mount it).
 * Defaults to "" so existing single-instance usage + tests are unchanged.
 *
 * `statSlot` renders extra content INSIDE the card after the foot line (G1f's
 * rotating stat block lives in the card, not as a loose block beneath it).
 */
export function ScanForm({
  idPrefix = "",
  statSlot,
}: { idPrefix?: string; statSlot?: ReactNode } = {}) {
  const router = useRouter()
  const [chain, setChain] = useState<Chain>("ETHEREUM")
  const [address, setAddress] = useState("")
  const [state, setState] = useState<FormState>({ kind: "idle" })
  const chainId = `${idPrefix}chain`
  const addressId = `${idPrefix}address`

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
        router.push(`/scan/${data.scanId}`)
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

  return (
    <div>
      <form onSubmit={handleSubmit} autoComplete="off" className="sonar-card p-7 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold text-foam">Scan a protocol</h3>
          <span className="sonar-badge">Free scan</span>
        </div>
        <p className="font-data flex items-center gap-2 text-[11px] text-sonar">
          <span className="inline-block h-[7px] w-[7px] rounded-full bg-sonar animate-pulse" />
          sonar active · listening
        </p>

        <div className="space-y-2">
          <label htmlFor={chainId} className="label-mono block">Chain</label>
          <select
            id={chainId}
            value={chain}
            onChange={(e) => setChain(e.target.value as Chain)}
            disabled={state.kind === "submitting"}
            className="sonar-input w-full appearance-none rounded-lg px-4 py-3 text-sm disabled:opacity-[0.85]"
          >
            <option value="ETHEREUM">Ethereum</option>
            <option value="SOLANA">Solana</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor={addressId} className="label-mono block">Protocol address</label>
          <input
            id={addressId}
            type="text"
            name="contract-address"
            autoComplete="off"
            spellCheck={false}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={chain === "ETHEREUM" ? "0x..." : "Solana address"}
            disabled={state.kind === "submitting"}
            required
            className="sonar-input w-full appearance-none rounded-lg px-4 py-3 text-sm disabled:opacity-[0.85]"
          />
          <p className="text-xs text-sonar-muted/80 leading-relaxed">
            {chain === "ETHEREUM"
              ? "The core contract users interact with — Pool, Router, or Vault. Not a user wallet or token address."
              : "The program address of your protocol — the main program handling deposits, trades, or governance. Not a wallet or token mint."}
          </p>
        </div>

        {state.kind === "error" && (
          <div role="alert" className="p-4 bg-red/10 border border-red/30 rounded-lg space-y-2">
            <p className="text-sm text-red font-medium">{state.message}</p>
            {state.retryAfterSec !== undefined && (
              <p className="text-xs text-sonar-muted">
                Try again in {Math.ceil(state.retryAfterSec / 60)} minute(s).
              </p>
            )}
            {state.demoUrl && (
              <a href={state.demoUrl} className="inline-block text-sm text-sonar hover:underline">
                View cached demo results →
              </a>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={state.kind === "submitting" || !address.trim()}
          className="sonar-btn w-full rounded-lg px-6 py-3.5 text-[15px] font-bold"
        >
          {state.kind === "submitting" ? "Scanning..." : "Scan for free →"}
        </button>

        <p className="font-data text-center text-[10.5px] text-sonar-muted/75">
          No signup · Results in &lt; 60 seconds
        </p>

        {statSlot}
      </form>
    </div>
  )
}
