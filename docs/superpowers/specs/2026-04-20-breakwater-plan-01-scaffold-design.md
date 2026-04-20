# Breakwater — Plan 01: Project Scaffold & Design System

- **Status**: Draft — awaiting Codex review before implementation
- **Owner**: Robert Wils
- **Created**: 2026-04-20
- **Venture**: Singularity Venture Hub (Breakwater)
- **Branch**: `plan-01-scaffold` (worktree at `../breakwater-plan-01`)
- **Repository**: https://github.com/RobertWils/breakwater

## 1. Goal and non-goals

### 1.1 Goal

Scaffold the Breakwater web application — a continuous security monitoring platform for DeFi protocols — such that after this plan completes:

- The project deploys to Vercel on a Preview URL with working magic-link auth (Resend) and a Railway-hosted Postgres database.
- The landing page renders at production quality with real copy, real demo protocol metadata (no fake scan results), and the Storm Cyan brand system applied.
- The Prisma schema, auth flow, and `/api/scan` entrypoint are shaped correctly for Plans 02–07 to plug in without schema churn.
- The repository is clean, tested at the levels relevant to this plan, documented, and ready for the next plan to layer background scan execution onto it.

### 1.2 Non-goals

- Background job dispatch or real scan execution (Plan 02+).
- Any real detector logic across the four modules (Plans 03–06).
- Stripe integration or subscription billing (post-Plan 07).
- Continuous monitoring scheduling (post-Plan 07).
- Slack/Telegram alerts (out of scope for the prototype).
- Browser extension for signers (out of scope; "coming soon" mention only).
- Public scan sharing / scan claim UI (schema-only in this plan; UI in later plans).
- Multi-tenant organization UX, team invites, member pivot tables (schema allows for it; deferred).
- Dynamic OG image generation per scan (Plan 07; Plan 01 ships a single static `og-default.png`).

## 2. Context

Breakwater is a new venture under Singularity Venture Hub (SVH). It addresses four attack vectors that dominated 2026 DeFi hacks: governance and ops hygiene, oracle and bridge dependency graphs, signer transaction simulation, and frontend/domain monitoring. The commercial model is freemium: a free public grade per module, more detail behind an email signup, remediation playbooks and continuous monitoring behind a paid tier (not billed yet in this prototype).

Breakwater is a sibling brand to SVH Hub (`~/svh-hub`). The scaffold deliberately inherits SVH Hub's stack and some of its design tokens while keeping business logic, integrations, and content fully fresh.

Plan 01 is the first of seven plans. Each plan lives on its own worktree branch, gets a Codex review, then merges to `main`. This spec itself is reviewed by Codex before implementation begins.

## 3. Scaffolding approach

### 3.1 Stack

| Concern | Choice |
| --- | --- |
| Framework | Next.js 14 (App Router, `src/` layout, TypeScript strict) |
| Styling | Tailwind CSS + CSS vars for brand tokens |
| Animation | Framer Motion (count-up on stats strip, subtle entrance motion) |
| ORM / DB | Prisma + PostgreSQL (Railway) |
| Auth | NextAuth with Resend (magic link) |
| Email templates | `@react-email/components` |
| Validation | Zod |
| EVM utilities | `viem` (address checksumming and normalization only in Plan 01) |
| Testing | Vitest + `@testing-library/react` |
| Package manager | pnpm |
| Runtime | Node.js 22 LTS |
| Deploy | Vercel (existing Robert Wils account; team split deferred) |

### 3.2 Origin — hybrid port from SVH Hub

Start from `create-next-app` (Next.js 14, App Router, TS, Tailwind, ESLint, `src/`), then **port** from `~/svh-hub` and adapt:

**Ported and adapted:**
- `tailwind.config.ts` structure (content globs, typography plugin).
- Base Tailwind + CSS var pattern in `globals.css` (light/dark toggle replaced by dark-only Storm Cyan tokens).
- NextAuth Resend magic link configuration (provider wiring, session strategy, callbacks).
- Prisma client singleton pattern (`lib/db.ts`).
- UI primitives: `Button`, `GlassCard`, `Input`, `Label` — renamed/rescoped as needed and re-themed to Storm Cyan.

**Explicitly not ported:**
- SVH business logic: clients, ventures, digest, Telegram bot, Fireflies, Google Drive, Quick Capture, Document Health, SVH GPT.
- SVH Hub's Prisma models that do not match Breakwater's domain.
- SVH's rate-limit configuration (Breakwater has its own rate-limit profile).
- SVH Hub's navigation items and routing shape beyond the top-nav skeleton.

**Fresh in Breakwater:**
- All Prisma models defined in this spec.
- All scanning logic (Plans 02–06).
- Landing page, results page, and auth-facing UI.
- Email templates (Breakwater-branded).

One documented divergence from SVH Hub's pattern: SVH Hub uses Vercel cron. Breakwater needs background jobs that exceed the 10-second serverless timeout, so Plan 02 will introduce Inngest (free tier) rather than Vercel cron. Plan 01 does not install Inngest; it only leaves the schema and the `/api/scan` stub shaped so that Plan 02 can wire dispatch without refactoring.

### 3.3 Directory layout

