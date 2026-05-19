# Phase H — Status Marker

**Status:** COMPLETE (closed by H.9; widened by holistic Phase I review — see footer)
**Branch:** plan-02-dispatcher
**Closing commit (original H.5):** `926036f`
**Test count at H.5 close:** 644/644 green. At Phase H close (after H.9): **658/658** green.

## Sub-task progression

| Sub-task     | Commit      | Subject                                                    |
| ------------ | ----------- | ---------------------------------------------------------- |
| H.1          | (audit only) | DB-backed integration audit — 4 runs clean, 0 flakes      |
| H.1 docs     | `ca1d7e7`   | NOTES.md L66 audit annotation                              |
| H.1 prep     | `5dcd718`   | H.2/H.3 manual checklists + test protocols                 |
| H.6 (hotfix) | `54b5847`   | mark unimplemented modules SKIPPED at creation             |
| H.7 (hotfix) | `3a1303b`   | hide errorMessage on SKIPPED ModuleCards                   |
| H.8 (hotfix) | `de09473`   | validate contract bytecode in snapshot capture             |
| H.5          | `926036f`   | Phase H status marker (this doc — original close)          |
| H.9          | `e05e904`   | Codex Phase H review BLOCKER + N1 + N2 + N3 (post-marker)  |

Test progression: 634 (G.6) → 638 (H.6) → 639 (H.7) → 644 (H.8) → **658** (H.9).
Phase H net: **+24 tests** (10 from H.6/H.7/H.8 + 14 from H.9) across 4 functional commits + 1 status marker.

**Note on H.9:** the original H.5 marker (committed at `926036f`) predates H.9 and lists Phase H test count as 644. After the Codex Phase H review surfaced 1 BLOCKER (`modulesEnabled: []` and only-unimplemented inputs would finalise as COMPLETE with composite grade A) + 3 NICE_TO_HAVEs, H.9 landed the three-layer defense (schema `.min(1)` → submission no-runnable-modules throw → executor `hasAnyCompleteModule` gate). This doc was updated in Phase I.2 to reflect the post-H.9 state. The "no remaining Phase H blockers" claim from the original H.5 marker was true for the Phase H scope at marker time; the holistic Phase I review later widened the lens and surfaced additional cross-cutting issues (idempotency, isPartialGrade) that were closed in I.1 — see `docs/superpowers/plans/phase-i-status.md` if/when written, or the I.1 commits `5ddec4b` / `8df38ff` / `34cf6ad` / `050e95c`.

## What Phase H validated

**Infrastructure (manual preview smoke):**

- Vercel preview deployment for `plan-02-dispatcher` branch.
- Inngest cloud registration (`breakwater` app + 2 functions registered).
- Alchemy mainnet RPC endpoint configured via `PRIMARY_ETH_RPC_URL`.
- Env vars correctly scoped across Production + Preview environments.

**End-to-end happy path (Uniswap V3 SwapRouter):**

- `POST /api/scan` creates Scan + ModuleRun rows correctly.
- Inngest event chain fires: `scan.queued` → `scan.module.requested` → `scan.module.completed` → `scan.completed`.
- `captureGovernanceSnapshot` succeeds with Alchemy RPC.
- All 6 governance detectors run on real mainnet contract.
- Snapshot + findings persisted to `GovernanceSnapshot` + `Finding` tables.
- `ModuleRun.grade` + `score` populated.
- `Scan.compositeGrade` + `compositeScore` populated.
- UI live polling updates without page refresh.
- Composite grade letter + score renders prominently (A grade, 100/100).
- SKIPPED ModuleCards display clean "Not included in this scan" copy.

**End-to-end FAILED path (EOA address):**

- `captureGovernanceSnapshot` detects empty bytecode.
- Throws `address_is_not_contract` error.
- `executeGovernanceModule` catches + marks ModuleRun FAILED.
- `errorMessage` rendered in `role="alert"` red box (correct for FAILED).
- Composite panel shows FAILED copy, no grade letter.
- FindingsList shows G.5 N2 *"Scan failed. Findings unavailable."* copy.
- `Scan.compositeGrade` + `compositeScore` stay null (per F.3 Option 1).

## Bugs caught + fixed during Phase H

| Bug                          | Fix              | Description                                                                                                                                          |
| ---------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPC infrastructure           | (env var update) | `cloudflare-eth.com` deprecated; configured Alchemy via `PRIMARY_ETH_RPC_URL`                                                                        |
| Vercel env var scope         | (env var update) | Some Inngest keys Production-only; extended to Preview environment                                                                                   |
| `modulesEnabled` gate        | `54b5847`        | ORACLE/SIGNER/FRONTEND created QUEUED without handler → infinite RUNNING. Now SKIPPED at creation with `module_not_implemented` audit string         |
| `errorMessage` UI exposure   | `3a1303b`        | Internal audit string rendered in red error box on SKIPPED cards. Gated rendering on `status === "FAILED"` only                                       |
| EOA validation gap           | `de09473`        | EOA addresses produced grade A on empty snapshot. Pre-flight bytecode check in snapshot capture throws `address_is_not_contract`; ModuleRun FAILED with truthful error |

## Phase H exit gate audit

Per implementation plan §H exit:

| Gate item                                                       | Status                                  |
| --------------------------------------------------------------- | --------------------------------------- |
| `INTEGRATION_DB=1 pnpm test` green                              | ✅ H.1 (4 runs clean, 0 flakes)         |
| Vercel preview smoke completed                                  | ✅ Uniswap COMPLETE + EOA FAILED        |
| Inngest cloud dashboard event chain observed                    | ✅ H.2 (full chain verified)            |
| Real protocol scan reaches terminal state                       | ✅ Uniswap V3 → COMPLETE grade A        |
| FAILED path graceful (per spec §6.3)                            | ✅ H.8 (EOA → FAILED with errorMessage) |

5 of 5 gate items met. **No remaining Phase H blockers.**

**Caveats on this claim (H.9 N3):**

- H.1 audit observation: 4 consecutive clean DB-integration runs against Railway. Flake risk reduced but **not proven fixed long-term** (see NOTES.md L66 — the underlying free-tier idle-connection behaviour can re-emerge under different load patterns).
- Inngest function-body executor-driven tests remain deferred to Plan §H.3 harness work — the F-phase / G-phase suites cover the helpers; the function body itself is verified end-to-end via the manual preview smoke.
- The "no remaining limitations" claim refers to **the spec'd Phase H exit gate**, not to all behavior. Future plans may surface follow-ups; the Plan 03+ items listed below are the known set as of this marker.

## Known follow-ups (Plan 03+ scope, non-blocking)

Documented in `NOTES.md`:

1. **Multi-module dispatcher tightening** — `waitForEvent` matches only `data.scanId`, sufficient for single-module Plan 02. Plan 03+ requires `scanId AND module` matching when ORACLE/SIGNER handlers land.

2. **Visual polish backlog** — progress indication during RUNNING, timestamp localization, scan duration ETA, error message copy refinement, "Coming soon" copy variant for unimplemented modules. Separate visual polish session post-merge.

3. **Security advisories (CVE-2026-44578 et al.)** — Next.js WebSocket SSRF and middleware bypass CVEs. Vercel-hosted = not currently vulnerable. Plan 03+ Next.js upgrade for defense-in-depth + self-hosting optionality.

## Next: Phase I

PR creation + merge to main. Per implementation plan:

- §I.1 Pre-merge cleanup (squash strategy decision, branch sync).
- §I.2 PR description + scope summary.
- §I.3 Merge to main + production deploy verify.
- §I.4 Tag release + changelog.

Estimate: 60–90 min including manual production verify.
