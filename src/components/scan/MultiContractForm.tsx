"use client"

import { useRef, useState, type FormEvent } from "react"
import { MAX_RELATED_CONTRACTS } from "@/lib/config"
import {
  buildPastedRows,
  buildSubmission,
  duplicateRowIds,
  isValidEvmAddress,
  DEFAULT_RELATED_ROLE,
  RELATED_ROLE_ORDER,
  ROLE_LABELS,
  type MultiContractSubmission,
  type RelatedRow,
} from "./multi-contract"

/**
 * Plan 04 Phase D.2 — the multi-contract scan input (UI + client validation).
 * Local state only; no network. `buildSubmission` produces the schema-shaped
 * { chain, primaryContractAddress, relatedContracts[] } that D.3 will POST to
 * /api/scan via `onSubmit`. Sonar styling mirrors the landing scan card.
 */

interface MultiContractFormProps {
  /** D.3 wires this to POST /api/scan. Absent in D.2 (validation-only). */
  onSubmit?: (submission: MultiContractSubmission) => void
}

const ADDRESS_PLACEHOLDER = "0x…"

export function MultiContractForm({ onSubmit }: MultiContractFormProps) {
  const [primary, setPrimary] = useState("")
  const [rows, setRows] = useState<RelatedRow[]>([
    { id: "row-1", address: "", role: DEFAULT_RELATED_ROLE },
  ])
  const [showPaste, setShowPaste] = useState(false)
  const [pasteText, setPasteText] = useState("")
  const [pasteFeedback, setPasteFeedback] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const idRef = useRef(2)
  const makeId = () => `row-${idRef.current++}`

  const remaining = MAX_RELATED_CONTRACTS - rows.length
  const atLimit = remaining <= 0
  const primaryValid = isValidEvmAddress(primary)
  const primaryShowError = primary.trim().length > 0 && !primaryValid
  const dupes = duplicateRowIds(primary, rows)

  function addRow() {
    if (atLimit) return
    setRows((rs) => [...rs, { id: makeId(), address: "", role: DEFAULT_RELATED_ROLE }])
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  function updateAddress(id: string, address: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, address } : r)))
  }

  function updateRole(id: string, role: RelatedRow["role"]) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, role } : r)))
  }

  function applyPaste() {
    const result = buildPastedRows({ text: pasteText, existing: rows, primary, makeId })
    if (result.added.length > 0) setRows((rs) => [...rs, ...result.added])

    const parts: string[] = []
    if (result.added.length > 0) parts.push(`Added ${result.added.length}`)
    if (result.duplicateCount > 0) parts.push(`${result.duplicateCount} duplicate skipped`)
    if (result.invalidCount > 0) parts.push(`${result.invalidCount} invalid skipped`)
    if (result.skippedAtLimit > 0)
      parts.push(`${result.skippedAtLimit} over the ${MAX_RELATED_CONTRACTS} limit`)
    setPasteFeedback(parts.length > 0 ? parts.join(" · ") : "No addresses found")

    if (result.added.length > 0) {
      setPasteText("")
      setShowPaste(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const result = buildSubmission(primary, rows)
    if (!result.ok) {
      if (result.code === "invalid_primary") {
        setSubmitError("Enter a valid 0x… protocol address.")
      } else if (result.code === "invalid_related") {
        setSubmitError("Some related addresses are invalid — use 0x + 40 hex characters.")
      } else {
        setSubmitError(
          `The primary address can't also be added as a ${ROLE_LABELS[result.role]} contract.`,
        )
      }
      return
    }
    setSubmitError(null)
    onSubmit?.(result.submission) // D.3 wires the POST; no-op in D.2
  }

  return (
    <form onSubmit={handleSubmit} autoComplete="off" className="sonar-card space-y-6 p-7">
      {/* ── Primary contract ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="chain" className="label-mono block">
            Chain
          </label>
          <select
            id="chain"
            value="ETHEREUM"
            disabled
            className="sonar-input w-full appearance-none rounded-lg px-4 py-3 text-sm disabled:opacity-[0.85]"
          >
            <option value="ETHEREUM">Ethereum</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="primary-address" className="label-mono block">
            Protocol address <span className="text-sonar">·&nbsp;primary</span>
          </label>
          <input
            id="primary-address"
            type="text"
            name="primary-address"
            autoComplete="off"
            spellCheck={false}
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            placeholder={ADDRESS_PLACEHOLDER}
            aria-invalid={primaryShowError}
            className="sonar-input w-full appearance-none rounded-lg px-4 py-3 text-sm"
          />
          {primaryShowError && (
            <p className="font-data text-[11px] text-red">
              Not a valid address — expected 0x + 40 hex characters.
            </p>
          )}
          <p className="text-xs leading-relaxed text-sonar-muted/80">
            The core contract users interact with — Pool, Router, or Vault.
          </p>
        </div>
      </div>

      {/* ── Related contracts ────────────────────────────────────────────── */}
      <div className="space-y-3 border-t border-[rgba(30,224,176,0.15)] pt-5">
        <div className="flex items-baseline justify-between">
          <label className="label-mono block">Related contracts</label>
          <span className="font-data text-[10.5px] text-sonar-muted">
            {rows.length}/{MAX_RELATED_CONTRACTS}
          </span>
        </div>
        <p className="text-xs leading-relaxed text-sonar-muted/80">
          Proxy, timelock, guardian, bridge — the contracts your protocol depends on. Role
          defaults to Related; refine it only if you want.
        </p>

        <div className="space-y-2">
          {rows.map((r) => {
            const showInvalid = r.address.trim().length > 0 && !isValidEvmAddress(r.address)
            const isDup = dupes.has(r.id)
            return (
              <div key={r.id} className="space-y-1">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={r.address}
                    onChange={(e) => updateAddress(r.id, e.target.value)}
                    placeholder={ADDRESS_PLACEHOLDER}
                    aria-label="Related contract address"
                    aria-invalid={showInvalid || isDup}
                    className="sonar-input min-w-0 flex-1 appearance-none rounded-lg px-3 py-2.5 text-sm"
                  />
                  <select
                    value={r.role}
                    onChange={(e) => updateRole(r.id, e.target.value as RelatedRow["role"])}
                    aria-label="Related contract role"
                    className="sonar-input w-[116px] shrink-0 appearance-none rounded-lg px-2.5 py-2.5 text-xs text-sonar-muted"
                  >
                    {RELATED_ROLE_ORDER.map((role) => (
                      <option key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeRow(r.id)}
                    aria-label="Remove contract"
                    className="shrink-0 rounded-md px-2 py-2 text-sonar-muted transition-colors hover:text-red"
                  >
                    ✕
                  </button>
                </div>
                {showInvalid && (
                  <p className="font-data text-[11px] text-red">Invalid address (0x + 40 hex).</p>
                )}
                {!showInvalid && isDup && (
                  <p className="font-data text-[11px] text-amber">
                    Duplicate — already added (or the primary). It will be merged.
                  </p>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={addRow}
            disabled={atLimit}
            className="font-data text-[12px] uppercase tracking-[0.08em] text-sonar transition-colors hover:text-foam disabled:cursor-not-allowed disabled:text-sonar-muted/40"
          >
            + add contract
          </button>
          <button
            type="button"
            onClick={() => setShowPaste((v) => !v)}
            className="font-data text-[12px] uppercase tracking-[0.08em] text-sonar-muted transition-colors hover:text-sonar"
          >
            {showPaste ? "− close paste" : "⊕ paste multiple"}
          </button>
          {atLimit && (
            <span className="font-data text-[10.5px] text-amber">
              Limit of {MAX_RELATED_CONTRACTS} reached
            </span>
          )}
        </div>

        {showPaste && (
          <div className="space-y-2">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              placeholder={"Paste addresses — one per line\n0x…\n0x…"}
              aria-label="Paste multiple addresses"
              className="sonar-input w-full appearance-none rounded-lg px-3 py-2.5 text-sm"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={applyPaste}
                disabled={atLimit || pasteText.trim().length === 0}
                className="font-data rounded-md border border-sonar/30 px-3 py-1.5 text-[12px] uppercase tracking-[0.08em] text-sonar transition-colors hover:bg-sonar/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add pasted
              </button>
              {pasteFeedback && (
                <span className="font-data text-[10.5px] text-sonar-muted">{pasteFeedback}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Submit ───────────────────────────────────────────────────────── */}
      {submitError && (
        <div role="alert" className="rounded-lg border border-red/30 bg-red/10 p-3">
          <p className="text-sm font-medium text-red">{submitError}</p>
        </div>
      )}
      <button
        type="submit"
        disabled={!primaryValid}
        className="sonar-btn w-full rounded-lg px-6 py-3.5 text-[15px] font-bold"
      >
        Scan protocol →
      </button>
      <p className="font-data text-center text-[10.5px] text-sonar-muted/75">
        No signup · Results in &lt; 60 seconds
      </p>
    </form>
  )
}
