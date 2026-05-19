# Phase F — Status Marker

**Status:** COMPLETE + Codex reviewed + fixed
**Branch:** plan-02-dispatcher
**Closing commit:** see `docs: Phase F status marker (COMPLETE + Codex reviewed)`
**Test count:** 569/569 green

## Sub-task progression

| Sub-task | Commit  | Subject                                                          |
| -------- | ------- | ---------------------------------------------------------------- |
| F.1      | ed85c51 | governance module orchestrator (executeGovernanceModule)         |
| F.2      | 03ac2c4 | composite grade calculation                                      |
| F.3      | 52f96c7 | integrate composite grade into executeScan finalisation          |
| F.4.1    | e0b934f | clamp executionMs to non-negative on clock skew                  |
| F.4.2    | 7b4abdd | per-module grade + DB-backed Phase F smoke test                  |
| F.5      | 65db452 | Codex Phase F review IMPORTANTs + N1 + N2                        |

Test progression: 500 (E.7) → 521 (F.1) → 548 (F.2) → 560 (F.3) → 561 (F.4.1) → 564 (F.4.2) → 569 (F.5).

## Codex review summary

Bundled review of F.1+F.2+F.3+F.4.1+F.4.2 produced:

- 0 BLOCKERs
- 2 IMPORTANTs (both fixed in F.5)
- 3 NICE_TO_HAVEs (2 fixed in F.5, 1 deferred to NOTES.md)
- 4 NON_ISSUEs (verified clean)

## Phase F exit gate audit

Per implementation plan L3152–3160:

| Gate item                                                       | Status                                            |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `executeGovernanceModule` registered in serve handler           | ✅ F.1 (`src/app/api/inngest/route.ts:11`)        |
| Findings persisted with `detectorVersion=1` + `snapshotBlockNumber` | ✅ F.1 (`persistSnapshotAndFindings`)         |
| ModuleRun carries grade + score                                 | ✅ F.4.2 (`markModuleComplete` signature extended) |
| `recomputeScanStatus` sets composite grade on Scan row          | ✅ F.3 (`markComplete`)                           |
| `INTEGRATION_DB=1 pnpm test` green                              | ✅ F.4.2 (DATABASE_URL-gated smoke test)          |
| Scan lifecycle observable on Vercel preview                     | ⏸️ Deferred to Phase H manual smoke              |
| Inngest dashboard shows the full event chain                    | ⏸️ Deferred to Phase H manual smoke              |

5 of 7 gate items met. 2 deferred to Phase H per plan §H.3.

## What Phase F shipped

**Orchestration:**

- `executeGovernanceModule` Inngest function listens for `scan.module.requested` events
- Filters on `event.data.module == "GOVERNANCE"` at the Inngest match layer
- Compare-and-set state transitions for idempotent retry behavior
- Emit events gated on actual state transition (no duplicate events on Inngest retries — F.5 I1)

**Detection pipeline:**

- All 6 GOV-XXX detectors registered in `GOVERNANCE_DETECTORS` registry
- `isDetectorDisabled()` integration for runtime skip
- Per-detector error isolation (one detector throw doesn't fail the module)

**Persistence:**

- `GovernanceSnapshot` persisted in a `$transaction` with findings
- `ModuleRun.grade` + `ModuleRun.score` populated on terminal states (F.4.2)
- `Finding.snapshotBlockNumber` populated on every row for reproducibility

**Scoring:**

- `calculateCompositeGrade` pure function (spec §5.3)
- Penalties: CRITICAL=35, HIGH=20, MEDIUM=10, LOW=5, INFO=0
- Grade thresholds: 90/75/60/40 (A/B/C/D, F otherwise)
- Floor overrides: 3+ CRITICAL → F; 2+ CRITICAL → cap at D (only downgrades naturally A/B/C)
- `Scan.compositeScore` + `Scan.compositeGrade` persisted on COMPLETE
- FAILED scans: null score/grade (F.3 Option 1 decision — partial findings on a failed scan don't represent a meaningful assessment)

**Event payloads:**

- `scan.module.completed`: `status` + `grade` + `findingsCount` + `executionMs` (clamped non-negative)
- `scan.completed`: `finalStatus` + `compositeGrade` + `compositeScore` + `findingsCount` + `executionMs` (clamped non-negative)

## NOTES.md backlog entries opened during Phase F

- waitForEvent multi-module match (Plan 03+ when Oracle/Frontend modules land) — pre-existing C.4 entry, confirmed by Codex Phase F as still applicable.
- Inngest function-body emit-gate executor-driven test (Phase H §H.3 scope).
- Dedicated `INTEGRATION_TEST=1` env var convention (Plan 03+).
- Protocol Graph discovery — bridges, OFTs, related contracts, cross-chain consistency (Plan 03+, ~2–3 weeks standalone scope).
- F.4 container concept not in original plan (procedural note in Procedural learnings).

## Next: Phase G

UI + polling integration. Per implementation plan §G:

- `GET /api/scan/[id]/status` polling endpoint
- Finding rendering with tier-gated display (Plan 01 backlog FindingResponse union)
- Grade visualization on `/scan/[id]`
- Real-time status transitions via polling (terminal-aware cache-control)

Estimate: 3–4 hours work.
