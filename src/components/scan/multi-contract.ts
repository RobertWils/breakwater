import { isValidAddress, normalizeAddress } from "@/lib/addresses"
import { MAX_RELATED_CONTRACTS } from "@/lib/config"
import {
  RelatedContractRole,
  validateRelatedContracts,
  type RelatedContractInput,
  type RelatedContractRoleValue,
} from "@/lib/schemas/scan"

/**
 * Plan 04 Phase D.2 — pure client-side helpers for the multi-contract input.
 * Mirrors the Plan 03 §4.1 backend contract by REUSING the real schema pieces
 * (`RelatedContractRole`, `validateRelatedContracts`, `isValidAddress`,
 * `MAX_RELATED_CONTRACTS`) — no parallel types. UI-only; no network here.
 */

export const CHAIN = "ETHEREUM" as const

export const DEFAULT_RELATED_ROLE: RelatedContractRoleValue = "RELATED"

/** A related-contract input row in the form. */
export interface RelatedRow {
  id: string
  address: string
  role: RelatedContractRoleValue
}

/**
 * Role select order: RELATED first (the low-friction default), then the
 * optional refinements. Sourced from the zod enum so it can't drift from the
 * backend's accepted set.
 */
export const RELATED_ROLE_ORDER: RelatedContractRoleValue[] = [
  "RELATED",
  ...RelatedContractRole.options.filter((r) => r !== "RELATED"),
]

export const ROLE_LABELS: Record<RelatedContractRoleValue, string> = {
  RELATED: "Related",
  PROXY_IMPLEMENTATION: "Proxy impl.",
  TIMELOCK: "Timelock",
  DECLARED_MULTISIG: "Multisig",
  DECLARED_BRIDGE: "Bridge",
  TOKEN_CONTRACT: "Token",
}

export function isValidEvmAddress(address: string): boolean {
  return isValidAddress(CHAIN, address)
}

/** Tokenize pasted text into candidate addresses (one per line / comma / space). */
export function parsePastedAddresses(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
}

export interface PasteResult {
  /** New rows to append (valid, unique, within the remaining limit). */
  added: RelatedRow[]
  duplicateCount: number // matched the primary, an existing row, or earlier in the batch
  invalidCount: number // failed the 0x+40hex check
  skippedAtLimit: number // valid + unique but no slots left (MAX_RELATED_CONTRACTS)
}

/**
 * Parse pasted text into new RELATED rows, deduped (against the primary, the
 * existing rows, and within the batch) and capped at MAX_RELATED_CONTRACTS.
 * Pure — the caller supplies `makeId`.
 */
export function buildPastedRows(params: {
  text: string
  existing: RelatedRow[]
  primary: string
  makeId: () => string
}): PasteResult {
  const { text, existing, primary, makeId } = params
  const remaining = Math.max(0, MAX_RELATED_CONTRACTS - existing.length)

  const seen = new Set<string>()
  if (isValidEvmAddress(primary)) seen.add(normalizeAddress(CHAIN, primary))
  for (const row of existing) {
    if (isValidEvmAddress(row.address)) seen.add(normalizeAddress(CHAIN, row.address))
  }

  const added: RelatedRow[] = []
  let duplicateCount = 0
  let invalidCount = 0
  let skippedAtLimit = 0

  for (const token of parsePastedAddresses(text)) {
    if (!isValidEvmAddress(token)) {
      invalidCount++
      continue
    }
    const norm = normalizeAddress(CHAIN, token)
    if (seen.has(norm)) {
      duplicateCount++
      continue
    }
    if (added.length >= remaining) {
      skippedAtLimit++
      continue
    }
    seen.add(norm)
    added.push({ id: makeId(), address: token.trim(), role: DEFAULT_RELATED_ROLE })
  }

  return { added, duplicateCount, invalidCount, skippedAtLimit }
}

/** Mark which rows duplicate the primary or an earlier row (case-insensitive). */
export function duplicateRowIds(primary: string, rows: RelatedRow[]): Set<string> {
  const dupes = new Set<string>()
  const seen = new Set<string>()
  if (isValidEvmAddress(primary)) seen.add(normalizeAddress(CHAIN, primary))
  for (const row of rows) {
    if (!isValidEvmAddress(row.address)) continue
    const norm = normalizeAddress(CHAIN, row.address)
    if (seen.has(norm)) dupes.add(row.id)
    else seen.add(norm)
  }
  return dupes
}

/** The submission shape D.3 will POST to /api/scan (mirrors ScanSubmissionSchema). */
export interface MultiContractSubmission {
  chain: typeof CHAIN
  primaryContractAddress: string
  relatedContracts: { address: string; role: RelatedContractRoleValue }[]
}

export type BuildSubmissionResult =
  | { ok: true; submission: MultiContractSubmission }
  | { ok: false; code: "invalid_primary" }
  | { ok: false; code: "invalid_related"; ids: string[] }
  | {
      ok: false
      code: "primary_address_in_related"
      address: string
      role: RelatedContractRoleValue
    }

/**
 * Produce the full { primary, relatedContracts[] } submission in schema form,
 * applying the §4.1 dedup/conflict rules via the real
 * `validateRelatedContracts`. Blank rows are dropped; non-blank invalid rows
 * are an error. This is what D.3 hands to /api/scan.
 */
export function buildSubmission(
  primary: string,
  rows: RelatedRow[],
): BuildSubmissionResult {
  if (!isValidEvmAddress(primary)) return { ok: false, code: "invalid_primary" }

  const nonEmpty = rows.filter((r) => r.address.trim().length > 0)
  const invalid = nonEmpty.filter((r) => !isValidEvmAddress(r.address))
  if (invalid.length > 0) {
    return { ok: false, code: "invalid_related", ids: invalid.map((r) => r.id) }
  }

  const inputs: RelatedContractInput[] = nonEmpty.map((r) => ({
    address: r.address.trim(),
    role: r.role,
    crossChainTwins: [],
  }))

  const result = validateRelatedContracts(primary.trim(), inputs)
  if (!result.ok) {
    return {
      ok: false,
      code: "primary_address_in_related",
      address: result.details.address,
      role: result.details.role,
    }
  }

  return {
    ok: true,
    submission: {
      chain: CHAIN,
      primaryContractAddress: primary.trim(),
      relatedContracts: result.normalized.map((n) => ({
        address: n.address,
        role: n.role,
      })),
    },
  }
}
