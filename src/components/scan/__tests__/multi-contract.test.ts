// @vitest-environment node
import { describe, it, expect } from "vitest"

import {
  buildPastedRows,
  buildSubmission,
  duplicateRowIds,
  parsePastedAddresses,
  type RelatedRow,
} from "../multi-contract"
import { MAX_RELATED_CONTRACTS } from "@/lib/config"

// Deterministic id generator for tests.
function idGen() {
  let n = 0
  return () => `r${n++}`
}

// Valid 0x+40hex addresses (distinct).
const A = "0x" + "a".repeat(40)
const B = "0x" + "b".repeat(40)
const C = "0x" + "c".repeat(40)
const PRIMARY = "0x" + "1".repeat(40)

function row(address: string, role: RelatedRow["role"] = "RELATED", id = address): RelatedRow {
  return { id, address, role }
}

describe("parsePastedAddresses", () => {
  it("splits on newlines, commas, and whitespace; trims; drops blanks", () => {
    const text = `  ${A}\n${B} , ${C}\n\n  `
    expect(parsePastedAddresses(text)).toEqual([A, B, C])
  })

  it("returns [] for empty / whitespace-only input", () => {
    expect(parsePastedAddresses("")).toEqual([])
    expect(parsePastedAddresses("   \n  ")).toEqual([])
  })
})

describe("buildPastedRows — dedup + limit", () => {
  it("adds valid unique addresses as RELATED rows", () => {
    const r = buildPastedRows({ text: `${A}\n${B}`, existing: [], primary: PRIMARY, makeId: idGen() })
    expect(r.added).toHaveLength(2)
    expect(r.added.every((x) => x.role === "RELATED")).toBe(true)
    expect(r.added.map((x) => x.address)).toEqual([A, B])
  })

  it("drops invalid tokens and counts them", () => {
    const r = buildPastedRows({ text: `${A}\nnot-an-address\n0x123`, existing: [], primary: PRIMARY, makeId: idGen() })
    expect(r.added).toHaveLength(1)
    expect(r.invalidCount).toBe(2)
  })

  it("dedupes against the primary, existing rows, and within the batch (case-insensitive)", () => {
    const r = buildPastedRows({
      text: `${A}\n${A.toUpperCase()}\n${B}\n${PRIMARY}`,
      existing: [row(B)],
      primary: PRIMARY,
      makeId: idGen(),
    })
    // A added once; A again (uppercase) = dup; B already exists = dup; PRIMARY = dup.
    expect(r.added.map((x) => x.address)).toEqual([A])
    expect(r.duplicateCount).toBe(3)
  })

  it("respects MAX_RELATED_CONTRACTS — skips overflow and counts it", () => {
    const existing = Array.from({ length: MAX_RELATED_CONTRACTS - 1 }, (_, i) =>
      row("0x" + i.toString(16).padStart(40, "0"), "RELATED", `e${i}`),
    )
    // Two fresh valid addresses, only one slot left.
    const r = buildPastedRows({ text: `${A}\n${B}`, existing, primary: PRIMARY, makeId: idGen() })
    expect(r.added).toHaveLength(1)
    expect(r.skippedAtLimit).toBe(1)
  })
})

describe("duplicateRowIds", () => {
  it("flags rows duplicating the primary or an earlier row", () => {
    const rows = [row(A, "RELATED", "1"), row(A, "RELATED", "2"), row(PRIMARY, "RELATED", "3"), row(B, "RELATED", "4")]
    const dupes = duplicateRowIds(PRIMARY, rows)
    expect(dupes.has("2")).toBe(true) // second A
    expect(dupes.has("3")).toBe(true) // equals primary
    expect(dupes.has("1")).toBe(false)
    expect(dupes.has("4")).toBe(false)
  })
})

describe("buildSubmission — schema-shaped output + §4.1 rules", () => {
  it("rejects an invalid/empty primary", () => {
    expect(buildSubmission("", [])).toEqual({ ok: false, code: "invalid_primary" })
    expect(buildSubmission("0xnope", [])).toEqual({ ok: false, code: "invalid_primary" })
  })

  it("happy path: produces chain + primary + related in schema form (blank rows dropped)", () => {
    const res = buildSubmission(PRIMARY, [row(A, "TIMELOCK", "1"), row("", "RELATED", "2"), row(B, "RELATED", "3")])
    expect(res).toEqual({
      ok: true,
      submission: {
        chain: "ETHEREUM",
        primaryContractAddress: PRIMARY,
        relatedContracts: [
          { address: A, role: "TIMELOCK" },
          { address: B, role: "RELATED" },
        ],
      },
    })
  })

  it("non-blank invalid related row → error with the offending ids", () => {
    const res = buildSubmission(PRIMARY, [row("0xbad", "RELATED", "bad1"), row(A, "RELATED", "ok")])
    expect(res).toEqual({ ok: false, code: "invalid_related", ids: ["bad1"] })
  })

  it("primary repeated as related with RELATED role → silently deduped", () => {
    const res = buildSubmission(PRIMARY, [row(PRIMARY, "RELATED", "1"), row(A, "RELATED", "2")])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.submission.relatedContracts).toEqual([{ address: A, role: "RELATED" }])
    }
  })

  it("primary repeated as related with a non-default role → conflict", () => {
    const res = buildSubmission(PRIMARY, [row(PRIMARY, "TIMELOCK", "1")])
    expect(res).toEqual({
      ok: false,
      code: "primary_address_in_related",
      address: PRIMARY,
      role: "TIMELOCK",
    })
  })

  it("inter-related duplicate → deduped (first kept)", () => {
    const res = buildSubmission(PRIMARY, [row(A, "TIMELOCK", "1"), row(A, "RELATED", "2")])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.submission.relatedContracts).toEqual([{ address: A, role: "TIMELOCK" }])
    }
  })
})
