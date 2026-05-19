# Phase G — Status Marker

**Status:** COMPLETE + Codex reviewed + fixed
**Branch:** plan-02-dispatcher
**Closing commit:** see `docs: Phase G status marker (COMPLETE + Codex reviewed)`
**Test count:** 634/634 green

## Sub-task progression

| Sub-task | Commit  | Subject                                                                       |
| -------- | ------- | ----------------------------------------------------------------------------- |
| G.1      | 4be9848 | scan status endpoint + cache-control branching                                |
| G.2      | 843d6a9 | useScanPolling hook                                                           |
| G.3      | bc945c9 | ScanShell client conversion + RUNNING indicators + Plan 03 disclaimer         |
| G.4      | ddb036f | FindingResponse discriminated union                                           |
| G.5      | d546e17 | Codex Phase G review IMPORTANT + N1 + N2                                      |

Test progression: 569 (F.4.3 end) → 580 (G.1) → 597 (G.2) → 616 (G.3) → 622 (G.4) → 634 (G.5).
Net Phase G: +65 tests across 5 commits.

## Codex review summary

Bundled review of G.1+G.2+G.3+G.4 produced:

- 0 BLOCKERs
- 1 IMPORTANT (fixed in G.5: per-module polled status now threads to ModuleCard)
- 2 NICE_TO_HAVEs (both fixed in G.5)
- 4 NON_ISSUEs (verified clean)

## Phase G exit gate audit

Per implementation plan §G exit (L3566):

| Gate item                                                       | Status                                            |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `/scan/[id]` transitions live on preview without refresh        | ⏸️ Deferred to Phase H manual smoke              |
| Polling stops on COMPLETE / FAILED / EXPIRED                    | ✅ G.2 (verified in hook tests)                   |
| `motion-reduce` honored on status indicators                    | ✅ G.3 (ModuleCard pulse)                         |
| `FindingResponse` is a true discriminated union                 | ✅ G.4 (3-way tier discriminator)                 |
| Plan 01 backlog item resolved (finding-shape narrowing)         | ✅ G.4 (NOTES.md updated)                         |
| No regression on Plan 01 `/scan/[id]` tests                     | ✅ Additive changes; all existing tests still green |

5 of 6 gate items met. 1 deferred to Phase H manual preview smoke.

## What Phase G shipped

**API:**

- `GET /api/scan/[id]/status` — lightweight (~200 bytes) status endpoint; UUID gate; `dynamic = "force-dynamic"`; error-only logging (polled every 3 s).
- Cache-Control branching on `/api/scan/[id]` and `/api/scan/[id]/status`:
  - Non-terminal (QUEUED / RUNNING / PARTIAL_COMPLETE) → `no-store`
  - Terminal     (COMPLETE / FAILED / EXPIRED)         → `private, max-age=60`

**Hook (`src/hooks/useScanPolling.ts`):**

- 3 s poll interval, 15 min cap, 5-error bailout.
- Exponential backoff: 1 s → 2 s → 4 s → 8 s, then stop (per spec §7.1). 16 s / 30 s tiers preserved as future-tuning hooks.
- `router.refresh()` on terminal transition (re-fetches full SSR snapshot with findings + grade).
- Returns `{ currentStatus, errorCount, polledModules }`.
- Unmount-safe via closure-local `cancelled` flag.

**UI integration:**

- `ScanShell` converted to `"use client"` and integrates `useScanPolling`.
- Merges `polledModules` over the server snapshot via `useMemo` (preserves all server fields except `status` and `grade`; `grade` only overrides when polled value is non-null to avoid stale-poll blank-outs).
- `ModuleCard` RUNNING pulse — `bg-sky` dot, `animate-pulse motion-reduce:animate-none`, `role="status"` + `aria-live="polite"` + descriptive `aria-label`.
- `CompositePanel` accepts optional `currentStatus` override (additive prop) so status copy reflects polling without waiting for the server refresh.
- `ProtocolGraphDisclaimer` — Plan 03+ scope-clarification banner above the composite. Left-border accent (no icon — no icon library shipped in Plan 02).
- `FindingsList` status-aware empty copy:
  - COMPLETE → "No findings detected."
  - FAILED   → "Scan failed. Findings unavailable."
  - EXPIRED  → "This scan has expired. Findings are no longer available."
  - Default  → "Results will appear here when detection completes."

**Type safety:**

- `FindingResponse` converted to a proper 3-way discriminated union with `tier: "UNAUTH" | "EMAIL" | "PAID"`.
- `shapeFindingPaid` uses spread-then-override semantics on the EMAIL discriminator so PAID narrows correctly.
- `FindingsList` narrows on `f.tier === "EMAIL" || f.tier === "PAID"` instead of structural `"id" in f`.
- Plan 07+ ready: PAID shape is shipped, route boundary still resolves only `unauth | email`.

## Plan 01 backlog items resolved

- ~~FindingResponse structural narrowing — convert to discriminated union~~ → resolved in G.4 (`NOTES.md` L56 updated with pointer).

## NOTES.md entries opened during Phase G

- **Paid tier route-level subscription lookup (Plan 07+)** — `FindingResponsePaid` exists today; the route boundary at `scan/[id]/page.tsx` + `api/scan/[id]/route.ts` still resolves only unauth/email. Plan 07+ wires `Subscription` lookup at the route boundary and extends `FindingsList` with a `remediationDetailed` rendering section for `tier === "PAID"` findings (currently EMAIL and PAID share the render path).

## Next: Phase H

Integration tests + manual preview smoke. Per implementation plan §H:

- §H.1 `INTEGRATION_DB=1` audit on a fresh DB
- §H.2 Inngest event-chain verification (manual via Inngest dashboard)
- §H.3 End-to-end Vercel preview smoke test — closes the two deferred Phase F + G gate items (preview lifecycle observability + Inngest dashboard event chain)
- §H.4 Performance / load testing (optional)

Estimate: 2–4 hours work + manual verification time.