```
Breakwater/
  src/
    app/
      (marketing)/
        page.tsx                         # landing page
      scan/[id]/
        page.tsx                         # results shell, skeleton only in Plan 01
      api/
        scan/
          route.ts                       # POST handler; validates, rate-limits, creates Scan + ModuleRuns QUEUED
          [id]/route.ts                  # GET handler; returns scan + modules + findings (shape only)
        auth/[...nextauth]/route.ts      # NextAuth handler
      layout.tsx
      globals.css
    components/
      ui/
        Button.tsx, GlassCard.tsx, Input.tsx, Label.tsx,
        Badge.tsx, GradePill.tsx
      landing/
        Hero.tsx, ScanForm.tsx, StatsStrip.tsx, VectorStrip.tsx,
        DemoCards.tsx, HowItWorks.tsx, Footer.tsx, FloatingScanCta.tsx
      brand/
        Logo.tsx, Wordmark.tsx
    lib/
      auth.ts                            # NextAuth config + dual-template send hook
      db.ts                              # Prisma client singleton
      hash.ts                            # ipHash, emailHash helpers (uses SCAN_IP_SALT, SCAN_EMAIL_SALT)
      rate-limit.ts                      # ScanAttempt-based rate-limit utility
      validation.ts                      # zod schemas for scan input
      addresses.ts                       # EVM address normalization (lowercase), Solana pass-through
    styles/
      tokens.css                         # Storm Cyan vars + severity color vars
  prisma/
    schema.prisma
    seed.ts                              # idempotent upserts of system org + 3 demo protocols
    migrations/
      0001_init/migration.sql
      0002_system_org/migration.sql      # seeds `system-breakwater` Organization row
  emails/
    magic-link-signin.tsx
    magic-link-signup-unlock.tsx
  public/
    logo.svg
    logo-mono-dark.svg
    favicon.svg
    favicon-16.png, favicon-32.png, favicon-192.png, favicon-512.png
    apple-touch-icon.png
    og-default.png
    robots.txt
  tests/
    hash.test.ts                         # Vitest: ipHash/emailHash determinism + salt sensitivity
    validation.test.ts                   # Vitest: scan input zod schema
    ScanForm.test.tsx                    # RTL: form submit + error states
  .env.example
  .gitignore
  PRIVACY.md
  README.md
  vitest.config.ts
  tailwind.config.ts
  tsconfig.json
  next.config.mjs
  package.json
  pnpm-lock.yaml
```

## 4. Data model

All models live in `prisma/schema.prisma`. Shared enums defined once and referenced across models.

### 4.1 Enums

```prisma
enum OrganizationKind { SYSTEM USER }
enum Chain            { ETHEREUM SOLANA }
enum OwnershipStatus  { CURATED UNCLAIMED CLAIMED }
enum ScanStatus       { QUEUED RUNNING PARTIAL_COMPLETE COMPLETE FAILED EXPIRED }
enum ScanAttemptStatus{ ACCEPTED RATE_LIMITED INVALID ERROR DUPLICATE }
enum ModuleName       { GOVERNANCE ORACLE SIGNER FRONTEND }
enum ModuleStatus     { QUEUED RUNNING COMPLETE FAILED SKIPPED }
enum Severity         { CRITICAL HIGH MEDIUM LOW INFO }
enum Grade            { A B C D F }
enum ClaimMethod      { SIGN_MESSAGE ENS DNS_TXT }
enum ClaimStatus      { PENDING VERIFIED REJECTED }
enum SubscriptionTier { FREE PAID }
```

### 4.2 Models

**Organization**
- `id` (cuid), `name`, `kind` (`SYSTEM | USER`), `createdAt`, `updatedAt`.
- Seeded row `system-breakwater` owns all CURATED Protocols.

**User**
- `id` (cuid), `email` (unique, lowercase), `emailVerifiedAt` (nullable), `organizationId` (nullable FK — 1:1 for Plan 01; pivot table deferred), `createdAt`, `updatedAt`.
- On magic-link verification: create User (if missing) and link pre-existing anonymous Scans whose `submittedEmail` matches, setting `Scan.submittedByUserId = user.id`.

**Protocol**
- `id` (cuid), `slug` (unique), `displayName`, `chain`, `primaryContractAddress` (normalized), `extraContractAddresses` (JSON `string[]`), `domain` (nullable), `logoUrl` (nullable), `ownershipStatus`, `organizationId` (nullable FK), `knownMultisigs` (JSON `string[]`), `expectedRiskProfile` (nullable `Grade`, only set on CURATED), `createdAt`, `updatedAt`.
- Unique index: `(chain, primaryContractAddress)`.
- Address normalization: EVM → lowercase. Solana → preserve case.

**ProtocolClaim** (schema-only in Plan 01; no UI)
- `id`, `protocolId` (FK), `organizationId` (FK), `proofMethod`, `proofData` (JSON), `status`, `createdAt`, `updatedAt`.

**Scan**
- `id` (UUID v4), `protocolId` (FK, required), `submittedByUserId` (nullable FK), `submittedEmail` (nullable plaintext), `submittedEmailHash` (nullable), `ipHash`, `userAgent`, `status`, `compositeScore` (nullable int), `compositeGrade` (nullable `Grade`), `isPartialGrade` (bool, the `B*` asterisk flag), `expiresAt` (calculated as `createdAt + 30d`), `createdAt`, `completedAt` (nullable).
- Index on `submittedEmail` for post-auth retro-linking.
- Index on `expiresAt` for EXPIRED cron.

**ScanAttempt**
- `id`, `ipHash`, `userId` (nullable FK), `attemptedAt`, `status`, `reason` (string), `userAgent`, `inputPayloadHash`, `scanId` (nullable FK, set when `status = ACCEPTED`).
- Index on `(ipHash, attemptedAt)` for unauth rate-limit window queries.
- Index on `(userId, attemptedAt)` for auth rate-limit window queries.
- Index on `(inputPayloadHash, ipHash, attemptedAt)` for 5-minute duplicate detection.

