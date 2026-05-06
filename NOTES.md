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
- FindingResponse discriminated union: currently structural union without true discriminator. Add tier-discriminator to enforce tier-specific shapes at type level. Low runtime risk (tests verify shapes correct), medium refactor touching 3 shaper functions.
- config.ts production-guard tests: add production-mode coverage for `assertProductionHashSalts()` with missing `SCAN_IP_SALT` / `SCAN_EMAIL_SALT` (Codex NICE_TO_HAVE).
- /scan/[id] client polling: server-rendered snapshot only in Plan 01. Add client polling against GET /api/scan/[id] when Plan 02 dispatcher introduces QUEUED→COMPLETE state transitions. Design considerations: polling interval (2-5s), exponential backoff on errors, stop on terminal states (COMPLETE/FAILED/EXPIRED), bail after N failures.
- inngest 4.x evaluation: Plan 02 pinned to inngest@3.27.5 (Phase A.1). v4 line is available; evaluate upgrade once Plan 02 is stable end-to-end and the v3→v4 changelog can be reviewed without blocking dispatcher work.
- viem 2.48.x bump in Phase A.3 if needed: pinned to viem@2.21.55 in A.1. If RPC client setup in A.3 surfaces type errors fixed by a newer 2.x, bump then.
- viem + abitype + zod 4 compatibility: viem@2.21.55 → abitype@1.0.7 declares peer `zod ^3 >=3.22.0`; project uses zod 4.3.6. Warning only at install. Monitor during Phase A.3 RPC client setup. If runtime errors surface from abitype's zod schemas: investigate downgrading to zod 3, or pin viem to a version whose abitype supports zod 4.
- tsconfig.json target: not set (defaults to ES3). bigint literals (e.g., `20_000_000n`) require workaround via `BigInt(...)`. Single-line tsconfig change (`"target": "ES2020"` or higher) would enable native literal syntax. Defer unless friction increases during Phase D (block numbers, gas values use bigint frequently).
- detectorVersion field type: currently `Int`, considered for `String` semver format (e.g., "1.0.0") in spec §3.2. Deferred during B.2 to keep that phase additive-only and avoid Plan 01 code disruption (`scan-response.ts:73` types it as `number`; 3 test files use literal `1`). Reconsider in Plan 03+ if string-based versioning becomes needed (e.g., for user-facing version display). If converted, the migration must `ALTER COLUMN ... TYPE TEXT USING detectorVersion::text` and the public response shape (`scan-response.ts`) plus tests must update in lockstep.
- generateSlug Solana case-sensitivity: the trailing `.toLowerCase()` in `generateSlug` (`src/lib/scan-submission.ts`) corrupts base58 uniqueness for Solana addresses — `dRiftyHA…` and `Driftyha…` slug-collide. Pre-existing Plan 01 issue, deliberately not fixed in B.3 to keep that phase scoped to the prefix-length bump. Address when Solana detectors land in Plan 03+: branch the lowercase step on `chain === "ETHEREUM"` (or normalize via a chain-aware helper), and update `slug-collision.test.ts` which currently pins the corrupted-but-deterministic behavior.
- ModuleRun structured error code: currently `errorMessage` stores free-form strings (e.g., `"module_timeout"` written by C.1's executeScan timeout path). Consider adding `errorCode String?` enum-style column for programmatic error categorization (rate_limit, module_timeout, rpc_failure, …) in Plan 03+ if observability needs grow. Migration would be additive `ALTER TABLE "ModuleRun" ADD COLUMN "errorCode" TEXT`; backfill existing rows by parsing common errorMessage prefixes if useful.

## Plan 07 — Deferred items (sharing UI, OG generation)

- Dynamic OG image generation for `/scan/[id]` and `/demo/[slug]` (Plan 01 ships a single static OG from Phase E). Requires per-scan OG endpoint that renders composite grade + protocol name + Break Line logo on the Storm Cyan gradient.
- Public share UI on scan results (Twitter/X, LinkedIn, copy-link) gated behind email tier. Paired with the dynamic OG endpoint so link unfurls show the scan's composite grade.

## Procedural learnings

Observations from the Plan 01 workflow that paid off and should be repeated on future plans:

- Codex reviews the frozen spec on `main` before any worktree code exists. Remediation commits land on `main` before the implementation branch is cut, so the worktree starts from a spec already hardened by multiple review rounds.
- Per-phase flow: implement → self-verify (tsc + lint + tests + build) → commit → Codex review → remediation micro-commits → status marker commit. The status marker commit (e.g., `49234f3 "Fase G status marker"`) makes phase completion grep-able in `git log`.
- Follow-up work after a phase closes is labeled against the phase that spawned it (e.g., `"G.1 follow-up: FindingsList"`) so phase exit criteria stay traceable and the follow-up is visible separate from the original phase deliverable.
- Performance artifacts: commit `.md` summaries, never raw Lighthouse JSON. Raw runs are large (~400 KB) and often capture broken states (e.g., Chrome interstitial errors). Enforced via `.gitignore: docs/performance/*.json`.
