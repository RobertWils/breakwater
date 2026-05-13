# Breakwater engineering notes

Short-form rationale for non-obvious project decisions. Add an entry when a future reader might ask "why is this set this way?" and the answer is not visible from the code alone.

## Plan 01 — Completed

Plan 01 shipped a working Breakwater scaffold (Phases A–H) on 2026-04-22. See `docs/superpowers/plans/2026-04-20-breakwater-plan-01-implementation.md` for phase breakdown and final status. Below are Plan 01 engineering decisions that are not visible from the code alone.

### Node engine `>=22.12`

Vitest 4.x pulls in Vite 8.x, which requires Node `>=22.12`. Engine constraint was tightened from `22.x` to `>=22.12` in Codex round 2 of Phase B review to match that transitive requirement. Do not relax without verifying Vite's current Node floor.

Local `.nvmrc` mirrors the same floor (`22.12`). Vercel project is pinned at `22.x` which resolves to the latest 22 LTS and satisfies this constraint automatically.

### Dependency version notes

#### nodemailer v6.10.1 (vs next-auth's peer dep v7)

next-auth@4.24 declares nodemailer@^7 as peer. We use v6.10.1 because:

- Our `sendVerificationRequest` uses Resend directly, not nodemailer
- nodemailer is only needed at module resolution time (`require` statement in `next-auth/providers/email`)
- v6 resolves the require and satisfies runtime requirements
- Upgrading to v7 would be cosmetic-only (silences warning) without functional benefit

Accepted peer warning: `unmet peer nodemailer@^7.0.7: found 6.10.1`

### Spec factual corrections (implementation deviations)

#### §8.3 font loader (E.1)

Spec zegt "Geist Sans + Geist Mono via next/font/google". Geist wordt niet via Google Fonts gehost. Canonical loader is Vercel's geist npm package (wraps next/font/local). Identieke resulterende --font-geist-sans / --font-geist-mono CSS variables.

Applied: `import { GeistSans } from "geist/font/sans"` + `import { GeistMono } from "geist/font/mono"`

Future spec updates: replace "via next/font/google" with "via geist npm package" in §8.3.

#### §8.1 gradient range (F.1 refinement)

Spec gradient `#0C1C3A → #17306B` was visually imperceptible on large screens. Expanded to 3-stop gradient `#0A1530 → #0C1C3A → #1E3D85` while preserving `--bg-base` and `--bg-elevated` values for other uses.

## Plan 02 — In progress

Spec frozen on main at commit `400053c` (2026-04-22). File: `docs/superpowers/specs/2026-04-22-breakwater-plan-02-design.md`. Research backfill at `docs/research/2026-04-22-governance-incidents.md` (commit `c1d9642`).

Scope: Inngest dispatcher + Governance module for Ethereum mainnet. 6 detectors (GOV-001 through GOV-006) anchored to Drift, Beanstalk, Compound 62, Ronin, Audius incidents. Public RPC endpoints only (Ankr + Cloudflare via viem `fallback` transport) — no paid provider keys in Plan 02.

Branch: `plan-02-dispatcher` (to be created post spec-freeze + Codex review).
Worktree: `/Users/robertwils/breakwater-plan-02` (to be created on branch cut).
Next step: implementation.md generation.

## Plan 02 — Deferred items