**ModuleRun**
- `id`, `scanId` (FK), `module`, `status`, `grade` (nullable), `score` (nullable int 0–100), `findingsCount` (nullable int), `startedAt` (nullable), `completedAt` (nullable), `attemptCount` (default 0), `errorMessage` (nullable), `errorStack` (nullable), `detectorVersions` (JSON snapshot), `inputSnapshot` (JSON), `rpcCallsUsed` (int default 0), `idempotencyKey` (string, unique).
- Unique compound: `(scanId, module)` — exactly four rows per Scan.
- `idempotencyKey = sha256(scanId + module + floor(startedAt / 1h))` (Plan 02 computes; Plan 01 writes when creating QUEUED rows using `createdAt`).

**Finding**
- `id`, `scanId` (FK), `moduleRunId` (FK), `module`, `severity`, `publicTitle` (generic, teaser-safe), `title` (full), `description`, `evidence` (JSON — tx hashes, addresses, call details; email-gated), `affectedComponent` (string), `references` (JSON `Array<{title, url}>`), `remediationHint` (string, free-tier visible), `remediationDetailed` (string, paid-only), `publicRank` (int; 1 = teaser shown to unauth), `detectorId` (e.g. `GOV-001`), `detectorVersion` (int), `createdAt`.

**Subscription** (placeholder)
- `id`, `organizationId` (FK), `tier`, `status`, `createdAt`, `updatedAt`.