- Schema: `ScanAttempt.reason` should be nullable (currently NOT NULL forces `"accepted"` sentinel for ACCEPTED status rows). Fix in Plan 02 migration: make `reason` nullable.
- Slug collision: current implementation can fail on addresses sharing first 8 hex chars. Plan 02 should add incremental suffix strategy or longer hash input.
- ~~FindingResponse discriminated union: currently structural union without true discriminator. Add tier-discriminator to enforce tier-specific shapes at type level.~~ **Resolved in Plan 02 G.4** (commit on `plan-02-dispatcher`): 3-way `UNAUTH | EMAIL | PAID` union with `tier` discriminator stamped by the shapers; `FindingsList` narrows on `tier` instead of `"id" in f`.
- config.ts production-guard tests: add production-mode coverage for `assertProductionHashSalts()` with missing `SCAN_IP_SALT` / `SCAN_EMAIL_SALT` (Codex NICE_TO_HAVE).
- /scan/[id] client polling: server-rendered snapshot only in Plan 01. Add client polling against GET /api/scan/[id] when Plan 02 dispatcher introduces QUEUED→COMPLETE state transitions. Design considerations: polling interval (2-5s), exponential backoff on errors, stop on terminal states (COMPLETE/FAILED/EXPIRED), bail after N failures.
- inngest 4.x evaluation: Plan 02 pinned to inngest@3.27.5 (Phase A.1). v4 line is available; evaluate upgrade once Plan 02 is stable end-to-end and the v3→v4 changelog can be reviewed without blocking dispatcher work.
- viem 2.48.x bump in Phase A.3 if needed: pinned to viem@2.21.55 in A.1. If RPC client setup in A.3 surfaces type errors fixed by a newer 2.x, bump then.
- viem + abitype + zod 4 compatibility: viem@2.21.55 → abitype@1.0.7 declares peer `zod ^3 >=3.22.0`; project uses zod 4.3.6. Warning only at install. Monitor during Phase A.3 RPC client setup. If runtime errors surface from abitype's zod schemas: investigate downgrading to zod 3, or pin viem to a version whose abitype supports zod 4.
- tsconfig.json target: not set (defaults to ES3). bigint literals (e.g., `20_000_000n`) require workaround via `BigInt(...)`. Single-line tsconfig change (`"target": "ES2020"` or higher) would enable native literal syntax. Defer unless friction increases during Phase D (block numbers, gas values use bigint frequently).
- detectorVersion field type: currently `Int`, considered for `String` semver format (e.g., "1.0.0") in spec §3.2. Deferred during B.2 to keep that phase additive-only and avoid Plan 01 code disruption (`scan-response.ts:73` types it as `number`; 3 test files use literal `1`). Reconsider in Plan 03+ if string-based versioning becomes needed (e.g., for user-facing version display). If converted, the migration must `ALTER COLUMN ... TYPE TEXT USING detectorVersion::text` and the public response shape (`scan-response.ts`) plus tests must update in lockstep.
- generateSlug Solana case-sensitivity: the trailing `.toLowerCase()` in `generateSlug` (`src/lib/scan-submission.ts`) corrupts base58 uniqueness for Solana addresses — `dRiftyHA…` and `Driftyha…` slug-collide. Pre-existing Plan 01 issue, deliberately not fixed in B.3 to keep that phase scoped to the prefix-length bump. Address when Solana detectors land in Plan 03+: branch the lowercase step on `chain === "ETHEREUM"` (or normalize via a chain-aware helper), and update `slug-collision.test.ts` which currently pins the corrupted-but-deterministic behavior.
- ModuleRun structured error code: currently `errorMessage` stores free-form strings (e.g., `"module_timeout"` written by C.1's executeScan timeout path). Consider adding `errorCode String?` enum-style column for programmatic error categorization (rate_limit, module_timeout, rpc_failure, …) in Plan 03+ if observability needs grow. Migration would be additive `ALTER TABLE "ModuleRun" ADD COLUMN "errorCode" TEXT`; backfill existing rows by parsing common errorMessage prefixes if useful.
- Railway free-tier idle connection drops cause transient failures in `scan-submission-integration.test.ts` (typically 1–2 per run, varying which tests fail). Pattern: Prisma `Server has closed the connection`. Not a deterministic regression — the tests pass in isolation and a different test fails each full-suite run. Candidate fixes: connection warm-up at test setup, retry shim with exponential backoff, or move integration tests to CI with a pinned local DB. Defer until it actively blocks development.
- waitForEvent multi-module match (NICE_TO_HAVE from Codex C-phase review): C.1's `executeScan.step.waitForEvent` matches on `data.scanId` only. Tolerable for the single-module skeleton (governance only). When Phase F adds a second module dispatch, tighten the match to `data.scanId` AND `data.module` to avoid cross-module accidental wakes — otherwise the governance waiter could resume on an oracle/signer/frontend completion event with the same scanId.
- Cascade-delete coverage on Scan-related tables (Codex C-phase observation): `GovernanceSnapshot.scan` has `onDelete: Cascade` but `ScanAttempt`, `ModuleRun`, and `Finding` do not. Plan 02 has no scan-deletion path so this is currently unreachable. When TTL purge (or admin-side delete) lands in Plan 03+, either (a) extend cascade to the other relations in a migration, or (b) implement explicit ordered cleanup in the purge job. Document the choice; mismatched cascade semantics tend to leak orphan rows quietly.

### Codex Phase E review backlog (E.7 batched deferrals)

- **N1: GOV-006 pause-pattern expansion (Plan 03+).** Current detector matches 10 conservative regex patterns. Real-world variants like `freezeAll`, `freezeFunds`, `emergencyExit` may legitimately implement pause semantics but don't match. Risk balance: false negatives on legitimate pauses vs. false positives on irrelevant freeze functions (e.g., per-user token freeze on stablecoins). Decision deferred until aggregated production scan data informs the pattern set.

- **VotingSnapshotType enum granularity (Plan 03+).** E.4 Option A collapsed BLOCK_NUMBER + TIMESTAMP into the existing `BLOCK_BASED` value. The clock-mode distinction stays in `raw.clockMode` for forensics. Plan 03+ enhancement: add a separate `TIMESTAMP` enum value (or split `BLOCK_BASED` into two) if the UI ever needs to distinguish OZ 4.9+ timestamp clocks from earlier block-number clocks. Migration would be additive.

- **Declared multisig 404-as-finding type (Plan 03+).** GOV-003 currently quiets when `hasMultisig: false` — covers both "no multisig" and "declared multisig returned 404 from Safe API" (D.3c collapses these). Spec §5.2 originally proposed treating "declared multisig that is not a Safe" as a distinct finding type. Plan 03+ enhancement: extend `GovernanceSnapshotData` to capture declared addresses that returned 404 separately; GOV-003 fires LOW or MEDIUM "declared multisig not registered as Safe — verify deployment".

- **ABI-based UUPS positive confirmation (Plan 03+).** D.5 I2 collapsed "impl set + admin unset" into `CUSTOM` (was over-claiming `EIP_1822_UUPS`). The `EIP_1822_UUPS` enum value remains unused by the current detector. Plan 03+ enhancement: fetch implementation ABI for `CUSTOM` proxies, check for `proxiableUUID()` returning the EIP-1822 magic value (`0x360894…d382bbc`) or the `upgradeToAndCall(address,bytes)` selector. Promote `CUSTOM → EIP_1822_UUPS` when confirmed; GOV-005 Rule 2 then fires `INFO` (positive confirmation) instead of `MEDIUM` (unknown pattern).

### Codex Phase F review backlog (F.5 batched deferrals)

- **Inngest function-body emit-gate test coverage (Phase H).** F.5 I1 added compare-and-set gates around `step.sendEvent("emit-module-completed*")` in `executeGovernanceModule`, but the F-phase test files don't drive the Inngest function body — they only test the extracted helpers (`markModuleSkippedDisabled`, `markModuleComplete`, `computeModuleExecutionMs`) directly. The gate itself is verified by code review + the helper-level return-shape tests covering `marked === 0` and `finalized === false`. Full executor-driven test belongs in plan §H.3 (Inngest test harness, gated behind `INTEGRATION_DB=1 INNGEST_TEST=1`).

- **Dedicated `INTEGRATION_TEST=1` env var (Plan 03+).** Current Phase F + Plan 01 integration tests gate on `!!process.env.DATABASE_URL`, conflating "database available" with "should run integration tests." Plan §H.3 introduces an explicit `INNGEST_TEST=1` gate for the Inngest end-to-end suite; consider unifying as `INTEGRATION_TEST=1` (covers DB + Inngest + LIVE_RPC opt-ins) in Plan 03+ so local-fast iteration can run with `DATABASE_URL` set without paying the integration-suite cost. Touchpoints: `scan-submission-integration.test.ts:69`, `scan-get-integration.test.ts`, `auth-integration.test.ts`, `phase-f.integration.test.ts`.

- **Protocol Graph discovery (Plan 03+, ~2–3 weeks).** Plan 02 scans a single primary contract address per scan. Production protocols typically span related contracts: bridges (LayerZero, Wormhole), tokens (OFT, ERC20), discovered multisigs beyond declared, cross-chain deployments, token contract upgrade authorities. Plan 03 enhancement: introduce a `ProtocolGraph` schema with a discovery pipeline (DeFiLlama registry lookup, Etherscan related-addresses, on-chain heuristic discovery via storage slots + bytecode analysis). Additive schema fields: `Protocol.relatedContracts Json`, `Protocol.bridgeContracts Json`, `Protocol.tokenContracts Json`, `Protocol.crossChainDeployments Json`. Detector adaptation: detectors operate on the graph rather than a single address. New detectors: GOV-007 (bridge security), GOV-008 (cross-chain admin consistency). Significant scope — schedule as a standalone plan, not bundled into a smaller plan.

- **Paid tier route-level subscription lookup (Plan 07+).** Plan 02 G.4 exposes `FindingResponsePaid` with `tier: "PAID"` discriminator, but no consumer currently selects this tier — the route boundary at `src/app/scan/[id]/page.tsx` and `src/app/api/scan/[id]/route.ts` resolves tier via `session?.user?.id ? "email" : "unauth"` only. Plan 07+ wires the `Subscription` lookup: when an authenticated user's `Organization` has an active `Subscription` with `tier=PAID`, the route resolves the visibility tier to `"paid"`, `shapeFindingPaid` runs, and `remediationDetailed` surfaces in `FindingsList`. The `SubscriptionTier` enum (`FREE | PAID`) and `Subscription` model already exist on `Organization` (Plan 01 schema, L86 + L326–L333); resolution is a single-query addition at the route boundary. `FindingsList.tsx` will also need an additional UI section to render `remediationDetailed` for `tier === "PAID"` findings (currently EMAIL and PAID share the same rendering path).

### Spec drift findings (Phase D recon, pre-implementation)

Spec §8.2 + §8.3 + §9 will be updated in batch at end of Phase D before Codex review. Implementation will follow current API state below, not the frozen spec text.

**Etherscan API (spec §8.3):**
- v1 endpoint (`https://api.etherscan.io/api`) **deprecated 2025-08-15**.
- v2 base URL: `https://api.etherscan.io/v2/api`.
- `?chainid=1` is **mandatory** (1 = Ethereum mainnet).
- `?apikey=…` is **mandatory** — unauthenticated requests return `{"status":"0","message":"NOTOK","result":"Missing/Invalid API Key"}` (verified by live probe). Detector code must treat `status === "0"` with that message as the "API key missing/invalid" skip path, distinct from "network failure".
- Same response envelope as v1: `{ status, message, result }`.
- Migration delta from spec §8.3: path is `/v2/api` (not `/api`); chainid + apikey both required; query format `?module=contract&action=getabi&address=…` unchanged.

**Safe Transaction Service (spec §8.2):**
- Legacy hostname `safe-transaction-mainnet.safe.global` permanently redirected (308) to `https://api.safe.global/tx-service/eth/`.
- Path prefix `/api/v1/safes/{address}/` **preserved** on the new hostname (verified by empirical probe — see commit `<this commit>` for raw output).
- Auth tiers added since spec §8.2 was written: anonymous tier (2 RPS, 5,000 monthly requests) is sufficient for early dev; authenticated production via `Authorization: Bearer $YOUR_API_KEY` (signup at safe.global dashboard) for higher quotas.
- Free-tier ceiling will bite at ~150 scans/day. Treat `SAFE_API_KEY` as OPTIONAL with same graceful-degrade pattern as `ETHERSCAN_API_KEY` (warn-not-throw in production assertion).
- Response shape verified against `0x849D52316331967b6fF1198e5E32A0eB168D039d` (Gnosis DAO Safe): `{ address, nonce, threshold, owners[], ... }`. 404 on non-Safe addresses means "this address has never been registered with the service", not "endpoint moved" — distinguish carefully when wiring GOV-003.

## Plan 07 — Deferred items (sharing UI, OG generation)

- Dynamic OG image generation for `/scan/[id]` and `/demo/[slug]` (Plan 01 ships a single static OG from Phase E). Requires per-scan OG endpoint that renders composite grade + protocol name + Break Line logo on the Storm Cyan gradient.
- Public share UI on scan results (Twitter/X, LinkedIn, copy-link) gated behind email tier. Paired with the dynamic OG endpoint so link unfurls show the scan's composite grade.

## Procedural learnings

Observations from the Plan 01 workflow that paid off and should be repeated on future plans:

- Codex reviews the frozen spec on `main` before any worktree code exists. Remediation commits land on `main` before the implementation branch is cut, so the worktree starts from a spec already hardened by multiple review rounds.
- Per-phase flow: implement → self-verify (tsc + lint + tests + build) → commit → Codex review → remediation micro-commits → status marker commit. The status marker commit (e.g., `49234f3 "Fase G status marker"`) makes phase completion grep-able in `git log`.
- Follow-up work after a phase closes is labeled against the phase that spawned it (e.g., `"G.1 follow-up: FindingsList"`) so phase exit criteria stay traceable and the follow-up is visible separate from the original phase deliverable.
- Performance artifacts: commit `.md` summaries, never raw Lighthouse JSON. Raw runs are large (~400 KB) and often capture broken states (e.g., Chrome interstitial errors). Enforced via `.gitignore: docs/performance/*.json`.
- Phase F.4 / F.4.x container introduced post-plan (Plan 02). Original implementation plan defined three Phase F tasks (F.1/F.2/F.3 — orchestrator/scoring/persist). During execution the boundaries re-balanced: orchestrator → F.1, standalone scoring helper → F.2, executeScan composite integration → F.3, polish/close work (executionMs clamp, DB-backed smoke test, status marker) → F.4.x. F.4 is therefore a user-introduced container with no plan blueprint; future audits should not flag this as scope creep. If repeated on future plans, document the container introduction explicitly in the status marker commit so the relationship to the frozen plan stays grep-able.