**NextAuth adapter models** (`@auth/prisma-adapter` contract — fields per the adapter's published schema; we do not diverge from them in Plan 01)
- **Account** — `id`, `userId` (FK), `type`, `provider`, `providerAccountId`, token fields (kept optional since we only use magic link), unique compound `(provider, providerAccountId)`.
- **Session** — `id`, `sessionToken` (unique), `userId` (FK), `expires`.
- **VerificationToken** — `identifier`, `token` (unique), `expires`, unique compound `(identifier, token)`.

### 4.3 Seed strategy

- **Migration `0002_system_org`**: inserts `Organization { id: 'system-breakwater', name: 'Breakwater', kind: 'SYSTEM' }`. Runs in every environment (dev, preview, prod).
- **`prisma/seed.ts`**: upserts three CURATED Protocols. Idempotent via `prisma.protocol.upsert({ where: { chain_primaryContractAddress: ... } })`. Runs on-demand via `pnpm prisma db seed` — never auto-runs in prod.
  - **Aave V3 (Ethereum)** — primary pool address, expectedRiskProfile = `A`.
  - **Uniswap V3 (Ethereum)** — primary factory address, expectedRiskProfile = `B`.
  - **Drift (Solana)** — primary program ID, expectedRiskProfile = `F`.
- All three seed rows set `organizationId = 'system-breakwater'`, `ownershipStatus = CURATED`. `logoUrl` is left `null`; demo cards render a gradient tile with the protocol's initials (`AV3`, `UV3`, `DRIFT`) in Geist Mono (see §8.4 and §15.3). No third-party brand assets are hosted.

### 4.4 Scoring rules (schema-ready, computation in Plan 02+)

These rules are encoded as constants in `src/lib/scoring.ts` so Plan 02 can call them:

- Severity weights: CRITICAL 25, HIGH 10, MEDIUM 4, LOW 1, INFO 0.
- Module score: `max(0, 100 - Σ severity_weights)`.
- Module weights for composite: Governance 35, Oracle 30, Signer 20, Frontend 15.
- Grade bands: A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F < 40.
- Hard floors:
  - ≥ 1 CRITICAL finding in a module → module capped at D (max 59).
  - ≥ 3 HIGH findings in a module → module capped at C (max 74).
  - ≥ 1 CRITICAL in GOVERNANCE or ORACLE → composite capped at D (max 59).
  - ≥ 1 CRITICAL in SIGNER or FRONTEND → composite capped at C (max 69).
- Skipped module handling: re-normalize composite weights over remaining modules AND set `Scan.isPartialGrade = true` so UI renders `B*` (asterisk + tooltip).

Plan 01 ships the constants and pure helpers (`computeModuleScore`, `computeCompositeScore`, `applyHardFloors`) with Vitest coverage.

## 5. Scan submission and lifecycle

### 5.1 `POST /api/scan`

Input schema (zod):

```ts
{
  chain: 'ETHEREUM' | 'SOLANA',
  primaryContractAddress: string,          // required
  extraContractAddresses?: string[],        // optional; merged into Protocol.extraContractAddresses
  domain?: string,                          // optional; enables FRONTEND module
  multisigs?: string[],                     // optional; used by GOVERNANCE module
  modulesEnabled?: ModuleName[],            // default: all four
  submittedEmail?: string,                  // optional, lowercased server-side
}
```

Flow:

1. Parse + validate input. Invalid → write `ScanAttempt(INVALID)`, return 400.
2. Compute `ipHash = sha256(req.ip + SCAN_IP_SALT)`.
3. Compute `inputPayloadHash = sha256(chain + sorted(contractAddresses) + domain + sorted(multisigs))`.
4. Check duplicate: last 5 minutes, same `ipHash` + `inputPayloadHash` → write `ScanAttempt(DUPLICATE)`, return existing `{ scanId }` 200.
5. Check rate limit: unauth 3 ACCEPTED/hour per ipHash, auth 10 ACCEPTED/hour per userId. Exceeded → write `ScanAttempt(RATE_LIMITED)`, return 429.
6. Check per-protocol cooldown: 1 ACCEPTED scan per protocolId per 10 minutes regardless of submitter. Blocked → write `ScanAttempt(RATE_LIMITED, reason='protocol_cooldown')`, return 429.
7. Upsert Protocol by `(chain, primaryContractAddress)` with `ownershipStatus = UNCLAIMED`, `organizationId = null`. If an existing CURATED Protocol matches, reject the submission with 409 and body: `{ error: "protocol_is_curated", message: "This protocol is curated; demo scan only" }`. Write `ScanAttempt(INVALID, reason='protocol_is_curated')`. CURATED protocols do not accept on-demand scans — their results come from scheduled refresh in a later plan.
8. Create `Scan` row with `status = QUEUED`, `submittedByUserId = session?.user?.id ?? null`, `submittedEmail`, `submittedEmailHash`, `ipHash`, `userAgent`.
9. Create 4 `ModuleRun` rows (one per ModuleName) with `status = QUEUED`, `idempotencyKey`, `inputSnapshot = { chain, primaryContractAddress, extraContractAddresses, domain, multisigs }`. SKIP precedence (any of these → `status = SKIPPED`): (a) module not present in `modulesEnabled`; (b) required input missing — FRONTEND requires `domain`, others require at least `primaryContractAddress`. SKIPPED rows carry `inputSnapshot` so later plans can explain *why* a module was skipped.
10. Write `ScanAttempt(ACCEPTED, scanId)`.
11. Return `{ scanId }` 202.

**Plan 01 stops here — no dispatch.** Plan 02 wires Inngest to consume QUEUED rows.

### 5.2 `GET /api/scan/:id`

Returns:

```ts
{
  id, status, compositeScore, compositeGrade, isPartialGrade,
  createdAt, completedAt, expiresAt,
  protocol: { slug, displayName, chain, domain, ownershipStatus },
  modules: ModuleRun[],   // redacted errorStack for unauth/free users
  findings: Finding[],    // gating rules applied in query (see §5.3)
}
```

### 5.3 Finding visibility logic

Server-side filter applied in `GET /api/scan/:id`:

- **Unauthenticated**: per module, return only the highest-severity finding (`publicRank = 1`); strip `title`, `description`, `evidence`, `remediationDetailed` from the response — keep only `publicTitle`, `severity`, `remediationHint`. Add `hiddenFindingsCount` per module.
- **Email-authenticated**: return all findings; strip `remediationDetailed`.
- **Paid** (future): return everything.

Server computes this — never sent to client as a "hide in CSS" boolean, to prevent leakage via devtools.

### 5.4 State transitions (Plan 01 schema only)

- `QUEUED → RUNNING` (Plan 02 event).
- `QUEUED/RUNNING → COMPLETE | FAILED | SKIPPED` per ModuleRun.
- Scan denorm status derived from ModuleRun rows via a `recomputeScanStatus(scanId)` helper (Plan 02 calls on each module completion).
- `COMPLETE → EXPIRED` by a 30-day cron (Plan 02+ schedule).

### 5.5 Retry classification (schema-ready, logic in Plan 02)

- `RetryableError` class for transient failures: RPC timeout, 429s, 5xxs on upstream APIs, network errors.
- `PermanentError` class for non-retryable: invalid input, unverified contract source, unsupported chain, detector logic exception.
- Module runner auto-retries `RetryableError` once with 30s backoff, then marks FAILED.
- `attemptCount` on ModuleRun tracks this.

Plan 01 exports the error classes from `src/lib/errors.ts` with Vitest coverage.

## 6. Auth flow

### 6.1 NextAuth configuration

- Providers: `Resend` only (magic link).
- Session: **database strategy via `@auth/prisma-adapter`**. Session, Account, and VerificationToken models added per the adapter's contract (see §4.2). Decision rationale in §15.
- Pages: custom `/auth/signin` (minimal — email input + submit + "check your inbox" state).

### 6.2 Dual email templates

Template selection happens in `lib/auth.ts` via a `sendVerificationRequest` override. Origin is determined by a `callbackUrl` query parameter or referer on the signin request:

- **`magic-link-signin`** — subject "Sign in to Breakwater". Body: plain signin CTA. Link redirects to `callbackUrl` or `/`.
- **`magic-link-signup-unlock`** — subject "Unlock your Breakwater scan findings". Body: mentions the scan by protocol name if available. Link redirects to `/scan/[id]?unlock=<token>`.

Both templates use `@react-email/components`, share a `BreakwaterEmailShell` layout (logo, Storm Cyan gradient strip, footer with support email and unsubscribe note).

### 6.3 Single-click post-auth flow

Triggered by NextAuth's `signIn` callback (or an equivalent middleware step) on magic-link verification:

1. Verify the email token.
2. Create User if none exists (email already lowercased).
3. Run `linkAnonymousScans(user.email)`: `UPDATE Scan SET submittedByUserId = :userId WHERE submittedEmail = :email AND submittedByUserId IS NULL`.
4. Set session cookie.
5. Redirect: if `callbackUrl` contains `/scan/:id`, go there with unlocked findings rendered server-side. Otherwise `/`.

All five steps happen in one HTTP round-trip — no intermediate "account verified, please sign in again" page.

## 7. Landing page

### 7.1 Structure (hybrid B + inline form)

Top to bottom:

1. **Hero**
   - Eyebrow: "DeFi Security Monitoring"
   - Headline: "We catch the attacks before they reach shore"
   - Subheadline: "The governance, oracle, signer, and frontend patterns behind $600M+ in 2026 DeFi hacks — detected continuously."
   - **Inline ScanForm**: chain dropdown (`Ethereum` / `Solana`) + primary contract address input + "Scan for free" submit button.
   - Trust line below form: "Free scan · No signup required · Results in under 60 seconds".
   - Mobile: form stacks under copy, never side-by-side.

2. **Stats strip** (second fold)
   - "$600M+ lost to DeFi hacks in 2026" (Framer Motion count-up from 0).
   - "4 attack patterns dominate the losses".
   - Tooltip/footnote lists verified hack breakdown (see §7.3).

3. **4-vector strip** — glass cards, one per module, all four visible.
   - Governance → Drift post-mortem, detector IDs `GOV-001`, `GOV-003`, ...
   - Oracle & Bridge → Kelp post-mortem, detector IDs `ORC-001`, ...
   - Signer Trace → signer incidents, detector IDs `SIG-001`, ...
   - Frontend Monitor → CoW Swap post-mortem, detector IDs `FRO-001`, ...
   - **Desktop**: detector IDs hover-revealed beneath each card's summary.
   - **Mobile**: detector IDs always visible in a smaller mono font beneath the summary (no tap-to-expand).

4. **Demo protocols section** — three cards: Aave V3, Uniswap V3, Drift.
   - **Plan 01 behavior**: each card links to `/demo/[slug]`, a lightweight Protocol info page showing `displayName`, chain, primary contract, and a "Full scan results available in a future release" placeholder. **No fake grades, no fixture findings.**
   - Drift card carries a "Post-mortem demo — what Breakwater would have caught" label.
   - When Plan 03 delivers real Module 1 output, a follow-up task runs real scans on these protocols, caches the results in DB, and updates the demo cards to link to real cached scan results. Plan 01 does not do this.

5. **How it works** — 3 step cards:
   - Submit contracts + domain.
   - We scan 4 attack surfaces in parallel.
   - Get graded findings in under 60 seconds.
   - CTA: "Scan your protocol" anchors back to the hero ScanForm.

6. **Footer** — SVH attribution ("A Singularity Venture Hub venture"), Privacy (links to `/privacy` which renders `PRIVACY.md`), Terms (placeholder page).

7. **Floating Scan-Now CTA** — appears when the user scrolls past the stats strip; fixed to `bottom-right`; links back to the hero form anchor. Hidden on mobile when the on-screen keyboard is likely open (deferred heuristic if time-boxed; acceptable to just hide below breakpoint `md`).

### 7.2 Content discipline

- **No lorem ipsum.**
- No fake testimonials.
- No fake customer logos.
- No fabricated "trusted by X protocols" counters.
- Acceptable real content: demo protocol metadata (public on-chain info); hack statistics that can be sourced and verified.

### 7.3 Hack stat sourcing

Headline figure: **"$600M+ across 4 patterns"**, with a tooltip or footer breakdown listing the verifiable hacks used to derive the number:

- Kelp DAO — $292M (April 2026, LayerZero bridge exploit) → Oracle/Bridge pattern.
- Drift — $285M (April 2026, governance/social engineering) → Governance pattern.
- Truebit — $26M (January 2026, legacy contract bug) → Governance/Signer pattern.
- Step Finance — ~$27M (January 2026, multisig compromise) → Governance/Signer pattern.
- CoW Swap — $1.2M (April 2026, domain hijack) → Frontend pattern.
- Sum of named hacks: ~$631M. Published figure rounded conservatively to **"$600M+"**.

During implementation, if at least one named hack's amount fails to verify against a credible source, swap the headline to "Hundreds of millions lost to 4 patterns" and list the verified subset in the tooltip. Never publish an unsourced aggregate.

## 8. Brand system

### 8.1 Palette (Storm Cyan) — `src/styles/tokens.css`

```css
:root {
  --bg-base:         #0C1C3A;
  --bg-elevated:     #17306B;
  --bg-gradient:     linear-gradient(135deg, #0C1C3A 0%, #17306B 100%);
  --accent-teal:     #14B8A6;   /* primary: positive/success, CTAs */
  --accent-sky:      #38BDF8;   /* secondary: informational, links */
  --text-primary:    #F1F5F9;
  --text-muted:      #A5B4CD;
  --border-subtle:   rgba(255, 255, 255, 0.08);
  --glass-surface:   rgba(255, 255, 255, 0.05);
  --glass-blur:      12px;

  /* Severity — defined independently of brand palette; consistent everywhere */
  --sev-critical:    #EF4444;
  --sev-high:        #F97316;
  --sev-medium:      #F59E0B;
  --sev-low:         #60A5FA;
  --sev-info:        #94A3B8;

  /* Grade colors — mirror severity mapping */
  --grade-a:         #14B8A6;   /* teal, matches primary */
  --grade-b:         #38BDF8;
  --grade-c:         #F59E0B;
  --grade-d:         #F97316;
  --grade-f:         #EF4444;
}
```

Tailwind exposes these via `tailwind.config.ts`'s `extend.colors`.

### 8.2 Glass card spec

- Background: `var(--glass-surface)`.
- Backdrop filter: `blur(var(--glass-blur))`.
- Border: `1px solid rgba(20, 184, 166, 0.18)` on cards with teal emphasis; `1px solid var(--border-subtle)` otherwise.
- Border radius: `12px`.
- On dark gradient body, this produces the preview look we validated.

### 8.3 Typography

- **Geist Sans** (via `next/font/google`) — wordmark, body copy, UI labels.
- **Geist Mono** (via `next/font/google`) — detector IDs (`GOV-001`), contract addresses, any code/tech label.
- Single font family pair keeps bundle cost modest.
- Font weights loaded: 400, 500, 600, 700 sans; 400, 500 mono.

### 8.4 Demo protocol tiles

Each demo card (Aave V3, Uniswap V3, Drift) renders as a small, consistent gradient tile in place of a third-party brand mark:

- Tile size: 48×48 (card thumbnail), 96×96 (demo page header).
- Background: linear gradient using brand palette (`--accent-teal` → `--accent-sky` for Aave/Uniswap, `--sev-critical` → `--accent-sky` for Drift to signal the post-mortem framing).
- Foreground: protocol initials (`AV3`, `UV3`, `DRIFT`) in **Geist Mono 600**, `text-primary` color.
- Border: glass-card border treatment (matches cards elsewhere on landing).

Rationale in §15.3 — no third-party brand hosting.

### 8.5 Logo — Break Line (option C)

- Mark: angular zig-zag suggesting both a wave and a chart spike. The peak is interrupted by a **semantic break marker** (a short vertical line segment), and the spike resumes at a visibly different angle on the other side — communicating "the attack is interrupted here."
- Monochrome-first. Color is expression, not structure.
- Deliverables in `public/`:
  - `logo.svg` — full-color (teal + sky).
  - `logo-mono-dark.svg` — single-color for dark backgrounds.
  - `logo-mono-light.svg` — single-color for light backgrounds (future PDF/email use).
  - `favicon.svg`, `favicon-16.png`, `favicon-32.png`, `favicon-192.png`, `favicon-512.png`, `apple-touch-icon.png` — generated from the logo and manually verified at each target size.
- Wordmark: "Breakwater" in Geist Sans 600, `letter-spacing: -0.01em`, teal-to-sky subtle gradient available for hero but defaulting to `--text-primary` solid.

### 8.6 OG image (Plan 01)

- Single static `public/og-default.png`, 1200×630.
- Design: Storm Cyan gradient background, centered wordmark + Break Line mark, headline "Continuous security monitoring for DeFi protocols", small SVH attribution in corner.
- Dynamic per-scan OG images are deferred to Plan 07.

## 9. Environment variables

`.env.example` (committed) contains:

```
# Database
DATABASE_URL=postgres://user:pass@host:5432/breakwater

# Auth
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=generate-with-openssl-rand-base64-32

# Email (Resend)
RESEND_API_KEY=
EMAIL_FROM="Breakwater <no-reply@breakwater.xyz>"

# Privacy / hashing salts (server-only, high entropy)
SCAN_IP_SALT=
SCAN_EMAIL_SALT=

# ---- Added in later plans; leave unset for Plan 01 ----
# ALCHEMY_API_KEY=           # Plan 03+
# HELIUS_API_KEY=            # Plan 03+
# ETHERSCAN_API_KEY=         # Plan 03+
# TENDERLY_ACCESS_KEY=       # Plan 05
# INNGEST_EVENT_KEY=         # Plan 02
# INNGEST_SIGNING_KEY=       # Plan 02
```

- Local dev uses `.env.local` (gitignored).
- Vercel environments configured via `vercel env add` for Preview + Production. Railway Postgres is a **new Railway project**, completely separate from SVH Hub's database.
- `email` domain: confirm `breakwater.xyz` (or whichever domain is registered) before hardcoding `EMAIL_FROM`. Flag in implementation PR if the chosen domain differs.

## 10. Testing

Scope limited to what Plan 01 actually ships:

| Test | Type | Purpose |
| --- | --- | --- |
| `tests/hash.test.ts` | Vitest unit | `ipHash`/`emailHash` are deterministic with a given salt; differ when salt changes; handle whitespace/case on emails. |
| `tests/validation.test.ts` | Vitest unit | Zod scan input schema accepts valid payloads; rejects bad addresses, invalid chain, too-long `extraContractAddresses` arrays (cap at e.g. 10), malformed domains. |
| `tests/scoring.test.ts` | Vitest unit | `computeModuleScore`, `computeCompositeScore`, `applyHardFloors` produce expected grades for sample finding sets, including re-normalization on skipped modules and the asterisk flag. |
| `tests/ScanForm.test.tsx` | React Testing Library | Renders; valid submit fires `POST /api/scan` (mocked); shows inline error states for empty/invalid input; disables submit during in-flight request. |

Detector logic tests land in Plans 03–06. No E2E in Plan 01.

## 11. Privacy, security, compliance

### 11.1 `PRIVACY.md` (repo root)

Header: `Last updated: 2026-04-20`.

Sections:

- **What we store** — ipHash (not raw IP), emailHash (not raw email), scan metadata, findings, optional plaintext email when user requests findings unlock.
- **Why** — rate limiting (ipHash), post-signup retro-linking of scans (emailHash → plaintext email), service delivery (scan metadata + findings).
- **How long** —
  - Scans flipped to `EXPIRED` 30 days after creation; findings retained for audit.
  - Plaintext `submittedEmail` nulled after 90 days if `submittedByUserId IS NULL` (user never converted).
  - `ipHash` retained for ScanAttempt records indefinitely in Plan 01; revisit retention policy in Plan 07.
- **User rights** — data export and deletion endpoints are paid-tier in the product roadmap; interim requests via email to `security@breakwater.xyz` (domain and mailbox availability must be confirmed before publication).
- **Contact** — `security@breakwater.xyz`.

### 11.2 Other security posture

- All secrets via env; none committed.
- `robots.txt` disallows `/scan/*` and `/demo/*` in Plan 01. Revisit when we decide on public sharing (Plan 07).
- Rate limits enforced server-side in `/api/scan`:
  - Unauthenticated: 3 ACCEPTED/hour per `ipHash`.
  - Authenticated: 10 ACCEPTED/hour per `userId`.
  - Per-protocol cooldown: 1 ACCEPTED per `protocolId` per 10 minutes.
- CURATED Protocols reject on-demand scans (see §5.1 step 7); their results come from scheduled refresh (future plan), not user-triggered runs.

## 12. Deployment

- **Vercel**: use Robert's existing account for Plan 01; team-level separation deferred until paid tier launches. `vercel link` connects the new Breakwater project.
- **Railway**: create a new Railway project for Breakwater with a fresh Postgres instance. Do not share a database with SVH Hub — Breakwater and SVH Hub are formally separate ventures under Intellistake.
- **Preview** deploys run on the `plan-01-scaffold` branch; merging to `main` after Codex review promotes to production.
- **Environment variables** populated via `vercel env add`. `DATABASE_URL` points to Railway; Resend and NextAuth secrets generated per environment.

## 13. Git workflow for Plan 01

1. `cd /Users/robertwils/Breakwater && git init && git branch -M main`.
2. `git remote add origin https://github.com/RobertWils/breakwater.git`.
3. First commit on `main`: `.gitignore`, `README.md` stub, this spec. Push `main`.
4. `git worktree add ../breakwater-plan-01 -b plan-01-scaffold`.
5. All Plan 01 implementation commits land on `plan-01-scaffold` in `../breakwater-plan-01`.
6. Commits per logical unit (not per file): scaffold, Prisma schema + migrations, auth config, landing UI, brand assets, tests, deploy prep.
7. At end of plan: push branch, open PR against `main`, request Codex review, STOP. Do not merge.
8. Status message on completion: *"Plan 01 complete, PR opened at <url>, waiting for Codex review before continuing."*

### 13.1 `.gitignore`

```
.superpowers/
.env
.env.*
!.env.example
node_modules/
.next/
.vercel/
*.log
.DS_Store
/prisma/migrations/dev.db*
/coverage/
```

## 14. Exit criteria

Plan 01 is complete when all of the following are true on the Preview deploy:

- `pnpm dev` boots cleanly with no uncaught errors.
- Magic-link signin works end-to-end (real Resend, real Railway Postgres). Email arrives, link signs user in, session persists.
- Landing page renders hero + stats strip + 4-vector strip + 3 demo cards + how-it-works + footer, all with real copy (no lorem, no fake social proof).
- 3 demo cards link to `/demo/[slug]` Protocol info pages showing real on-chain metadata and a "Full scan results available in a future release" placeholder. No fabricated grades or findings.
- `POST /api/scan` with a valid payload creates a Scan row + 4 ModuleRun rows (all QUEUED, FRONTEND optionally SKIPPED) + an ACCEPTED ScanAttempt row, and returns `{ scanId }` 202.
- `POST /api/scan` returns 429 after 3 unauth attempts/hour from the same IP, and logs RATE_LIMITED ScanAttempt rows.
- `GET /api/scan/:id` returns the scan shape with gated findings (no findings yet in Plan 01, so this is verifiable shape-only).
- Vitest suite passes (hash, validation, scoring, ScanForm).
- `PRIVACY.md` published, linked from footer, dated `2026-04-20`.
- `robots.txt` in place with `/scan/*` and `/demo/*` disallowed.
- **Lighthouse** on the landing page on the Preview URL: **Accessibility ≥ 90** (hard blocker; WCAG discipline is non-negotiable for a security product) and **Performance ≥ 75** (acceptable floor; target ≥ 90 revisited in Plan 07). Exact scores documented in the PR description.
- PR opened from `plan-01-scaffold` against `main`, Codex review requested, no merge.

## 15. Resolved open questions (closed pre-Codex)

All four initial open questions have been resolved by the product owner. Captured here for traceability.

1. **Domain** — Use `breakwater.xyz` as a **placeholder** in Plan 01 configs (`EMAIL_FROM`, PRIVACY.md contact). Final domain selection (`breakwater.xyz` / `breakwater.security` / `breakwater.so` / `getbreakwater.com`) will be confirmed by whois + product decision; swap happens in Plan 07 polish or a standalone config PR. **Not a Plan 01 blocker.**
2. **NextAuth session strategy** — **Database adapter** via `@auth/prisma-adapter`. Rationale: (a) sessions must be revocable for a security product, (b) "active sessions" UI is a planned paid-tier feature that needs a Session table anyway, (c) anonymous-scan retro-linking is cleaner with a DB session context. Schema consequence: add `Session`, `Account`, `VerificationToken` models per `@auth/prisma-adapter` contract (see §4.2).
3. **Demo protocol logos** — **Placeholder gradient tiles, no third-party brand assets.** Each demo card renders a colored gradient tile with protocol initials (`AV3`, `UV3`, `DRIFT`) in Geist Mono. Rationale: (a) trademark/brand-guideline risk is an unforced error for a security product, (b) we have no permission to reuse Aave/Uniswap/Drift marks. Real protocol logos land only when a design-partner protocol explicitly authorizes use (Plan 07+).
4. **Lighthouse targets** — Split criterion:
   - **Accessibility ≥ 90** — hard requirement. WCAG compliance is a security-product baseline and 95% of it is upfront discipline (semantic HTML, ARIA labels, focus states, contrast ratios) rather than polish.
   - **Performance ≥ 75** — acceptable floor for Plan 01 (Framer Motion + remote fonts impose a budget). Exact scores documented in the PR description. Target 90 revisited in Plan 07 polish.

## 16. Codex review focus areas

These architectural choices merit explicit Codex scrutiny before implementation. We want Codex's broader systems perspective to probe here, because a revision after code is written is more expensive than a revision now.

### 16.1 Idempotency key on ModuleRun
Current design: `idempotencyKey = sha256(scanId + module + floor(createdAt / 1h))` — written at row creation (QUEUED) and consumed by Plan 02's Inngest dispatcher so that a duplicate trigger within the same hour bucket is a no-op.

**Question for Codex**: is the hour-bucket stable enough? Failure modes to consider: a scan that retries just after the hour boundary would re-dispatch; a very slow dispatcher could miss its bucket. Alternative: cryptographic UUID generated at dispatch time and stored on `ModuleRun` via a dispatch callback. Trade-off is a dispatch-time write instead of a creation-time write.

### 16.2 Rate limiting via ScanAttempt table queries
Current design: every `POST /api/scan` runs a `COUNT(*)` against `ScanAttempt` filtered by `ipHash` (or `userId`) within the last hour, plus a per-protocol cooldown query. All decisions happen in Postgres.

**Question for Codex**: will this scale? At Plan 01 volume (low) this is fine, but at 10× or 100× growth the repeated time-window aggregation may bottleneck. Alternative: Upstash Redis (free tier) for rate-limit counters + ScanAttempt reduced to append-only audit log. If Codex agrees Redis is warranted, schedule as a Plan 02 refactor rather than a Plan 01 blocker.

### 16.3 Single-click magic link transaction semantics
The post-auth flow does five things in one round-trip (§6.3): verify token, create User, link pre-existing anonymous Scans by email match, set session, redirect. These touch multiple tables (User, Scan, Session/Account via the adapter).

**Question for Codex**: is this transactional end-to-end? Failure scenarios to resolve explicitly:
- Token verified + User created, but `linkAnonymousScans` fails → user is logged in, scans unlinked. Retry strategy?
- Create User succeeds but session write fails → user exists but has no session. Cleanup?
- Race: two concurrent magic-link clicks for the same email (user refreshes). Unique-constraint collision handling?

Wanted: explicit transaction boundaries in the implementation, documented compensating actions for each partial-failure mode.

### 16.4 Protocol.slug uniqueness and generation
Current design: `Protocol.slug` is unique. Generation strategy is unspecified.

**Question for Codex**: generated from `displayName` server-side (e.g. `slugify + numeric suffix on collision` giving `aave-v3-ethereum`, `aave-v3-ethereum-2`, ...) vs user/curator-submitted as an explicit field? Also: for UNCLAIMED user-submitted Protocols, how do we derive a friendly slug when we only have a contract address and no displayName? Fallback to `${chain}-${shortAddress}` is workable but ugly in URLs.

Preferred implementation: curator-submitted for CURATED (clean URLs like `aave-v3`); generated + sequential-disambiguated for UNCLAIMED (e.g. `${chain}-${shortAddress}`). Codex to confirm or propose better.

### 16.5 Plaintext `submittedEmail` and GDPR/AVG retention
Current design (§11.1): `submittedEmail` stored in plaintext for 90 days; nulled by cron if `submittedByUserId` is still NULL. Hash retained indefinitely for rate-limit/dedup purposes.

**Question for Codex**: is 90-day plaintext TTL compliant with GDPR/AVG data-minimization principles for a pre-converted user? Alternative: null `submittedEmail` immediately after magic link completion (retaining only the hash and the now-authenticated User's `email`), rather than waiting 90 days. This leans on hash-only matching for any future anonymous scans arriving before that email converts, which we can still handle via `submittedEmailHash` equality checks.

Codex may also want to probe whether plaintext `submittedEmail` needs to be encrypted at rest (beyond whatever Railway Postgres provides by default).

### 16.6 How to interpret Codex's verdict
If Codex approves on all five items, the architecture is solid enough to start implementation on the `plan-01-scaffold` worktree.
If Codex flags issues, the spec is updated on `main` (separate commit(s)) before the worktree is created.
If Codex proposes scope changes that expand Plan 01 meaningfully, we re-scope rather than absorb — extra work lands in Plan 02 or later.

## 17. Decisions recap (for traceability)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Scaffold origin | Hybrid: `create-next-app` + port specific SVH Hub files | Inherit proven tokens/auth; keep business logic fresh. |
| Monorepo? | No, single Next.js app. | Browser extension + workers are out of scope in the 7-plan prototype. |
| Runtime | Node.js 22 LTS | Matches Robert's SVH Hub setup; keeps venture stacks aligned. |
| Protocol identity | Hybrid CURATED/UNCLAIMED/CLAIMED, dedupe by `(chain, primaryContractAddress)` | Supports seeded demos + user submissions + future claim flow without code forks. |
| User/Org identity | Scan-first; User at email-signup; Organization at claim or paid upgrade | Matches the freemium flow; no orphan orgs. |
| Severity levels | 5 (CRITICAL, HIGH, MEDIUM, LOW, INFO) | INFO useful for free-tier non-issues. |
| Module weights | Gov 35 / Oracle 30 / Signer 20 / Frontend 15 | Aligns with 2026 attack loss distribution. |
| Hard floors | CRITICAL caps module D; 3× HIGH caps module C; CRITICAL in Gov/Oracle caps composite D | Didactic: Drift demo must grade F. |
| Teaser safety | `publicTitle` (generic) vs `title` (full, email-gated) | Prevents data leakage through teaser UI. |
| Remediation gating | `remediationHint` free, `remediationDetailed` paid | Conversion-hook vs. full paywall. |
| Rate-limit model | `ScanAttempt` table, separate from `Scan` | Keeps Scan table clean, supports non-accepted attempt tracking. |
| Retry policy | 1 retry for `RetryableError`, 0 for `PermanentError` | Graceful on flaky RPC, no waste on bad input. |
| Background jobs | Inngest free tier (Plan 02) | Vercel cron can't exceed 10s timeout for scan work. |
| Palette | Storm Cyan (`#0C1C3A` → `#17306B` gradient) | Validated visual; sibling-coherent with SVH Hub. |
| Landing layout | Hybrid B narrative + inline form | Tells the "why now" story, action is immediate. |
| Demo cards in Plan 01 | "Full scan coming" placeholder pages, not fake fixtures | Never publish fabricated scan data on real protocols. |
| Logo | Break Line (option C) with semantic break marker | Dual reads as wave + chart spike; matches product job. |
| Seed split | System Org in migration, demo Protocols in idempotent seed script | Prod doesn't auto-reset demos on every deploy. |
| Railway DB | New Breakwater Railway project, separate from SVH Hub | Formal venture separation. |
