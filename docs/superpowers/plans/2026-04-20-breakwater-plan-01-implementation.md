# Breakwater Plan 01 — Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Breakwater scaffold — Next.js 14 app with complete Prisma data model, magic-link auth, scan submission API (no dispatch yet), landing page with brand system, and scan-results shell — deployed to Vercel preview, behind a PR against `main` ready for Codex post-implementation review.

**Architecture:** Next.js 14 App Router (src/ layout) on Node 22 LTS with pnpm. Prisma + PostgreSQL on Railway for persistence. NextAuth with `@auth/prisma-adapter` and Resend magic-link provider for auth. Tailwind CSS tokens ported pattern-only from SVH Hub. Scan orchestration (Inngest dispatch, actual detectors) deferred to Plans 02–06 — Plan 01 stops at writing `QUEUED` rows to the database.

**Tech Stack:** Next.js 14.2+, TypeScript 5 strict, Tailwind 3.4, Prisma 5, PostgreSQL 16 (Railway), NextAuth 4 + `@auth/prisma-adapter`, Resend + `@react-email/components`, Framer Motion 11, zod 3, viem 2, Vitest 1, pnpm 9, Vercel.

**Source spec:** `docs/superpowers/specs/2026-04-20-breakwater-plan-01-scaffold-design.md` (frozen at commit `04423df` on `main` after 3 Codex review rounds).

---

## Working directory and branching

All work on this plan happens on the **worktree at `/Users/robertwils/breakwater-plan-01`**, branch `plan-01-scaffold`. Do not commit implementation work to `main` directly. At the end of Phase H, a PR is opened `plan-01-scaffold` → `main` for Codex post-implementation review.

The spec on `main` is frozen — if something in the spec needs to change mid-implementation, raise it with the user, do not silently diverge.

## Reference policy — SVH Hub

`~/svh-hub` is read as a **pattern reference only**, on-demand per task. No business logic, no SVH branding, no SVH rate limits, no SVH email templates, no SVH seed data transfers. At the end of Phase A, `PORTS.md` documents every pattern inherited and why. The end-of-plan Codex review uses `PORTS.md` to validate nothing leaked in that shouldn't have.

When a task says "reference `~/svh-hub/<path>`", read it, understand the pattern, then write a fresh Breakwater version — do not copy-paste.

## File structure (created by this plan)

```
breakwater-plan-01/
├── .env.example
├── .nvmrc                          # "22"
├── .gitignore                      # (already exists on main)
├── PORTS.md                        # Phase A commit 3
├── PRIVACY.md                      # (already exists on main)
├── README.md                       # (already exists on main; expanded in Phase H)
├── next.config.mjs
├── package.json
├── postcss.config.mjs
├── pnpm-lock.yaml
├── tailwind.config.ts
├── tsconfig.json
├── vitest.config.ts
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   │   ├── 0001_init/
│   │   └── 0002_system_org/
│   └── seed.ts
├── public/
│   ├── favicon.ico
│   ├── favicon-192.png
│   ├── favicon-512.png
│   ├── logo.svg
│   ├── og-image.png
│   └── robots.txt
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                # landing
│   │   ├── globals.css             # tokens import
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/route.ts
│   │   │   └── scan/
│   │   │       ├── route.ts        # POST
│   │   │       └── [id]/route.ts   # GET
│   │   ├── scan/[id]/page.tsx      # results shell
│   │   └── demo/[slug]/page.tsx    # coming-soon pages for CURATED
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Button.tsx
│   │   │   ├── GlassCard.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Label.tsx
│   │   │   ├── Badge.tsx
│   │   │   └── GradePill.tsx
│   │   ├── Logo.tsx
│   │   └── landing/
│   │       ├── Hero.tsx
│   │       ├── InlineScanForm.tsx
│   │       ├── DetectorsStrip.tsx
│   │       ├── WhyNow.tsx
│   │       ├── DemoCards.tsx
│   │       └── StickyScanButton.tsx
│   ├── emails/
│   │   ├── SigninEmail.tsx
│   │   └── SignupUnlockEmail.tsx
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── auth.ts                 # NextAuth config
│   │   ├── resend.ts
│   │   ├── hash.ts                 # ipHash, emailHash, payloadHash
│   │   ├── normalize.ts            # address normalization
│   │   ├── dedupe.ts               # deterministicSerialize + payloadHash
│   │   ├── rateLimit.ts            # IP/user quota queries
│   │   ├── cooldown.ts             # advisory lock + cooldown query
│   │   ├── scoring.ts              # weights, floors (pure)
│   │   ├── errors.ts               # RetryableError, PermanentError
│   │   └── scanLinking.ts          # linkAnonymousScans
│   └── styles/
│       └── tokens.css
└── docs/
    └── superpowers/
        ├── specs/                  # (inherited from main)
        └── plans/                  # this plan
```

---

## Phase summary

| Phase | Scope | Commits | Build+test+deploy after |
|---|---|---|---|
| A | Foundation: scaffold + Prisma init + first Vercel deploy | 3 | ✓ |
| B | Data model: full Prisma schema + migrations + seed | 2 | ✓ |
| C | Auth: NextAuth + Resend + post-auth scan linking | 2 | ✓ |
| D | Scan API: POST + GET + atomic cooldown + dedupe | 3 | ✓ |
| E | Brand system: tokens + logo + UI primitives + OG | 3 | ✓ |
| F | Landing page: all 6 sections + Lighthouse | 2 | ✓ |
| G | Results shell: /scan/[id] polling + gating UI | 2 | ✓ |
| H | Polish + deploy: PRIVACY/README/robots + PR opened | 2 | ✓ |

**Total: 19 commits across 8 phases.** Every commit leaves the tree in a green state: `pnpm build` passes, `pnpm test` passes, Vercel preview deploys successfully (from Phase A onward).

---

## Conventions — Dependency pinning policy

The frozen spec (§3.1) and this plan's Tech Stack section call out specific major versions for core infrastructure. To prevent `pnpm add` drifting onto a newer major (as happened on the first A.2 attempt, which installed Prisma 7 despite the spec saying Prisma 5), every subagent installing a spec-named dependency MUST use exact pinning.

### Exact-pin (required, use `pnpm add -E`)

| Package | Pinned version | Source of constraint |
|---|---|---|
| `next` | 14.2.35 | A.1 install (committed `package.json`) |
| `prisma` (devDep) | 5.22.0 | Plan §Tech Stack ("Prisma 5") |
| `@prisma/client` | 5.22.0 | Plan §Tech Stack ("Prisma 5") |
| `next-auth` | 4.x exact (e.g. 4.24.11) | Spec §6.1, plan Tech Stack ("NextAuth 4") — pin during Task C.1 |
| `@auth/prisma-adapter` | compatible with next-auth 4 | Plan §Tech Stack — pin during Task C.1 |

### Caret-range (acceptable, default `pnpm add`)

Packages with no explicit major-version constraint in the spec/plan may use caret ranges: `react`, `react-dom`, `typescript`, `tsx`, `zod`, `@react-email/components`, `framer-motion`, `viem`, `vitest`, `eslint`, `tailwindcss`, `postcss`, `@types/*`.

### Subagent checklist (for any task that runs `pnpm add`)

1. Before installing, check this table and the Tech Stack line for the package.
2. If the package appears in the exact-pin table, use `pnpm add -E <pkg>@<exact-version>`.
3. If not, caret range is fine.
4. The commit message must name the installed version(s) for spec-bound deps.
5. If a spec-bound dep is already installed on a wrong version, flag to the controller — do not silently upgrade/downgrade outside your task's scope.

Rationale: the first A.2 attempt blocked on a Prisma 7 P1012 error because `pnpm add prisma` resolved `^7.7.0`. Exact pinning + this checklist prevents the same class of failure in C.1 (NextAuth) and beyond.

---

## Phase A — Foundation (3 commits)

**Goal:** Working empty Next.js 14 app on Node 22 with pnpm, Prisma initialized against an empty Railway database, deployed to Vercel at a preview URL. Everything is a skeleton — no business logic, no schema beyond Prisma's defaults.

**Risk:** Vercel deploy fails because of a Node-version or pnpm-version mismatch between the local tree and Vercel's build environment.
**Rollback:** Pin `packageManager` in `package.json` to `pnpm@9.x`, pin Node via `engines.node` to `22.x`, and set `VERCEL_NODE_VERSION=22.x` in the Vercel project's env. If the build still fails, fall back to npm (Next's default) for Phase A and revisit pnpm in Phase H once the repo is otherwise green.

### Task A.1 — create-next-app scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `postcss.config.mjs`, `tailwind.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `.nvmrc`, `next-env.d.ts`
- Modify: `.gitignore` (append `next-env.d.ts` if not present)

- [ ] **Step 1: Run `create-next-app` inside the worktree**

```bash
cd /Users/robertwils/breakwater-plan-01
pnpm create next-app@14 . \
  --typescript --tailwind --eslint --app --src-dir \
  --import-alias "@/*" \
  --no-turbo
```
If prompted to overwrite existing files (PRIVACY.md, README.md, docs/), **decline** — answer No. create-next-app should add new files alongside the existing ones. If it refuses, run with `--use-pnpm` and manually skip the conflicting prompts, or create scaffold files by hand using Next 14's starter template as reference.

- [ ] **Step 2: Pin Node 22 and pnpm**

Write `.nvmrc`:
```
22
```

Edit `package.json` to add:
```json
{
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": "22.x",
    "pnpm": "9.x"
  }
}
```

- [ ] **Step 3: Verify the scaffold builds and starts**

```bash
pnpm install
pnpm build
```
Expected: build succeeds, no TypeScript errors, `.next/` produced.

```bash
pnpm dev
```
Expected: http://localhost:3000 serves the Next.js starter page. Kill the dev server.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js 14 app (App Router, TypeScript, Tailwind, pnpm, Node 22)"
```

### Task A.2 — Prisma init + dev database wiring

**Files:**
- Create: `prisma/schema.prisma` (generated, then customized), `src/lib/prisma.ts`, `.env.example`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Install Prisma and initialize**

```bash
pnpm add prisma @prisma/client
pnpm dlx prisma init
```
This creates `prisma/schema.prisma` and `.env`. `.env` is already gitignored.

- [ ] **Step 2: Edit `prisma/schema.prisma` — generator and datasource only**

Replace the generated file with:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```
No models yet — models land in Phase B.

- [ ] **Step 3: Create `src/lib/prisma.ts` — singleton client**

Pattern-reference only: `~/svh-hub/src/lib/prisma.ts` (confirm the pattern, do not copy the file). Write:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 4: Write `.env.example`**

Per §9 of the spec. Copy literally (this is public, safe to check in):

```
# Database
DATABASE_URL="postgresql://user:password@host:5432/breakwater"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="<openssl rand -base64 32>"

# Resend
RESEND_API_KEY=""
RESEND_FROM_EMAIL="Breakwater <noreply@breakwater.xyz>"

# Hash salts (server-side only — never exposed to client)
SCAN_IP_SALT="<openssl rand -base64 32>"
SCAN_EMAIL_SALT="<openssl rand -base64 32>"

# Branding
NEXT_PUBLIC_SITE_URL="http://localhost:3000"
```

- [ ] **Step 5: Add Prisma scripts to `package.json`**

```json
{
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:migrate:deploy": "prisma migrate deploy",
    "db:seed": "prisma db seed"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```
Install `tsx`:
```bash
pnpm add -D tsx
```

- [ ] **Step 6: Create a local Postgres for development (or use Railway dev branch)**

Decision: **use Railway for dev** (single source of truth; spec §12). Create a new Railway project `breakwater-dev` (separate from SVH Hub). Provision Postgres. Copy the connection string into local `.env` (which is gitignored).

If the user already created the project, confirm the connection string is available before continuing.

- [ ] **Step 7: Verify Prisma connects**

```bash
pnpm db:generate
pnpm prisma migrate dev --name noop_init
```
Expected: generator runs, migration `0001_noop_init/` created (no tables yet), `_prisma_migrations` table created in Railway. The empty migration is fine — Phase B replaces `0001_init` with the real schema.

Actually, rewind — delete the noop migration before committing so Phase B can cleanly own `0001_init`:
```bash
rm -rf prisma/migrations/0001_noop_init
pnpm prisma migrate resolve --rolled-back "0001_noop_init" || true
# (if the migration was recorded, resolve it; otherwise ignore)
```

Confirm with `pnpm prisma migrate status`: no pending migrations, empty schema.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Initialize Prisma with empty schema and dev DB wiring"
```

### Task A.3 — First Vercel deploy + PORTS.md

**Files:**
- Create: `vercel.json` (if needed; `next.config.mjs` may suffice), `PORTS.md`

- [ ] **Step 1: Create Vercel project and link the repo**

From the worktree:
```bash
pnpm dlx vercel@latest link
```
Follow prompts: create new project `breakwater`, scope to user's personal account. This creates `.vercel/` which is gitignored.

- [ ] **Step 2: Set environment variables on Vercel**

For the `preview` and `development` environments (not `production` yet — we deploy to production only at the end of Phase H):

```bash
pnpm dlx vercel env add DATABASE_URL preview
pnpm dlx vercel env add NEXTAUTH_URL preview   # use the Vercel preview URL pattern
pnpm dlx vercel env add NEXTAUTH_SECRET preview
pnpm dlx vercel env add SCAN_IP_SALT preview
pnpm dlx vercel env add SCAN_EMAIL_SALT preview
pnpm dlx vercel env add NEXT_PUBLIC_SITE_URL preview
```

RESEND_API_KEY and RESEND_FROM_EMAIL are set in Phase C.

- [ ] **Step 3: Trigger a preview deploy**

```bash
pnpm dlx vercel --prebuilt=false
```
Or push the branch to GitHub and let Vercel auto-deploy the preview:
```bash
git push -u origin plan-01-scaffold
```

Expected: Vercel preview URL returns HTTP 200 with the default Next.js starter page. If it fails, check the build logs — most common causes are missing env vars or pnpm version mismatch (see Risk callout for rollback).

- [ ] **Step 4: Write `PORTS.md`**

```markdown
# Patterns ported from SVH Hub

Breakwater and SVH Hub are sibling ventures under Singularity Venture Hub. To stay visually and operationally coherent, Breakwater reads specific pattern files from `~/svh-hub` during Plan 01. This document lists every pattern port, the source file, the Breakwater target, and the reason.

**Rule:** Patterns are re-written for Breakwater context. No copy-paste. No business logic. No branding. No rate limits. No email templates. No seed data.

## Phase A ports

| SVH Hub source | Breakwater target | Rationale |
| --- | --- | --- |
| `src/lib/prisma.ts` | `src/lib/prisma.ts` | Same singleton + HMR pattern; Breakwater re-writes with its own log-level defaults. |

## Phase C ports

(Filled in at end of Phase C.)

## Phase E ports

(Filled in at end of Phase E.)

## Never-port list

- `src/lib/{activity,email,anthropic,drive,fireflies,googleDrive,matchingUtils}.ts` — SVH business logic.
- `src/components/{ActivityFeed,actions,admin,assistant,capture,clients,dashboard,digest,inbox,layout,meeting-notes,profile,projects,providers}/*` — SVH features.
- `prisma/schema.prisma` — Breakwater has its own schema per §4 of the spec.
- `src/app/layout.tsx` — Breakwater has its own nav, brand, typography.
- Any SVH email templates — Breakwater templates per §6.2.
- Rate-limit profiles — Breakwater uses its own 3/hr unauth, 10/hr auth per §5.1.
- Seed data — Breakwater seeds 3 CURATED protocols per §4.3; SVH seeds ventures/clients.
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Deploy Phase A skeleton to Vercel preview; document SVH pattern ports"
git push
```

Verify the preview URL still returns 200 after this push.

**Phase A exit gate:**
- `pnpm build` passes locally
- `pnpm test` passes (no tests yet — vitest reports 0 tests, not failure)
- Vercel preview URL for `plan-01-scaffold` branch returns 200 with the starter page
- Railway dev database exists and Prisma migrate status is clean
- `PORTS.md` committed

---

## Phase B — Data model (2 commits)

**Goal:** Prisma schema implements every model in spec §4, migrations apply cleanly to Railway, seed script idempotently upserts the system organization and three CURATED protocols.

**Risk:** Spec §4 has subtle constraints that are easy to miss: `(chain, primaryContractAddress)` uniqueness, the NextAuth adapter's `User.emailVerified` field name exactness, `ScanAttempt.cooldownKey` always in `${chain}:${normalizedAddress}` format, `Scan.expiresAt` defined but enforced by a Plan 02 cron. Skipping any one of these breaks later phases.
**Rollback:** If a migration corrupts the dev DB, drop and recreate the Railway Postgres (it's only dev data). For schema bugs caught during Phase C or D, add a new migration rather than editing `0001_init/` — migrations are immutable once applied.

### Task B.1 — Full Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

Spec references: §4.1 (enums), §4.2 (models), §4.4 (scoring-related fields).

- [ ] **Step 1: Add enums to `schema.prisma`**

Per §4.1:
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

- [ ] **Step 2: Add Organization, User, Protocol, ProtocolClaim models**

```prisma
model Organization {
  id        String            @id @default(cuid())
  name      String
  kind      OrganizationKind
  users     User[]
  protocols Protocol[]
  claims    ProtocolClaim[]
  subscriptions Subscription[]
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
}

model User {
  id             String     @id @default(cuid())
  email          String     @unique
  emailVerified  DateTime?  // EXACT field name required by @auth/prisma-adapter; DO NOT RENAME
  organizationId String?
  organization   Organization? @relation(fields: [organizationId], references: [id])
  scans          Scan[]
  scanAttempts   ScanAttempt[]
  accounts       Account[]
  sessions       Session[]
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
}

model Protocol {
  id                     String          @id @default(cuid())
  slug                   String          @unique
  displayName            String
  chain                  Chain
  primaryContractAddress String
  extraContractAddresses Json            @default("[]")
  domain                 String?
  logoUrl                String?
  ownershipStatus        OwnershipStatus
  organizationId         String?
  organization           Organization?   @relation(fields: [organizationId], references: [id])
  knownMultisigs         Json            @default("[]")
  expectedRiskProfile    Grade?
  latestDemoScanId       String?
  latestDemoScan         Scan?           @relation("ProtocolLatestDemoScan", fields: [latestDemoScanId], references: [id])
  scans                  Scan[]          @relation("ProtocolScans")
  claims                 ProtocolClaim[]
  createdAt              DateTime        @default(now())
  updatedAt              DateTime        @updatedAt

  @@unique([chain, primaryContractAddress])
}

model ProtocolClaim {
  id             String       @id @default(cuid())
  protocolId     String
  protocol       Protocol     @relation(fields: [protocolId], references: [id])
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  proofMethod    ClaimMethod
  proofData      Json
  status         ClaimStatus  @default(PENDING)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}
```

- [ ] **Step 3: Add Scan, ScanAttempt, ModuleRun, Finding, Subscription models**

```prisma
model Scan {
  id                   String       @id @default(uuid())
  protocolId           String
  protocol             Protocol     @relation("ProtocolScans", fields: [protocolId], references: [id])
  latestDemoForProtocol Protocol[]  @relation("ProtocolLatestDemoScan")
  submittedByUserId    String?
  submittedByUser      User?        @relation(fields: [submittedByUserId], references: [id])
  submittedEmail       String?
  submittedEmailHash   String?
  ipHash               String
  userAgent            String
  status               ScanStatus   @default(QUEUED)
  compositeScore       Int?
  compositeGrade       Grade?
  isPartialGrade       Boolean      @default(false)
  expiresAt            DateTime
  createdAt            DateTime     @default(now())
  completedAt          DateTime?
  modules              ModuleRun[]
  findings             Finding[]
  scanAttempts         ScanAttempt[]

  @@index([submittedEmail])
  @@index([expiresAt])
}

model ScanAttempt {
  id                String              @id @default(cuid())
  ipHash            String
  userId            String?
  user              User?               @relation(fields: [userId], references: [id])
  attemptedAt       DateTime            @default(now())
  status            ScanAttemptStatus
  reason            String
  userAgent         String
  inputPayloadHash  String
  cooldownKey       String              // always ${chain}:${normalizedAddress} — NEVER Protocol.id
  scanId            String?             // set when status IN ('ACCEPTED', 'DUPLICATE')
  scan              Scan?               @relation(fields: [scanId], references: [id])

  @@index([ipHash, attemptedAt])
  @@index([userId, attemptedAt])
  @@index([inputPayloadHash, ipHash, attemptedAt])
  @@index([cooldownKey, attemptedAt])
}

model ModuleRun {
  id               String       @id @default(cuid())
  scanId           String
  scan             Scan         @relation(fields: [scanId], references: [id])
  module           ModuleName
  status           ModuleStatus @default(QUEUED)
  grade            Grade?
  score            Int?
  findingsCount    Int?
  startedAt        DateTime?
  completedAt      DateTime?
  attemptCount     Int          @default(0)
  errorMessage     String?
  errorStack       String?
  detectorVersions Json
  inputSnapshot    Json
  rpcCallsUsed     Int          @default(0)
  idempotencyKey   String       @unique
  findings         Finding[]

  @@unique([scanId, module])
}

model Finding {
  id                   String     @id @default(cuid())
  scanId               String
  scan                 Scan       @relation(fields: [scanId], references: [id])
  moduleRunId          String
  moduleRun            ModuleRun  @relation(fields: [moduleRunId], references: [id])
  module               ModuleName
  severity             Severity
  publicTitle          String
  title                String
  description          String
  evidence             Json
  affectedComponent    String
  references           Json
  remediationHint      String
  remediationDetailed  String
  publicRank           Int
  detectorId           String
  detectorVersion      Int
  createdAt            DateTime   @default(now())

  @@index([scanId, module])
}

model Subscription {
  id             String           @id @default(cuid())
  organizationId String
  organization   Organization     @relation(fields: [organizationId], references: [id])
  tier           SubscriptionTier @default(FREE)
  status         String
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt
}
```

- [ ] **Step 4: Add NextAuth adapter models verbatim**

Per §4.2 — fields exactly as published by `@auth/prisma-adapter` docs:

```prisma
model Account {
  id                String  @id @default(cuid())
  userId            String
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expires      DateTime
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

- [ ] **Step 5: Run `prisma format` and `prisma validate`**

```bash
pnpm prisma format
pnpm prisma validate
```
Expected: no errors. If there's a circular-relation error on Protocol ↔ Scan, that's expected to be the `ProtocolLatestDemoScan` named relation — re-check the two `@relation` names match on both sides.

- [ ] **Step 6: Generate the initial migration**

```bash
pnpm prisma migrate dev --name init
```
Expected: migration `0001_init/migration.sql` created, applies to Railway dev DB. `pnpm prisma studio` should open and show all tables empty.

- [ ] **Step 7: Verify the Prisma client types compile**

```bash
pnpm build
```
Expected: no TypeScript errors. The client types should flow into `src/lib/prisma.ts`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add full Prisma schema per spec §4 and initial migration"
```

### Task B.2 — System org migration + seed script

**Files:**
- Create: `prisma/migrations/0002_system_org/migration.sql`, `prisma/seed.ts`

- [ ] **Step 1: Write migration `0002_system_org`**

```bash
mkdir -p prisma/migrations/0002_system_org
```

File `prisma/migrations/0002_system_org/migration.sql`:
```sql
-- Seeds the System Organization that owns all CURATED Protocols.
-- Idempotent: safe to re-run in any environment.
INSERT INTO "Organization" ("id", "name", "kind", "createdAt", "updatedAt")
VALUES ('system-breakwater', 'Breakwater', 'SYSTEM', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
```

Apply:
```bash
pnpm prisma migrate dev --name system_org
```
(If prisma auto-names it differently, rename the directory to `0002_system_org` before committing and re-check `_prisma_migrations` status.)

- [ ] **Step 2: Write `prisma/seed.ts`**

Per §4.3 — three CURATED protocols. Use real addresses but placeholder `expectedRiskProfile` values. Do **not** embed fake findings or grades — see memory note `feedback_no_fabricated_data`.

```ts
import { PrismaClient, Chain, OwnershipStatus, Grade } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const seeds = [
    {
      slug: "aave-v3-ethereum",
      displayName: "Aave V3",
      chain: Chain.ETHEREUM,
      primaryContractAddress: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", // pool address, lowercase
      extraContractAddresses: [],
      domain: "aave.com",
      expectedRiskProfile: Grade.A,
    },
    {
      slug: "uniswap-v3-ethereum",
      displayName: "Uniswap V3",
      chain: Chain.ETHEREUM,
      primaryContractAddress: "0x1f98431c8ad98523631ae4a59f267346ea31f984", // factory, lowercase
      extraContractAddresses: [],
      domain: "uniswap.org",
      expectedRiskProfile: Grade.B,
    },
    {
      slug: "drift-solana",
      displayName: "Drift",
      chain: Chain.SOLANA,
      primaryContractAddress: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH", // program ID, preserve case
      extraContractAddresses: [],
      domain: "drift.trade",
      expectedRiskProfile: Grade.F,
    },
  ];

  for (const s of seeds) {
    await prisma.protocol.upsert({
      where: { chain_primaryContractAddress: { chain: s.chain, primaryContractAddress: s.primaryContractAddress } },
      update: {
        displayName: s.displayName,
        domain: s.domain,
        expectedRiskProfile: s.expectedRiskProfile,
      },
      create: {
        slug: s.slug,
        displayName: s.displayName,
        chain: s.chain,
        primaryContractAddress: s.primaryContractAddress,
        extraContractAddresses: s.extraContractAddresses,
        domain: s.domain,
        ownershipStatus: OwnershipStatus.CURATED,
        organizationId: "system-breakwater",
        expectedRiskProfile: s.expectedRiskProfile,
      },
    });
  }

  console.log(`Seeded ${seeds.length} CURATED protocols.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 3: Run the seed**

```bash
pnpm db:seed
```
Expected: "Seeded 3 CURATED protocols." Running again should be a no-op (upserts match existing rows).

- [ ] **Step 4: Verify via Prisma studio or psql**

Open studio or run a quick query to confirm three `CURATED` Protocols linked to `system-breakwater` org.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Seed system organization and three CURATED protocols (Aave, Uniswap, Drift)"
git push
```

Wait for Vercel preview to redeploy successfully.

**Phase B exit gate:**
- `pnpm build` passes
- Railway dev DB has all tables + 1 org row + 3 protocol rows
- `pnpm prisma migrate status` shows clean state
- Vercel preview still returns 200 (landing page unchanged — still Next starter)

---

## Phase C — Auth pipeline (5 commits, re-scoped from original 2 — see Revision log)

**Goal:** Magic-link auth works end-to-end. An unauthenticated user who submits `submittedEmail` with a scan, then later visits the magic-link URL, ends up with an account and their prior anonymous scans linked by email match.

**Risk:** Resend delivery fails (sandbox domain, invalid API key, DNS) and auth flow can't be tested. Or the NextAuth Prisma adapter silently mis-matches on a field name (e.g., `emailVerifiedAt` vs `emailVerified`).
**Rollback:** C.1 ships with a console-log `sendVerificationRequest`, so the auth foundation is validated before Resend ever enters the picture. If C.2 Resend wiring blocks, the console-log path from C.1 remains available via the `!RESEND_API_KEY` guard for local testing until the delivery issue is resolved.

**Re-scope rationale (2026-04-20):** Original Phase C was two bundles (C.1 = NextAuth + Resend + both email templates + scanLinking stub; C.2 = integration test + E2E). That's too coarse for a clean Codex round — if anything breaks, it's unclear whether the failure is in the adapter wiring, Resend, template rendering, or the callback. Split into 5 sub-tasks so the auth foundation (C.1) can be validated before email delivery, templating, and post-auth callbacks are layered on top.

### Task C.1 — NextAuth config skeleton + Prisma adapter (dev console-log magic link)

**Scope:** Wire NextAuth with the Prisma adapter and a console-log `sendVerificationRequest`. No Resend, no email templates, no scan-linking. This slice should build cleanly and `/api/auth/signin` → submit email → paste the console URL → signed-in flow should work entirely offline.

**Files:**
- Create: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/auth/verify-request/page.tsx`
- Modify: `package.json`, `pnpm-lock.yaml` (deps: `next-auth@4`, `@auth/prisma-adapter`)

Spec references: §6 (auth flow), §6.1 (NextAuth config — skeleton slice).

> **Env var scoping note (A.3 fallout):** Vercel CLI 51.8.0 in non-interactive mode forces Preview env vars to be scoped to a specific git branch. The A.3 vars are all scoped to `plan-01-scaffold`. When later C tasks add `RESEND_API_KEY` / update `NEXTAUTH_URL`, scope them to `plan-01-scaffold` too. Assume branch-scoped until explicitly widened.

- [ ] **Step 1: Install NextAuth + Prisma adapter**

```bash
pnpm add next-auth@4 @auth/prisma-adapter
```
Expected: `next-auth@^4.24.x` and `@auth/prisma-adapter@^1.x` in `package.json` dependencies. Resend and `@react-email/components` are deferred to C.2/C.3.

- [ ] **Step 2: Write `src/lib/auth.ts` (skeleton)**

Reference-only: `~/svh-hub/src/lib/auth.ts` for the NextAuth + adapter pattern shape. Do not import from it. Write fresh — keep the skeleton minimal: no Resend, no emails/, no scanLinking, no `events.signIn`. `sendVerificationRequest` just logs to the dev console.

```ts
import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import { prisma } from "@/lib/prisma";

const fromEmail =
  process.env.RESEND_FROM_EMAIL ?? "Breakwater <noreply@breakwater.local>";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    EmailProvider({
      from: fromEmail,
      sendVerificationRequest: async ({ identifier, url }) => {
        console.log(`[auth] (dev) magic link for ${identifier}: ${url}`);
      },
      maxAge: 24 * 60 * 60,
    }),
  ],
  pages: {
    verifyRequest: "/auth/verify-request",
  },
};
```

- [ ] **Step 3: Write `src/app/api/auth/[...nextauth]/route.ts`**

```ts
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

- [ ] **Step 4: Write `src/app/auth/verify-request/page.tsx`**

```tsx
export default function VerifyRequestPage() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", padding: 32, textAlign: "center" }}>
      <h1>Check your email</h1>
      <p>A sign-in link has been sent to your inbox. The link expires in 24 hours.</p>
    </main>
  );
}
```

- [ ] **Step 5: Build + dev sanity check**

```bash
pnpm build
```
Expected: builds cleanly.

```bash
pnpm dev
```
Navigate to `http://localhost:3000/api/auth/signin`. Submit an email. Watch the terminal for `[auth] (dev) magic link for <email>: http://localhost:3000/api/auth/callback/email?...`. Paste that URL into the browser — NextAuth sets a session cookie and redirects you. Verify via `pnpm prisma studio`: `User` row with matching email, `Session` row linked to that user, `VerificationToken` row cleared (one-shot).

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "C.1: NextAuth v4 skeleton with Prisma adapter + dev console-log magic link"
git push
```

### Task C.2 — Resend integration + production magic-link delivery

**Scope:** Replace the console-log `sendVerificationRequest` with a real Resend send. Use a minimal plain-HTML email for now — dual templates land in C.3. The `!process.env.RESEND_API_KEY` fallback keeps the console path available for local work without network.

**Files:**
- Create: `src/lib/resend.ts`
- Modify: `src/lib/auth.ts`, `.env` (local `RESEND_API_KEY`)

Spec references: §6.1 (production send path).

- [ ] **Step 1: Install Resend SDK**

```bash
pnpm add resend
```

- [ ] **Step 2: Write `src/lib/resend.ts`**

```ts
import { Resend } from "resend";

if (!process.env.RESEND_API_KEY) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY is required in production");
  }
  console.warn("[resend] RESEND_API_KEY not set — email send will no-op in dev");
}

export const resend = new Resend(process.env.RESEND_API_KEY ?? "dev-noop");

export const fromEmail = process.env.RESEND_FROM_EMAIL ?? "Breakwater <noreply@breakwater.local>";
```

- [ ] **Step 3: Update `src/lib/auth.ts` — replace console-log with Resend send (minimal HTML)**

Replace the local `fromEmail` constant with an import from `@/lib/resend`, and swap the skeleton `sendVerificationRequest` for:

```ts
import { resend, fromEmail } from "@/lib/resend";

// inside EmailProvider:
sendVerificationRequest: async ({ identifier, url }) => {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[auth] (dev) magic link for ${identifier}: ${url}`);
    return;
  }
  await resend.emails.send({
    from: fromEmail,
    to: identifier,
    subject: "Sign in to Breakwater",
    html: `<p>Click to sign in: <a href="${url}">${url}</a></p><p>This link expires in 24 hours.</p>`,
  });
},
```

- [ ] **Step 4: Add `RESEND_API_KEY` to local `.env` and Vercel Preview (scoped `plan-01-scaffold`)**

```bash
# local
printf 'RESEND_API_KEY="re_..."\n' >> .env

# Vercel (branch-scoped per A.3)
vercel env add RESEND_API_KEY preview --git-branch plan-01-scaffold
```

- [ ] **Step 5: Build + manual E2E with real delivery**

```bash
pnpm build && pnpm dev
```
Navigate to `/api/auth/signin`, submit a real email, confirm inbox receipt, click magic link, verify signed-in state.

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "C.2: Wire Resend for production magic-link delivery (minimal HTML)"
git push
```

### Task C.3 — Dual email templates (signin vs signup-unlock)

**Scope:** Replace the minimal plain HTML from C.2 with two React Email templates. `sendVerificationRequest` picks between them based on whether a pending anonymous scan exists for the email address (signup-unlock mode) or not (signin mode).

**Files:**
- Create: `src/emails/SigninEmail.tsx`, `src/emails/SignupUnlockEmail.tsx`
- Modify: `src/lib/auth.ts`

Spec references: §6.2 (dual template modes).

- [ ] **Step 1: Install `@react-email/components`**

```bash
pnpm add @react-email/components
```

- [ ] **Step 2: Write `src/emails/SigninEmail.tsx`**

Reference-only: `~/svh-hub/src/emails/*` if it exists — read one as a structural pattern, then write Breakwater templates fresh with Breakwater copy.

```tsx
import { Html, Head, Body, Container, Heading, Text, Button, Hr } from "@react-email/components";

export function SigninEmail({ magicLink }: { magicLink: string }) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: "#0C1C3A", color: "#E6EEF9", fontFamily: "Inter, sans-serif", margin: 0, padding: "40px 0" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: 32, backgroundColor: "rgba(23, 48, 107, 0.5)", borderRadius: 12 }}>
          <Heading style={{ fontSize: 24, fontWeight: 600, margin: "0 0 16px 0" }}>Sign in to Breakwater</Heading>
          <Text style={{ fontSize: 16, lineHeight: 1.5, margin: "0 0 24px 0" }}>
            Click the button below to sign in. This link expires in 24 hours.
          </Text>
          <Button href={magicLink} style={{ display: "inline-block", padding: "12px 24px", backgroundColor: "#2FB4C7", color: "#0C1C3A", textDecoration: "none", borderRadius: 8, fontWeight: 600 }}>
            Sign in
          </Button>
          <Hr style={{ borderColor: "#1F3A7A", margin: "32px 0 16px 0" }} />
          <Text style={{ fontSize: 12, color: "#8FA3C5", margin: 0 }}>
            If you didn't request this, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 3: Write `src/emails/SignupUnlockEmail.tsx`**

```tsx
import { Html, Head, Body, Container, Heading, Text, Button, Hr } from "@react-email/components";

export function SignupUnlockEmail({ magicLink, protocolName }: { magicLink: string; protocolName: string }) {
  return (
    <Html>
      <Head />
      <Body style={{ backgroundColor: "#0C1C3A", color: "#E6EEF9", fontFamily: "Inter, sans-serif", margin: 0, padding: "40px 0" }}>
        <Container style={{ maxWidth: 560, margin: "0 auto", padding: 32, backgroundColor: "rgba(23, 48, 107, 0.5)", borderRadius: 12 }}>
          <Heading style={{ fontSize: 24, fontWeight: 600, margin: "0 0 16px 0" }}>Unlock your Breakwater scan</Heading>
          <Text style={{ fontSize: 16, lineHeight: 1.5, margin: "0 0 24px 0" }}>
            Your scan of <strong>{protocolName}</strong> is ready. Click below to see all findings and remediation hints.
          </Text>
          <Button href={magicLink} style={{ display: "inline-block", padding: "12px 24px", backgroundColor: "#2FB4C7", color: "#0C1C3A", textDecoration: "none", borderRadius: 8, fontWeight: 600 }}>
            View full results
          </Button>
          <Hr style={{ borderColor: "#1F3A7A", margin: "32px 0 16px 0" }} />
          <Text style={{ fontSize: 12, color: "#8FA3C5", margin: 0 }}>
            You're signing in via magic link. No password needed.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 4: Update `src/lib/auth.ts` — branch between templates**

Replace C.2's minimal HTML `sendVerificationRequest` with the branching version:

```ts
import { render } from "@react-email/render";
import { SigninEmail } from "@/emails/SigninEmail";
import { SignupUnlockEmail } from "@/emails/SignupUnlockEmail";

// inside EmailProvider:
sendVerificationRequest: async ({ identifier: email, url }) => {
  const pendingScan = await prisma.scan.findFirst({
    where: { submittedEmail: email.toLowerCase(), submittedByUserId: null },
    orderBy: { createdAt: "desc" },
    include: { protocol: true },
  });

  const isUnlock = !!pendingScan;
  const html = isUnlock
    ? render(SignupUnlockEmail({ magicLink: url, protocolName: pendingScan!.protocol.displayName }))
    : render(SigninEmail({ magicLink: url }));
  const subject = isUnlock ? `Your Breakwater scan is ready` : `Sign in to Breakwater`;

  if (!process.env.RESEND_API_KEY) {
    console.log(`[auth] (dev) magic link for ${email} (${isUnlock ? "unlock" : "signin"}): ${url}`);
    return;
  }

  await resend.emails.send({ from: fromEmail, to: email, subject, html });
},
```

- [ ] **Step 5: Manual E2E — verify both templates**

1. Submit an email with no pending scan → SigninEmail received.
2. Create a `Scan` with `submittedEmail=<test>` and `submittedByUserId=null`, then sign in → SignupUnlockEmail received with correct `protocolName`.

- [ ] **Step 6: Commit + push**

```bash
git add -A
git commit -m "C.3: Add dual email templates (signin vs signup-unlock)"
git push
```

### Task C.4 — Post-auth callback + anonymous scan linking

**Scope:** When a user signs in, retroactively link any prior anonymous scans submitted with the same email to their new user ID.

**Files:**
- Create: `src/lib/scanLinking.ts`
- Modify: `src/lib/auth.ts` (add `events.signIn` callback)

Spec references: §6 (post-auth behavior).

- [ ] **Step 1: Write `src/lib/scanLinking.ts`**

```ts
import { prisma } from "@/lib/prisma";

export async function linkAnonymousScans({ email, userId }: { email: string; userId: string }) {
  await prisma.scan.updateMany({
    where: {
      submittedEmail: email.toLowerCase(),
      submittedByUserId: null,
    },
    data: { submittedByUserId: userId },
  });
}
```

- [ ] **Step 2: Wire `events.signIn` in `src/lib/auth.ts`**

```ts
import { linkAnonymousScans } from "@/lib/scanLinking";

// inside authOptions:
events: {
  async signIn({ user }) {
    if (!user.email) return;
    await linkAnonymousScans({ email: user.email, userId: user.id });
  },
},
```

- [ ] **Step 3: Manual E2E**

1. Submit a scan with `submittedEmail=<new email>` (anonymous).
2. Sign in with that email (via NextAuth flow).
3. Verify `Scan.submittedByUserId` is now set to the new user's ID via Prisma studio.

- [ ] **Step 4: Commit + push**

```bash
git add -A
git commit -m "C.4: Link anonymous scans on sign-in via events.signIn callback"
git push
```

### Task C.5 — End-to-end auth test + Lighthouse check

**Scope:** Automate the scan-linking logic with an integration test gated on `INTEGRATION_DB` (Vitest is already installed — Phase B Codex round 2b). Run Lighthouse against the verify-request page to catch accessibility regressions from the auth shell. Close out Phase C by documenting ports.

**Files:**
- Create: `src/lib/scanLinking.test.ts`
- Modify: `PORTS.md` (append Phase C ports table)

- [ ] **Step 1: Write `src/lib/scanLinking.test.ts`**

Integration test — hits the real Prisma client against the Railway dev DB. Gated behind `INTEGRATION_DB` so unit CI doesn't require a DB.

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { linkAnonymousScans } from "@/lib/scanLinking";

const ENABLED = !!process.env.INTEGRATION_DB;
const describeIf = ENABLED ? describe : describe.skip;

describeIf("linkAnonymousScans", () => {
  const testEmail = "integration-test@breakwater.local";
  let protocolId: string;

  beforeEach(async () => {
    await prisma.scan.deleteMany({ where: { submittedEmail: testEmail } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    const proto = await prisma.protocol.upsert({
      where: { chain_primaryContractAddress: { chain: "ETHEREUM", primaryContractAddress: "0xdeadbeef00000000000000000000000000000000" } },
      create: {
        slug: `test-linking-${Date.now()}`,
        displayName: "Test Protocol (Linking)",
        chain: "ETHEREUM",
        primaryContractAddress: "0xdeadbeef00000000000000000000000000000000",
        extraContractAddresses: [],
        ownershipStatus: "UNCLAIMED",
      },
      update: {},
    });
    protocolId = proto.id;
  });

  afterAll(async () => {
    await prisma.scan.deleteMany({ where: { submittedEmail: testEmail } });
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.$disconnect();
  });

  it("links prior anonymous scans by email match", async () => {
    await prisma.scan.create({
      data: {
        protocolId,
        submittedEmail: testEmail,
        ipHash: "test-hash",
        userAgent: "test",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    const user = await prisma.user.create({ data: { email: testEmail } });

    await linkAnonymousScans({ email: testEmail, userId: user.id });

    const linked = await prisma.scan.findMany({ where: { submittedByUserId: user.id } });
    expect(linked).toHaveLength(1);
    expect(linked[0].submittedEmail).toBe(testEmail);
  });

  it("is idempotent — running twice does not re-link or error", async () => {
    const user = await prisma.user.create({ data: { email: testEmail } });
    await prisma.scan.create({
      data: { protocolId, submittedEmail: testEmail, ipHash: "x", userAgent: "x", expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    });

    await linkAnonymousScans({ email: testEmail, userId: user.id });
    await linkAnonymousScans({ email: testEmail, userId: user.id });

    const linked = await prisma.scan.findMany({ where: { submittedByUserId: user.id } });
    expect(linked).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test**

```bash
INTEGRATION_DB=1 pnpm test src/lib/scanLinking.test.ts
```
Expected: 2 passing.

- [ ] **Step 3: Lighthouse audit**

Against the Vercel preview (plan-01-scaffold), run Lighthouse mobile on `/auth/verify-request`. Expect Accessibility ≥ 90. Record the score in the commit message; investigate regressions before closing Phase C.

- [ ] **Step 4: Update `PORTS.md`**

Append to the "Phase C ports" section of `PORTS.md`:

```markdown
## Phase C ports

| SVH Hub source | Breakwater target | Rationale |
| --- | --- | --- |
| `src/lib/auth.ts` | `src/lib/auth.ts` | Same NextAuth + Prisma adapter + EmailProvider shape; Breakwater rewrites `sendVerificationRequest` to pick between SigninEmail and SignupUnlockEmail based on pending anonymous scan. |
| `src/emails/*` (structural) | `src/emails/SigninEmail.tsx`, `SignupUnlockEmail.tsx` | Same React Email component pattern; Breakwater copy and Storm Cyan styling. No SVH template text transferred. |
```

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "C.5: Scan-linking integration test + Lighthouse audit + Phase C ports"
git push
```

**Phase C exit gate:**
- `pnpm build` passes
- `INTEGRATION_DB=1 pnpm test` passes (when run against the dev DB)
- Magic-link sign-in works end-to-end in local dev (either via Resend or console fallback)
- Vercel preview deploy succeeds; `/api/auth/signin` returns the NextAuth UI
- Lighthouse mobile on `/auth/verify-request`: Accessibility ≥ 90
- `PORTS.md` updated with Phase C entries

---

## Phase D — Scan API (3 commits)

**Goal:** `POST /api/scan` implements the full lookup-first flow per §5.1 including the atomic cooldown guard, `GET /api/scan/:id` returns a scan with server-side finding visibility gating per §5.3. Unit tests cover all pure helpers (hash, normalize, dedupe serialization, scoring); an integration test covers the end-to-end happy path and at least the curated and cooldown rejection branches.

**Risk:** The advisory lock + transaction in step 7 is the single most subtle piece of code in Plan 01. Getting it wrong (locking outside the transaction, wrong `SELECT` status filter, committing before the ACCEPTED insert) silently opens the race the lock is meant to close, and it won't be caught by a unit test of the pure helpers.
**Rollback:** If the advisory lock pattern proves unstable under Prisma's query abstractions, drop to raw SQL inside `prisma.$transaction(async (tx) => tx.$executeRawUnsafe(...))` with `SERIALIZABLE` isolation as a backup. Document the backup path in-code, not just as an option — the lock is mandatory per §5.1, so the backup must also close the race.

### Task D.1 — Pure helpers (normalize, hash, dedupe, scoring, errors)

**Files:**
- Create: `src/lib/normalize.ts`, `src/lib/hash.ts`, `src/lib/dedupe.ts`, `src/lib/scoring.ts`, `src/lib/errors.ts`
- Create tests: `src/lib/normalize.test.ts`, `src/lib/hash.test.ts`, `src/lib/dedupe.test.ts`, `src/lib/scoring.test.ts`

TDD applies strongly here — these are pure functions.

- [ ] **Step 1: Write `src/lib/normalize.test.ts` (failing tests first)**

```ts
import { describe, it, expect } from "vitest";
import { normalizeAddress } from "@/lib/normalize";

describe("normalizeAddress", () => {
  it("lowercases EVM addresses", () => {
    expect(normalizeAddress("ETHEREUM", "0xABCDEF0123456789abcdef0123456789ABCDEF01"))
      .toBe("0xabcdef0123456789abcdef0123456789abcdef01");
  });
  it("preserves case for Solana addresses", () => {
    const sol = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH";
    expect(normalizeAddress("SOLANA", sol)).toBe(sol);
  });
  it("throws on empty input", () => {
    expect(() => normalizeAddress("ETHEREUM", "")).toThrow();
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

```bash
pnpm test src/lib/normalize.test.ts
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/normalize.ts`**

```ts
import type { Chain } from "@prisma/client";

export function normalizeAddress(chain: Chain, address: string): string {
  if (!address || !address.trim()) {
    throw new Error("address is required");
  }
  const trimmed = address.trim();
  return chain === "ETHEREUM" ? trimmed.toLowerCase() : trimmed;
}
```

- [ ] **Step 4: Run tests, confirm green**

```bash
pnpm test src/lib/normalize.test.ts
```
Expected: 3 passing.

- [ ] **Step 5: Write `src/lib/hash.test.ts` and `src/lib/hash.ts`**

```ts
// src/lib/hash.test.ts
import { describe, it, expect } from "vitest";
import { sha256Hex, hashIp, hashEmail } from "@/lib/hash";

describe("sha256Hex", () => {
  it("is deterministic and hex-encoded", () => {
    expect(sha256Hex("abc")).toBe(sha256Hex("abc"));
    expect(sha256Hex("abc")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashIp", () => {
  it("is salted and differs without salt", () => {
    process.env.SCAN_IP_SALT = "salt1";
    const h1 = hashIp("1.2.3.4");
    process.env.SCAN_IP_SALT = "salt2";
    const h2 = hashIp("1.2.3.4");
    expect(h1).not.toBe(h2);
  });
});

describe("hashEmail", () => {
  it("lowercases before hashing", () => {
    process.env.SCAN_EMAIL_SALT = "s";
    expect(hashEmail("Foo@Bar.com")).toBe(hashEmail("foo@bar.com"));
  });
});
```

```ts
// src/lib/hash.ts
import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashIp(ip: string): string {
  const salt = process.env.SCAN_IP_SALT;
  if (!salt) throw new Error("SCAN_IP_SALT not configured");
  return sha256Hex(`${ip}|${salt}`);
}

export function hashEmail(email: string): string {
  const salt = process.env.SCAN_EMAIL_SALT;
  if (!salt) throw new Error("SCAN_EMAIL_SALT not configured");
  return sha256Hex(`${email.toLowerCase()}|${salt}`);
}
```

Run: `pnpm test src/lib/hash.test.ts` — expect 3 passing.

- [ ] **Step 6: Write `src/lib/dedupe.test.ts` and `src/lib/dedupe.ts`**

```ts
// src/lib/dedupe.test.ts
import { describe, it, expect } from "vitest";
import { computePayloadHash, deterministicSerialize } from "@/lib/dedupe";

describe("deterministicSerialize", () => {
  it("sorts arrays alphabetically", () => {
    const a = deterministicSerialize({ items: ["b", "a", "c"] });
    const b = deterministicSerialize({ items: ["c", "a", "b"] });
    expect(a).toBe(b);
  });
  it("preserves key order given a fixed key list", () => {
    const out = deterministicSerialize({ b: 1, a: 2 });
    // canonical: keys sorted
    expect(out.indexOf('"a"')).toBeLessThan(out.indexOf('"b"'));
  });
});

describe("computePayloadHash", () => {
  it("is identical regardless of input array order", () => {
    const h1 = computePayloadHash({
      chain: "ETHEREUM",
      normalizedAddress: "0xabc",
      extraContractAddresses: ["0x2", "0x1"],
      domain: "x.com",
      multisigs: ["0xb", "0xa"],
      modulesEnabled: ["ORACLE", "GOVERNANCE"],
    });
    const h2 = computePayloadHash({
      chain: "ETHEREUM",
      normalizedAddress: "0xabc",
      extraContractAddresses: ["0x1", "0x2"],
      domain: "x.com",
      multisigs: ["0xa", "0xb"],
      modulesEnabled: ["GOVERNANCE", "ORACLE"],
    });
    expect(h1).toBe(h2);
  });
  it("differs when modulesEnabled differs", () => {
    const base = { chain: "ETHEREUM" as const, normalizedAddress: "0xabc", extraContractAddresses: [], domain: undefined, multisigs: [] };
    const h1 = computePayloadHash({ ...base, modulesEnabled: ["GOVERNANCE", "ORACLE"] });
    const h2 = computePayloadHash({ ...base, modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"] });
    expect(h1).not.toBe(h2);
  });
});
```

```ts
// src/lib/dedupe.ts
import { sha256Hex } from "@/lib/hash";
import type { Chain, ModuleName } from "@prisma/client";

type SerializableValue = string | number | boolean | null | undefined | SerializableValue[] | { [k: string]: SerializableValue };

export function deterministicSerialize(value: SerializableValue): string {
  if (value === null || value === undefined) return JSON.stringify(value ?? null);
  if (Array.isArray(value)) {
    const sorted = [...value].map(deterministicSerialize).sort();
    return `[${sorted.join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${deterministicSerialize((value as Record<string, SerializableValue>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export interface PayloadInput {
  chain: Chain;
  normalizedAddress: string;
  extraContractAddresses: string[];
  domain: string | undefined;
  multisigs: string[];
  modulesEnabled: ModuleName[];
}

export function computePayloadHash(input: PayloadInput): string {
  return sha256Hex(deterministicSerialize({
    chain: input.chain,
    normalizedAddress: input.normalizedAddress,
    extraContractAddresses: input.extraContractAddresses,
    domain: input.domain,
    multisigs: input.multisigs,
    modulesEnabled: input.modulesEnabled,
  }));
}

export function computeCooldownKey(chain: Chain, normalizedAddress: string): string {
  return `${chain}:${normalizedAddress}`;
}
```

Run: `pnpm test src/lib/dedupe.test.ts` — expect all passing.

- [ ] **Step 7: Write `src/lib/scoring.ts` and `src/lib/scoring.test.ts`**

Per §4.4:

```ts
// src/lib/scoring.ts
import type { Severity, ModuleName, Grade } from "@prisma/client";

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  CRITICAL: 25,
  HIGH: 10,
  MEDIUM: 4,
  LOW: 1,
  INFO: 0,
};

export const MODULE_WEIGHTS: Record<ModuleName, number> = {
  GOVERNANCE: 35,
  ORACLE: 30,
  SIGNER: 20,
  FRONTEND: 15,
};

export function computeModuleScore(findings: Array<{ severity: Severity }>): number {
  const deduction = findings.reduce((sum, f) => sum + SEVERITY_WEIGHTS[f.severity], 0);
  return Math.max(0, 100 - deduction);
}

export function applyHardFloors(score: number, findings: Array<{ severity: Severity }>): number {
  const criticalCount = findings.filter((f) => f.severity === "CRITICAL").length;
  const highCount = findings.filter((f) => f.severity === "HIGH").length;
  let capped = score;
  if (criticalCount >= 1) capped = Math.min(capped, 59);
  if (highCount >= 3) capped = Math.min(capped, 74);
  return capped;
}

export function toGrade(score: number): Grade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

export interface ModuleResult {
  module: ModuleName;
  score: number;
  skipped: boolean;
  findings: Array<{ severity: Severity }>;
}

export function computeCompositeScore(results: ModuleResult[]): { score: number; grade: Grade; isPartialGrade: boolean } {
  const active = results.filter((r) => !r.skipped);
  const totalWeight = active.reduce((sum, r) => sum + MODULE_WEIGHTS[r.module], 0);
  let composite = active.reduce((sum, r) => sum + r.score * MODULE_WEIGHTS[r.module], 0) / (totalWeight || 1);

  const govCrit = results.find((r) => r.module === "GOVERNANCE")?.findings.some((f) => f.severity === "CRITICAL");
  const oraCrit = results.find((r) => r.module === "ORACLE")?.findings.some((f) => f.severity === "CRITICAL");
  const sigCrit = results.find((r) => r.module === "SIGNER")?.findings.some((f) => f.severity === "CRITICAL");
  const feCrit = results.find((r) => r.module === "FRONTEND")?.findings.some((f) => f.severity === "CRITICAL");

  if (govCrit || oraCrit) composite = Math.min(composite, 59);
  else if (sigCrit || feCrit) composite = Math.min(composite, 69);

  return {
    score: Math.round(composite),
    grade: toGrade(composite),
    isPartialGrade: active.length < results.length,
  };
}
```

```ts
// src/lib/scoring.test.ts
import { describe, it, expect } from "vitest";
import { computeModuleScore, applyHardFloors, toGrade, computeCompositeScore } from "@/lib/scoring";

describe("computeModuleScore", () => {
  it("starts at 100 with no findings", () => {
    expect(computeModuleScore([])).toBe(100);
  });
  it("subtracts CRITICAL weight", () => {
    expect(computeModuleScore([{ severity: "CRITICAL" }])).toBe(75);
  });
});

describe("applyHardFloors", () => {
  it("caps at 59 with ≥ 1 CRITICAL", () => {
    expect(applyHardFloors(80, [{ severity: "CRITICAL" }])).toBe(59);
  });
  it("caps at 74 with ≥ 3 HIGH", () => {
    expect(applyHardFloors(85, [{ severity: "HIGH" }, { severity: "HIGH" }, { severity: "HIGH" }])).toBe(74);
  });
});

describe("toGrade", () => {
  it.each([
    [95, "A"], [80, "B"], [65, "C"], [45, "D"], [10, "F"],
  ])("maps %i to %s", (score, grade) => {
    expect(toGrade(score)).toBe(grade);
  });
});

describe("computeCompositeScore", () => {
  it("caps composite at D when GOVERNANCE has a CRITICAL", () => {
    const result = computeCompositeScore([
      { module: "GOVERNANCE", score: 100, skipped: false, findings: [{ severity: "CRITICAL" }] },
      { module: "ORACLE", score: 100, skipped: false, findings: [] },
      { module: "SIGNER", score: 100, skipped: false, findings: [] },
      { module: "FRONTEND", score: 100, skipped: false, findings: [] },
    ]);
    expect(result.grade).toBe("D");
    expect(result.isPartialGrade).toBe(false);
  });
  it("marks isPartialGrade when a module is skipped and re-weights", () => {
    const result = computeCompositeScore([
      { module: "GOVERNANCE", score: 100, skipped: false, findings: [] },
      { module: "ORACLE", score: 100, skipped: false, findings: [] },
      { module: "SIGNER", score: 100, skipped: false, findings: [] },
      { module: "FRONTEND", score: 100, skipped: true, findings: [] },
    ]);
    expect(result.isPartialGrade).toBe(true);
    expect(result.grade).toBe("A");
  });
});
```

Run: `pnpm test src/lib/scoring.test.ts` — expect all passing.

- [ ] **Step 8: Write `src/lib/errors.ts`**

```ts
export class RetryableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RetryableError";
  }
}

export class PermanentError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "PermanentError";
  }
}
```

No dedicated test — Plan 02 exercises this.

- [ ] **Step 9: Commit**

```bash
pnpm test
pnpm build
git add -A
git commit -m "Add pure helpers for normalize, hash, dedupe, scoring, errors"
```

### Task D.2 — POST /api/scan with atomic cooldown

**Files:**
- Create: `src/lib/rateLimit.ts`, `src/lib/cooldown.ts`, `src/app/api/scan/route.ts`
- Create tests: `src/lib/rateLimit.test.ts` (integration), `src/app/api/scan/route.test.ts` (integration, happy path + 2 rejection branches)

Spec reference: §5.1 — read the entire section before implementing. The 12-step ordering is intentional.

- [ ] **Step 1: Write `src/lib/rateLimit.ts`**

```ts
import { prisma } from "@/lib/prisma";

export async function countRecentAcceptedByIp(ipHash: string, windowMs = 60 * 60 * 1000): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  return prisma.scanAttempt.count({
    where: { ipHash, status: "ACCEPTED", attemptedAt: { gt: since } },
  });
}

export async function countRecentAcceptedByUser(userId: string, windowMs = 60 * 60 * 1000): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  return prisma.scanAttempt.count({
    where: { userId, status: "ACCEPTED", attemptedAt: { gt: since } },
  });
}

export async function findRecentDuplicate(
  ipHash: string,
  payloadHash: string,
  windowMs = 5 * 60 * 1000,
): Promise<{ scanId: string } | null> {
  const since = new Date(Date.now() - windowMs);
  const row = await prisma.scanAttempt.findFirst({
    where: {
      ipHash,
      inputPayloadHash: payloadHash,
      status: "ACCEPTED",
      attemptedAt: { gt: since },
      scanId: { not: null },
    },
    orderBy: { attemptedAt: "desc" },
    select: { scanId: true },
  });
  return row?.scanId ? { scanId: row.scanId } : null;
}
```

- [ ] **Step 2: Write `src/lib/cooldown.ts` — advisory-lock transaction helper**

```ts
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

const COOLDOWN_WINDOW_MS = 10 * 60 * 1000;

export interface CooldownResult {
  kind: "rejected" | "accepted";
  remainingMs?: number;
  tx?: Prisma.TransactionClient;
}

/**
 * Runs `work` inside a Postgres transaction guarded by
 * pg_advisory_xact_lock(hashtext(cooldownKey)). Returns { kind: 'rejected', remainingMs }
 * if a prior ACCEPTED scan for this cooldownKey is within the 10-minute window,
 * otherwise invokes `work(tx)` and returns { kind: 'accepted' }.
 *
 * Per spec §5.1 step 7 — this MUST be used around cooldown check + ACCEPTED insert.
 */
export async function withCooldownLock<T>(
  cooldownKey: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ kind: "rejected"; remainingMs: number } | { kind: "accepted"; result: T }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, cooldownKey);

    const since = new Date(Date.now() - COOLDOWN_WINDOW_MS);
    const recent = await tx.scanAttempt.findFirst({
      where: {
        cooldownKey,
        status: "ACCEPTED",
        attemptedAt: { gt: since },
      },
      orderBy: { attemptedAt: "desc" },
      select: { attemptedAt: true },
    });

    if (recent) {
      const elapsed = Date.now() - recent.attemptedAt.getTime();
      const remainingMs = Math.max(0, COOLDOWN_WINDOW_MS - elapsed);
      return { kind: "rejected", remainingMs };
    }

    const result = await work(tx);
    return { kind: "accepted", result };
  }, { isolationLevel: "ReadCommitted" });
}
```

- [ ] **Step 3: Write `src/app/api/scan/route.ts` — the POST handler**

Per §5.1 steps 1–12. This is the largest handler — write it carefully, referencing the spec section by step number.

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeAddress } from "@/lib/normalize";
import { hashIp, hashEmail } from "@/lib/hash";
import { computePayloadHash, computeCooldownKey } from "@/lib/dedupe";
import { countRecentAcceptedByIp, countRecentAcceptedByUser, findRecentDuplicate } from "@/lib/rateLimit";
import { withCooldownLock } from "@/lib/cooldown";
import { ModuleName, OwnershipStatus } from "@prisma/client";

const MODULES_ALL: ModuleName[] = ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"];

const BodySchema = z.object({
  chain: z.enum(["ETHEREUM", "SOLANA"]),
  primaryContractAddress: z.string().min(1),
  extraContractAddresses: z.array(z.string()).default([]),
  domain: z.string().optional(),
  multisigs: z.array(z.string()).default([]),
  modulesEnabled: z.array(z.enum(["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"])).default(MODULES_ALL),
  submittedEmail: z.string().email().optional(),
});

function getIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userAgent = req.headers.get("user-agent") ?? "unknown";
  const ip = getIp(req);
  const ipHash = hashIp(ip);

  // Step 1: parse + validate
  const raw = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    await prisma.scanAttempt.create({
      data: { ipHash, userAgent, status: "INVALID", reason: "schema", inputPayloadHash: "", cooldownKey: "" },
    });
    return NextResponse.json({ error: "schema_invalid" }, { status: 400 });
  }
  const body = parsed.data;

  // Step 2: normalize + hash
  const normalizedAddress = normalizeAddress(body.chain, body.primaryContractAddress);
  const payloadHash = computePayloadHash({
    chain: body.chain,
    normalizedAddress,
    extraContractAddresses: [...body.extraContractAddresses].sort(),
    domain: body.domain,
    multisigs: [...body.multisigs].sort(),
    modulesEnabled: [...body.modulesEnabled].sort(),
  });
  const cooldownKey = computeCooldownKey(body.chain, normalizedAddress);
  const submittedEmail = body.submittedEmail?.toLowerCase();
  const submittedEmailHash = submittedEmail ? hashEmail(submittedEmail) : null;

  // Step 3: IP / user rate limit
  if (session?.user?.id) {
    const count = await countRecentAcceptedByUser(session.user.id);
    if (count >= 10) {
      await prisma.scanAttempt.create({
        data: { ipHash, userId: session.user.id, userAgent, status: "RATE_LIMITED", reason: "user_hour", inputPayloadHash: payloadHash, cooldownKey },
      });
      return NextResponse.json({ error: "rate_limited", scope: "user_hour" }, { status: 429 });
    }
  } else {
    const count = await countRecentAcceptedByIp(ipHash);
    if (count >= 3) {
      await prisma.scanAttempt.create({
        data: { ipHash, userAgent, status: "RATE_LIMITED", reason: "ip_hour", inputPayloadHash: payloadHash, cooldownKey },
      });
      return NextResponse.json({ error: "rate_limited", scope: "ip_hour" }, { status: 429 });
    }
  }

  // Step 4: dedupe
  const dup = await findRecentDuplicate(ipHash, payloadHash);
  if (dup) {
    await prisma.scanAttempt.create({
      data: { ipHash, userId: session?.user?.id ?? null, userAgent, status: "DUPLICATE", reason: "dedupe_recent_identical", inputPayloadHash: payloadHash, cooldownKey, scanId: dup.scanId },
    });
    return NextResponse.json({ scanId: dup.scanId }, { status: 200 });
  }

  // Step 5: protocol lookup (read-only)
  const existing = await prisma.protocol.findUnique({
    where: { chain_primaryContractAddress: { chain: body.chain, primaryContractAddress: normalizedAddress } },
  });

  // Step 6: curated check — no state change
  if (existing?.ownershipStatus === OwnershipStatus.CURATED) {
    await prisma.scanAttempt.create({
      data: { ipHash, userId: session?.user?.id ?? null, userAgent, status: "INVALID", reason: "protocol_is_curated", inputPayloadHash: payloadHash, cooldownKey },
    });
    const demoUrl = existing.latestDemoScanId
      ? `/scan/${existing.latestDemoScanId}`
      : `/demo/${existing.slug}`;
    return NextResponse.json(
      {
        error: "curated_protocol",
        message: "This protocol is a Breakwater demo. Cached results available.",
        demoUrl,
      },
      { status: 409 },
    );
  }

  // Steps 7–11: atomic cooldown + Protocol upsert + Scan + ModuleRuns + ScanAttempt(ACCEPTED)
  const guard = await withCooldownLock(cooldownKey, async (tx) => {
    const protocol = existing
      ? existing
      : await tx.protocol.create({
          data: {
            slug: `${body.chain.toLowerCase()}-${normalizedAddress.slice(0, 8)}-${Date.now().toString(36)}`,
            displayName: `Protocol ${normalizedAddress.slice(0, 10)}…`,
            chain: body.chain,
            primaryContractAddress: normalizedAddress,
            extraContractAddresses: body.extraContractAddresses,
            domain: body.domain,
            ownershipStatus: OwnershipStatus.UNCLAIMED,
          },
        });

    const now = new Date();
    const scan = await tx.scan.create({
      data: {
        protocolId: protocol.id,
        submittedByUserId: session?.user?.id ?? null,
        submittedEmail,
        submittedEmailHash,
        ipHash,
        userAgent,
        status: "QUEUED",
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const hourBucket = Math.floor(now.getTime() / (60 * 60 * 1000));
    await tx.moduleRun.createMany({
      data: MODULES_ALL.map((module) => {
        const skipped = !body.modulesEnabled.includes(module) || (module === "FRONTEND" && !body.domain);
        return {
          scanId: scan.id,
          module,
          status: skipped ? "SKIPPED" : "QUEUED",
          detectorVersions: {},
          inputSnapshot: {
            chain: body.chain,
            normalizedAddress,
            extraContractAddresses: body.extraContractAddresses,
            domain: body.domain ?? null,
            multisigs: body.multisigs,
            modulesEnabled: body.modulesEnabled,
          },
          idempotencyKey: `${scan.id}:${module}:${hourBucket}`,
        };
      }),
    });

    await tx.scanAttempt.create({
      data: {
        ipHash,
        userId: session?.user?.id ?? null,
        userAgent,
        status: "ACCEPTED",
        reason: "accepted",
        inputPayloadHash: payloadHash,
        cooldownKey,
        scanId: scan.id,
      },
    });

    return { scanId: scan.id };
  });

  if (guard.kind === "rejected") {
    await prisma.scanAttempt.create({
      data: { ipHash, userId: session?.user?.id ?? null, userAgent, status: "RATE_LIMITED", reason: "protocol_cooldown", inputPayloadHash: payloadHash, cooldownKey },
    });
    return NextResponse.json(
      { error: "rate_limited", scope: "protocol_cooldown" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(guard.remainingMs / 1000)) } },
    );
  }

  // Step 12
  return NextResponse.json({ scanId: guard.result.scanId }, { status: 202 });
}
```

- [ ] **Step 4: Integration test — happy path + curated + cooldown branches**

Write `src/app/api/scan/route.test.ts`. Because Next App Router route handlers are hard to import directly in Vitest, use `node-mocks-http` or Next's `supertest`-compatible harness, or hit a dev server. For speed, hit the helpers directly and round-trip via a test wrapper:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { POST } from "@/app/api/scan/route";

const ENABLED = !!process.env.INTEGRATION_DB;
const describeIf = ENABLED ? describe : describe.skip;

function mkRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/scan", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "test", "x-forwarded-for": "10.0.0.1", ...headers },
    body: JSON.stringify(body),
  });
}

describeIf("POST /api/scan", () => {
  beforeAll(() => {
    process.env.SCAN_IP_SALT = process.env.SCAN_IP_SALT ?? "test-salt";
    process.env.SCAN_EMAIL_SALT = process.env.SCAN_EMAIL_SALT ?? "test-salt";
  });

  beforeEach(async () => {
    await prisma.scanAttempt.deleteMany({ where: { userAgent: "test" } });
    await prisma.moduleRun.deleteMany({});
    await prisma.scan.deleteMany({ where: { userAgent: "test" } });
    await prisma.protocol.deleteMany({ where: { ownershipStatus: "UNCLAIMED" } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a Scan + 4 ModuleRuns + ScanAttempt(ACCEPTED) on happy path", async () => {
    const res = await POST(mkRequest({ chain: "ETHEREUM", primaryContractAddress: "0xAAAAAAAA00000000000000000000000000000000" }));
    expect(res.status).toBe(202);
    const { scanId } = await res.json();
    const modules = await prisma.moduleRun.findMany({ where: { scanId } });
    expect(modules).toHaveLength(4);
    const accepted = await prisma.scanAttempt.findFirst({ where: { scanId, status: "ACCEPTED" } });
    expect(accepted).toBeTruthy();
  });

  it("returns 409 curated_protocol without creating Scan/ModuleRuns", async () => {
    // Assumes seed has run — Aave V3 is CURATED
    const res = await POST(mkRequest({ chain: "ETHEREUM", primaryContractAddress: "0x87870BCA3F3FD6335C3F4CE8392D69350B4FA4E2" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("curated_protocol");
    expect(body.demoUrl).toBeTruthy();
  });

  it("rejects a second submission within the cooldown window with 429 + Retry-After", async () => {
    const addr = "0xBBBBBBBB00000000000000000000000000000000";
    const r1 = await POST(mkRequest({ chain: "ETHEREUM", primaryContractAddress: addr }));
    expect(r1.status).toBe(202);
    // Second submission immediately after:
    const r2 = await POST(mkRequest({ chain: "ETHEREUM", primaryContractAddress: addr }, { "x-forwarded-for": "10.0.0.2" }));
    expect(r2.status).toBe(429);
    expect(r2.headers.get("Retry-After")).toBeTruthy();
  });
});
```

Run: `INTEGRATION_DB=1 pnpm test src/app/api/scan/route.test.ts` — expect 3 passing.

- [ ] **Step 5: Commit**

```bash
pnpm build
git add -A
git commit -m "Implement POST /api/scan per §5.1 with atomic cooldown guard"
```

### Task D.3 — GET /api/scan/[id] with visibility gating

**Files:**
- Create: `src/app/api/scan/[id]/route.ts`, `src/lib/findingVisibility.ts`
- Create tests: `src/lib/findingVisibility.test.ts`

Spec references: §5.2 (endpoint shape), §5.3 (visibility rules).

- [ ] **Step 1: Write `src/lib/findingVisibility.test.ts` and `src/lib/findingVisibility.ts`**

```ts
// src/lib/findingVisibility.test.ts
import { describe, it, expect } from "vitest";
import { filterFindingsForViewer } from "@/lib/findingVisibility";

const base = {
  id: "f1",
  module: "GOVERNANCE" as const,
  severity: "CRITICAL" as const,
  publicTitle: "Privileged control detected",
  title: "Owner holds unchecked upgradeability",
  description: "…",
  evidence: { tx: "0x…" },
  affectedComponent: "Proxy",
  references: [],
  remediationHint: "Audit upgrade path",
  remediationDetailed: "…",
  publicRank: 1,
  detectorId: "GOV-001",
  detectorVersion: 1,
};

describe("filterFindingsForViewer", () => {
  it("unauth: returns only publicRank=1 findings stripped of sensitive fields", () => {
    const out = filterFindingsForViewer([base, { ...base, id: "f2", publicRank: 2 }], "unauth");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("f1");
    expect(out[0]).not.toHaveProperty("title");
    expect(out[0]).not.toHaveProperty("evidence");
    expect(out[0]).not.toHaveProperty("remediationDetailed");
  });
  it("email: returns all findings but strips remediationDetailed", () => {
    const out = filterFindingsForViewer([base, { ...base, id: "f2", publicRank: 2 }], "email");
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveProperty("title");
    expect(out[0]).not.toHaveProperty("remediationDetailed");
  });
});
```

```ts
// src/lib/findingVisibility.ts
import type { Finding } from "@prisma/client";

export type ViewerKind = "unauth" | "email" | "paid";

export function filterFindingsForViewer(findings: Finding[], viewer: ViewerKind): Partial<Finding>[] {
  if (viewer === "paid") return findings;

  if (viewer === "email") {
    return findings.map(({ remediationDetailed, ...rest }) => rest);
  }

  const perModule = new Map<string, Finding>();
  for (const f of findings) {
    const existing = perModule.get(f.module);
    if (!existing || f.publicRank < existing.publicRank) perModule.set(f.module, f);
  }
  return Array.from(perModule.values()).map((f) => ({
    id: f.id,
    module: f.module,
    severity: f.severity,
    publicTitle: f.publicTitle,
    remediationHint: f.remediationHint,
    affectedComponent: f.affectedComponent,
    detectorId: f.detectorId,
  }));
}
```

Run: `pnpm test src/lib/findingVisibility.test.ts` — expect passing.

- [ ] **Step 2: Write `src/app/api/scan/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { filterFindingsForViewer } from "@/lib/findingVisibility";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const scan = await prisma.scan.findUnique({
    where: { id: params.id },
    include: {
      protocol: { select: { slug: true, displayName: true, chain: true, domain: true, ownershipStatus: true } },
      modules: true,
      findings: true,
    },
  });

  if (!scan) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const session = await getServerSession(authOptions);
  const viewer: "unauth" | "email" | "paid" =
    session?.user?.id ? "email" : "unauth";

  return NextResponse.json({
    id: scan.id,
    status: scan.status,
    compositeScore: scan.compositeScore,
    compositeGrade: scan.compositeGrade,
    isPartialGrade: scan.isPartialGrade,
    createdAt: scan.createdAt,
    completedAt: scan.completedAt,
    expiresAt: scan.expiresAt,
    protocol: scan.protocol,
    modules: scan.modules.map((m) => ({ ...m, errorStack: viewer === "paid" ? m.errorStack : null })),
    findings: filterFindingsForViewer(scan.findings, viewer),
  });
}
```

- [ ] **Step 3: Run tests + build + commit**

```bash
pnpm test
pnpm build
git add -A
git commit -m "Implement GET /api/scan/[id] with server-side finding visibility gating"
git push
```

**Phase D exit gate:**
- `pnpm test` passes (all unit tests)
- `INTEGRATION_DB=1 pnpm test` passes including scan route happy path + curated + cooldown
- `pnpm build` passes
- Vercel preview returns 202 for a valid scan POST and 409 for the Aave demo address

---

## Phase E — Brand system (3 commits)

**Goal:** Every primitive the landing page and scan-results shell need exists and is themed with Storm Cyan. `public/logo.svg`, `public/og-image.png`, favicon set, UI primitives with Tailwind token classes.

**Risk:** Tailwind token wiring is easy to get subtly wrong — CSS vars defined but not referenced, or Tailwind theme extended but classes missing. A passing `pnpm build` does not prove the tokens resolve at runtime.
**Rollback:** If Tailwind refuses to pick up the token extensions, drop to inline CSS custom properties in `globals.css` and plain Tailwind utility classes on components — slower to iterate but robust. Revisit the token config at the start of Phase F.

### Task E.1 — Design tokens + logo + favicons

**Files:**
- Create: `src/styles/tokens.css`, `public/logo.svg`, `public/favicon.ico`, `public/favicon-192.png`, `public/favicon-512.png`
- Modify: `src/app/globals.css`, `tailwind.config.ts`, `src/app/layout.tsx`

Spec references: §8 (brand system), specifically §8.1 palette and §8.2 logo.

- [ ] **Step 1: Reference-read `~/svh-hub/tailwind.config.ts` for token-extension shape**

Open and scan: `~/svh-hub/tailwind.config.ts`. Note how SVH Hub extends theme colors via CSS vars. Close the file. Do not copy.

- [ ] **Step 2: Write `src/styles/tokens.css`**

Per §8.1 Storm Cyan palette:

```css
:root {
  --bw-bg-0: #0C1C3A;
  --bw-bg-1: #17306B;
  --bw-surface: rgba(23, 48, 107, 0.5);
  --bw-border: #1F3A7A;
  --bw-text-primary: #E6EEF9;
  --bw-text-secondary: #8FA3C5;
  --bw-accent: #2FB4C7;
  --bw-accent-hover: #45D4E8;
  --bw-grade-a: #3EE089;
  --bw-grade-b: #92D4A8;
  --bw-grade-c: #E8C164;
  --bw-grade-d: #E89B5E;
  --bw-grade-f: #E86060;
  --bw-font-sans: "Inter", system-ui, sans-serif;
  --bw-font-mono: "Geist Mono", ui-monospace, monospace;
  --bw-gradient-hero: linear-gradient(180deg, #0C1C3A 0%, #17306B 100%);
}

html, body {
  background: var(--bw-bg-0);
  color: var(--bw-text-primary);
  font-family: var(--bw-font-sans);
}
```

- [ ] **Step 3: Import tokens in `src/app/globals.css`**

```css
@import "../styles/tokens.css";

@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Extend Tailwind theme to expose tokens as utility classes**

`tailwind.config.ts`:
```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bw: {
          bg0: "var(--bw-bg-0)",
          bg1: "var(--bw-bg-1)",
          surface: "var(--bw-surface)",
          border: "var(--bw-border)",
          primary: "var(--bw-text-primary)",
          secondary: "var(--bw-text-secondary)",
          accent: "var(--bw-accent)",
          "accent-hover": "var(--bw-accent-hover)",
          "grade-a": "var(--bw-grade-a)",
          "grade-b": "var(--bw-grade-b)",
          "grade-c": "var(--bw-grade-c)",
          "grade-d": "var(--bw-grade-d)",
          "grade-f": "var(--bw-grade-f)",
        },
      },
      backgroundImage: {
        "bw-hero": "var(--bw-gradient-hero)",
      },
      fontFamily: {
        sans: ["var(--bw-font-sans)"],
        mono: ["var(--bw-font-mono)"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 5: Write `public/logo.svg` — Break Line logo**

Per §8.2 option C (Break Line) — wave + chart spike dual-read, monochrome:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40" fill="none">
  <g fill="currentColor">
    <text x="0" y="28" font-family="Inter, sans-serif" font-weight="600" font-size="24">break</text>
    <path d="M82 20 L92 20 L96 14 L100 26 L104 20 L114 20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    <text x="118" y="28" font-family="Inter, sans-serif" font-weight="600" font-size="24">water</text>
  </g>
</svg>
```

Rendered at `color: var(--bw-text-primary)` against `var(--bw-bg-0)`.

- [ ] **Step 6: Generate favicons**

Use a generator (e.g., realfavicongenerator.net) or a quick command with sharp/ImageMagick. For the scaffold, a placeholder is fine — a 512×512 version of the Break Line glyph rendered against `#0C1C3A`.

Drop files in `public/`: `favicon.ico`, `favicon-192.png`, `favicon-512.png`.

- [ ] **Step 7: Reference favicons + Inter + Geist Mono in `src/app/layout.tsx`**

```tsx
import "./globals.css";
import { Inter } from "next/font/google";
import type { Metadata } from "next";

const inter = Inter({ subsets: ["latin"], variable: "--bw-font-sans" });

export const metadata: Metadata = {
  title: "Breakwater",
  description: "Continuous security monitoring for DeFi protocols.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/favicon-192.png", sizes: "192x192" },
      { url: "/favicon-512.png", sizes: "512x512" },
    ],
  },
  openGraph: {
    title: "Breakwater",
    description: "Continuous security monitoring for DeFi protocols.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-bw-bg0 text-bw-primary">{children}</body>
    </html>
  );
}
```

Geist Mono via `next/font` or self-hosted — add on the landing page where actually used.

- [ ] **Step 8: Commit**

```bash
pnpm build
git add -A
git commit -m "Add Storm Cyan design tokens, Break Line logo, and favicon set"
```

### Task E.2 — UI primitives

**Files:**
- Create: `src/components/ui/{Button,GlassCard,Input,Label,Badge,GradePill}.tsx`, `src/components/Logo.tsx`

Reference-read `~/svh-hub/src/components/ui/Button.tsx` for the shape; write fresh.

- [ ] **Step 1: Write each primitive**

`Button.tsx`:
```tsx
import { clsx } from "clsx";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "ghost";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "primary", size = "md", className, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      className={clsx(
        "inline-flex items-center justify-center rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary" && "bg-bw-accent text-bw-bg0 hover:bg-bw-accent-hover",
        variant === "ghost" && "bg-transparent text-bw-primary border border-bw-border hover:bg-bw-surface",
        size === "sm" && "px-3 py-1.5 text-sm",
        size === "md" && "px-4 py-2 text-base",
        size === "lg" && "px-6 py-3 text-lg",
        className,
      )}
      {...rest}
    />
  );
});
```

`GlassCard.tsx`:
```tsx
import { clsx } from "clsx";
import { HTMLAttributes, forwardRef } from "react";

export const GlassCard = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function GlassCard(
  { className, ...rest }, ref,
) {
  return (
    <div
      ref={ref}
      className={clsx(
        "bg-bw-surface backdrop-blur-sm border border-bw-border rounded-xl p-6",
        className,
      )}
      {...rest}
    />
  );
});
```

`Input.tsx`:
```tsx
import { clsx } from "clsx";
import { InputHTMLAttributes, forwardRef } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest }, ref,
) {
  return (
    <input
      ref={ref}
      className={clsx(
        "w-full rounded-lg border border-bw-border bg-bw-bg0 px-3 py-2 text-bw-primary placeholder:text-bw-secondary",
        "focus:outline-none focus:ring-2 focus:ring-bw-accent",
        className,
      )}
      {...rest}
    />
  );
});
```

`Label.tsx`:
```tsx
import { clsx } from "clsx";
import { LabelHTMLAttributes, forwardRef } from "react";

export const Label = forwardRef<HTMLLabelElement, LabelHTMLAttributes<HTMLLabelElement>>(function Label(
  { className, ...rest }, ref,
) {
  return <label ref={ref} className={clsx("block text-sm font-medium text-bw-primary mb-1", className)} {...rest} />;
});
```

`Badge.tsx`:
```tsx
import { clsx } from "clsx";
import { HTMLAttributes } from "react";

type Tone = "neutral" | "info" | "warn" | "danger";

export function Badge({ tone = "neutral", className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
        tone === "neutral" && "bg-bw-surface text-bw-primary border-bw-border",
        tone === "info" && "bg-bw-surface text-bw-accent border-bw-accent",
        tone === "warn" && "bg-bw-surface text-bw-grade-c border-bw-grade-c",
        tone === "danger" && "bg-bw-surface text-bw-grade-f border-bw-grade-f",
        className,
      )}
      {...rest}
    />
  );
}
```

`GradePill.tsx`:
```tsx
import { clsx } from "clsx";
import type { Grade } from "@prisma/client";

export function GradePill({ grade, isPartial = false }: { grade: Grade; isPartial?: boolean }) {
  const gradeColor: Record<Grade, string> = {
    A: "text-bw-grade-a border-bw-grade-a",
    B: "text-bw-grade-b border-bw-grade-b",
    C: "text-bw-grade-c border-bw-grade-c",
    D: "text-bw-grade-d border-bw-grade-d",
    F: "text-bw-grade-f border-bw-grade-f",
  };
  return (
    <span className={clsx("inline-flex items-center justify-center w-10 h-10 rounded-full border-2 font-mono font-bold", gradeColor[grade])}>
      {grade}{isPartial ? "*" : ""}
    </span>
  );
}
```

`src/components/Logo.tsx`:
```tsx
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 40" fill="none" aria-label="Breakwater">
      <g fill="currentColor">
        <text x="0" y="28" fontFamily="Inter, sans-serif" fontWeight={600} fontSize={24}>break</text>
        <path d="M82 20 L92 20 L96 14 L100 26 L104 20 L114 20" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <text x="118" y="28" fontFamily="Inter, sans-serif" fontWeight={600} fontSize={24}>water</text>
      </g>
    </svg>
  );
}
```

Install `clsx`:
```bash
pnpm add clsx
```

- [ ] **Step 2: Build + smoke test**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add UI primitives (Button, GlassCard, Input, Label, Badge, GradePill, Logo)"
```

### Task E.3 — OG image

**Files:**
- Create: `public/og-image.png` (1200×630)

- [ ] **Step 1: Generate the OG image**

Option A — static Figma/Sketch export: 1200×630, Storm Cyan gradient background, Break Line logo centered, tagline "Continuous security monitoring for DeFi protocols." below. Export as PNG.

Option B — generate with Next.js `ImageResponse` at build time. Faster to iterate; requires a short route in `src/app/og-image/route.ts` that `next build` invokes. For Plan 01 static is fine.

- [ ] **Step 2: Verify meta renders**

Run `pnpm dev`, open http://localhost:3000, inspect `<head>` for `og:image` pointing to `/og-image.png`. Open a URL debugger (opengraph.xyz) against the Vercel preview to confirm rendering.

- [ ] **Step 3: Update `PORTS.md`**

```markdown
## Phase E ports

| SVH Hub source | Breakwater target | Rationale |
| --- | --- | --- |
| `tailwind.config.ts` (structural) | `tailwind.config.ts` | Same "theme.extend.colors via CSS var" pattern; Breakwater palette is fully independent (Storm Cyan, not SVH's palette). |
| `src/components/ui/Button.tsx` (structural) | `src/components/ui/Button.tsx` | Same forwardRef + clsx + variant pattern; Breakwater tokens, Breakwater sizes, no copy-paste. |
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add OG image and document Phase E ports"
git push
```

**Phase E exit gate:**
- `pnpm build` passes
- Vercel preview renders a Storm Cyan page (body visibly dark-navy with gradient where applied)
- OG debugger shows the social card correctly
- All primitives render without console errors
- `PORTS.md` updated

---

## Phase F — Landing page (2 commits)

**Goal:** The landing page at `/` implements all six sections of §7 with responsive design, Storm Cyan gradient, sticky scan button, and passes a Lighthouse audit meeting the spec's floors (Accessibility ≥ 90, Performance ≥ 75).

**Risk:** Lighthouse performance ≥ 75 with Framer Motion and a hero gradient is achievable but not automatic — bundling, font loading, and image sizing all matter.
**Rollback:** Swap Framer Motion count-up to plain CSS transitions if perf scores are borderline. Drop OG image from the hero if image optimization is the bottleneck.

### Task F.1 — Hero + Detectors + Why Now + Demo cards + Inline scan form

**Files:**
- Create: `src/components/landing/{Hero,InlineScanForm,DetectorsStrip,WhyNow,DemoCards,StickyScanButton}.tsx`, `src/app/demo/[slug]/page.tsx`
- Modify: `src/app/page.tsx`

Spec reference: §7 — read all six sections.

- [ ] **Step 1: Compose `src/app/page.tsx`**

```tsx
import { Hero } from "@/components/landing/Hero";
import { DetectorsStrip } from "@/components/landing/DetectorsStrip";
import { WhyNow } from "@/components/landing/WhyNow";
import { DemoCards } from "@/components/landing/DemoCards";
import { StickyScanButton } from "@/components/landing/StickyScanButton";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-bw-hero">
      <Hero />
      <DetectorsStrip />
      <WhyNow />
      <DemoCards />
      <StickyScanButton />
    </main>
  );
}
```

- [ ] **Step 2: Implement each landing section per §7**

Write each component with real copy from the spec (no lorem ipsum, per feedback memory). Use the UI primitives from Phase E. The Hero includes `<InlineScanForm />` which posts to `/api/scan`.

For brevity of the plan document: implement each component directly from §7 narrative, using the primitives. Each component should be ~30–80 lines. Keep them focused.

Key constraints:
- `<InlineScanForm>` validates input client-side with zod (mirror of the server schema), disables the submit button while in flight, shows the returned `scanId` via `router.push('/scan/'+id)` on 202, surfaces 429 as "You've scanned a lot today, try again in X min", surfaces 409 curated by redirecting to `demoUrl`.
- `<DemoCards>` fetches the three CURATED protocols via a server component at page render time and links each to `/demo/[slug]` — do **not** display fake grades or findings (per feedback memory `feedback_no_fabricated_data`).
- `<StickyScanButton>` becomes visible when the page has scrolled past the hero (IntersectionObserver on a sentinel below the hero).

- [ ] **Step 3: Implement `/demo/[slug]/page.tsx` — coming-soon placeholder**

Per spec §7 + the fabricated-data constraint. No fake grades. Layout:
- Protocol name and chain
- "Scan coming in Plan 03–06" or "We'll publish a real scan when our detectors are ready"
- Link back to the home page

- [ ] **Step 4: Build + dev test**

```bash
pnpm build
pnpm dev
```
Open http://localhost:3000 — verify all sections render, the inline form submits, the sticky button appears on scroll, and each demo card links to `/demo/[slug]`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Implement landing page sections and /demo/[slug] placeholder pages"
```

### Task F.2 — Responsive polish + Lighthouse audit

**Files:**
- Modify: any landing components for responsive tweaks; possibly `next.config.mjs` for image optimization config

- [ ] **Step 1: Verify mobile layout**

`pnpm dev`, open DevTools mobile emulation (iPhone 14 Pro, Pixel 7). Check:
- Hero copy doesn't overflow
- Inline form labels stay visible
- Demo cards stack vertically
- Sticky scan button is tappable, does not overlap content

- [ ] **Step 2: Run Lighthouse against the Vercel preview**

Push the branch first: `git push`. Wait for preview deploy. Run Lighthouse in Chrome DevTools against the preview URL, mobile profile.

Target: **Accessibility ≥ 90 (hard), Performance ≥ 75 (floor)**.

Common perf fixes:
- Use `next/image` for the OG image preview and any demo card visuals; set `priority` on above-the-fold images.
- Use `next/font` for Inter and Geist Mono (already done in Phase E).
- Check LCP target — hero text is LCP; ensure its font is preloaded.

Common a11y fixes:
- `aria-label` on the logo SVG (already set)
- Color contrast: `--bw-text-secondary` on `--bw-bg-0` must pass 4.5:1 — if not, lighten `--bw-text-secondary`.
- Focus-visible rings on all interactive elements (Button primitive already has this via `focus:ring-2`).

- [ ] **Step 3: Commit + push**

```bash
pnpm build
git add -A
git commit -m "Polish landing page responsive layout; meet Lighthouse a11y ≥ 90 and perf ≥ 75"
git push
```

**Phase F exit gate:**
- `pnpm build` passes
- `pnpm test` passes
- Vercel preview URL renders the landing page
- Lighthouse (mobile) on preview: Accessibility ≥ 90, Performance ≥ 75
- Inline scan form submission round-trips successfully

---

## Phase G — Scan results shell (2 commits)

**Goal:** `/scan/[id]` renders the skeleton UI for a queued scan: four module cards with status pills, a composite-grade placeholder, and a polling indicator. Polling against `GET /api/scan/[id]` refreshes state. Unauth vs email-authed gating per §5.3 visible in the module cards and findings list (which is empty in Plan 01 since no detectors run yet).

**Risk:** The shell must handle every `ScanStatus` value gracefully — QUEUED, RUNNING, PARTIAL_COMPLETE, COMPLETE, FAILED, EXPIRED — even though Plan 01 only produces QUEUED. If the UI only covers QUEUED, it will break the day Plan 02 lands.
**Rollback:** If the polling loop causes issues (double-fetches, memory leaks), fall back to SWR or TanStack Query before end of Phase G — both handle stale-while-revalidate and cleanup.

### Task G.1 — Scan page layout + polling

**Files:**
- Create: `src/app/scan/[id]/page.tsx`, `src/app/scan/[id]/ScanShell.tsx`, `src/components/scan/ModuleCard.tsx`, `src/components/scan/CompositePanel.tsx`, `src/components/scan/FindingsList.tsx`

- [ ] **Step 1: Server component entry at `src/app/scan/[id]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ScanShell } from "./ScanShell";

export default async function ScanPage({ params }: { params: { id: string } }) {
  const scan = await prisma.scan.findUnique({
    where: { id: params.id },
    include: { protocol: true },
  });
  if (!scan) notFound();
  return <ScanShell scanId={scan.id} initialProtocol={{ slug: scan.protocol.slug, displayName: scan.protocol.displayName, chain: scan.protocol.chain }} />;
}
```

- [ ] **Step 2: Client component `ScanShell.tsx` with polling**

```tsx
"use client";
import { useEffect, useState } from "react";
import { CompositePanel } from "@/components/scan/CompositePanel";
import { ModuleCard } from "@/components/scan/ModuleCard";
import { FindingsList } from "@/components/scan/FindingsList";

interface Props {
  scanId: string;
  initialProtocol: { slug: string; displayName: string; chain: string };
}

export function ScanShell({ scanId, initialProtocol }: Props) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchOnce() {
      const res = await fetch(`/api/scan/${scanId}`, { cache: "no-store" });
      if (!cancelled && res.ok) setData(await res.json());
    }
    fetchOnce();
    const intervalMs = 3000;
    const h = setInterval(() => {
      if (data && ["COMPLETE", "FAILED", "EXPIRED"].includes(data.status)) return;
      fetchOnce();
    }, intervalMs);
    return () => { cancelled = true; clearInterval(h); };
  }, [scanId]);

  const protocol = data?.protocol ?? initialProtocol;

  return (
    <main className="min-h-screen bg-bw-hero p-8">
      <header className="max-w-4xl mx-auto mb-8">
        <h1 className="text-3xl font-semibold text-bw-primary">{protocol.displayName}</h1>
        <p className="text-bw-secondary font-mono">{protocol.chain.toLowerCase()}</p>
      </header>
      <section className="max-w-4xl mx-auto space-y-6">
        <CompositePanel scan={data} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(data?.modules ?? [{ module: "GOVERNANCE" }, { module: "ORACLE" }, { module: "SIGNER" }, { module: "FRONTEND" }]).map((m: any) => (
            <ModuleCard key={m.module} module={m} />
          ))}
        </div>
        <FindingsList findings={data?.findings ?? []} />
      </section>
    </main>
  );
}
```

- [ ] **Step 3: Implement `CompositePanel.tsx`, `ModuleCard.tsx`, `FindingsList.tsx`**

Each component handles every status. Module card:
- QUEUED: spinner + "Queued"
- RUNNING: spinner + "Running…"
- COMPLETE: GradePill with the module's grade + findings count
- FAILED: danger badge + error message (scrubbed per gating)
- SKIPPED: neutral badge "Skipped — missing input" with explanation from `inputSnapshot.modulesEnabled` or missing-domain
- PARTIAL_COMPLETE: same as COMPLETE but with asterisk tooltip

`CompositePanel` shows:
- Status text (pending / in progress / complete / expired)
- Grade pill if `compositeGrade` is non-null
- Expiration countdown if within 7 days of `expiresAt`

`FindingsList` renders whatever the API returned (empty in Plan 01) with an "authenticated-only" explainer card when `viewer === 'unauth'` and the module has hidden findings.

- [ ] **Step 4: Commit**

```bash
pnpm build
git add -A
git commit -m "Add /scan/[id] shell with polling and per-status module rendering"
```

### Task G.2 — Gating UI + not-found handling

**Files:**
- Modify: `src/app/scan/[id]/ScanShell.tsx` for unauth vs email-authed branch
- Create: `src/app/scan/[id]/not-found.tsx`

- [ ] **Step 1: Visibility-gated findings**

Already server-side in `GET /api/scan/[id]` (§5.3). The shell just renders what it gets. Add:
- For unauth viewers, a CTA card: "Enter your email to see all findings →" that opens a simple email capture form posting to the NextAuth `/api/auth/signin/email` route with the scan's email.

- [ ] **Step 2: Not-found page**

```tsx
// src/app/scan/[id]/not-found.tsx
import Link from "next/link";
export default function ScanNotFound() {
  return (
    <main className="min-h-screen bg-bw-hero flex flex-col items-center justify-center p-8 text-center">
      <h1 className="text-3xl font-semibold text-bw-primary mb-2">Scan not found</h1>
      <p className="text-bw-secondary mb-6">This scan may have expired or never existed.</p>
      <Link href="/" className="text-bw-accent underline">Run a new scan</Link>
    </main>
  );
}
```

- [ ] **Step 3: Smoke test all status branches**

Not possible without inserting rows. Either manually `UPDATE "ModuleRun" SET status='COMPLETE', grade='B'` in Railway to smoke-test, or add a temporary dev-only script `scripts/seed-dev-scan.ts` that inserts a COMPLETE scan. Delete the script before commit.

- [ ] **Step 4: Commit + push**

```bash
pnpm build
git add -A
git commit -m "Add scan-not-found page and unauth email-capture CTA"
git push
```

**Phase G exit gate:**
- `pnpm build` passes
- `/scan/[id]` with a valid id renders the skeleton
- `/scan/[id]` with an invalid id renders not-found
- Polling stops cleanly on status COMPLETE/FAILED/EXPIRED
- Vercel preview works

---

## Phase H — Polish + deploy (2 commits)

**Goal:** PRIVACY.md and README.md finalized, robots.txt in place, environment variables verified on Vercel for preview, PR opened against `main` for Codex post-implementation review.

**Risk:** Low — this is cleanup. The only meaningful risk is forgetting an env var on Vercel, which would break the preview deploy for the PR.
**Rollback:** If an env var is missing, set it via Vercel CLI or dashboard and redeploy; no code rollback needed.

### Task H.1 — Docs + robots.txt + env audit

**Files:**
- Modify: `README.md`, `PRIVACY.md` (already exists on main)
- Create: `public/robots.txt`

- [ ] **Step 1: Expand `README.md`**

Add sections:
- Local setup: clone, pnpm install, copy `.env.example` to `.env`, fill in secrets, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`
- Stack overview (already stubbed on main)
- Testing: `pnpm test`, `INTEGRATION_DB=1 pnpm test` for integration
- Deployment: Vercel project, Railway Postgres, env-var list pointing at `.env.example`

- [ ] **Step 2: Skim `PRIVACY.md`**

It was committed to `main` during the spec phase. Confirm no contradictions with the schema (e.g., `submittedEmail` nulling after 90d — the cron is Plan 02, so reword "We null plaintext after 90 days" to "We null plaintext after 90 days starting Plan 02" or similar).

- [ ] **Step 3: Add `public/robots.txt`**

```
User-agent: *
Disallow: /api/
Disallow: /scan/
Allow: /

Sitemap: https://breakwater.xyz/sitemap.xml
```

`/sitemap.xml` is out of scope for Plan 01 — it's a Plan 07 polish item. The reference is aspirational.

- [ ] **Step 4: Env audit on Vercel**

```bash
pnpm dlx vercel env ls preview
```
Expected variables present: `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `SCAN_IP_SALT`, `SCAN_EMAIL_SALT`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `NEXT_PUBLIC_SITE_URL`.

Any missing → add via `vercel env add <name> preview`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Expand README, add robots.txt, verify env vars"
git push
```

### Task H.2 — Open PR for Codex review

**Files:** none.

- [ ] **Step 1: Ensure main is fetched and rebase if needed**

```bash
git fetch origin main
git rebase origin/main
```
If the spec on `main` moved since the worktree was created (it shouldn't have — the user explicitly closed the review cycle at `04423df`), resolve conflicts by keeping `main` as authoritative for spec files and the worktree as authoritative for implementation files.

- [ ] **Step 2: Final `pnpm build` + `pnpm test` + preview smoke**

```bash
pnpm build
pnpm test
```
Open the Vercel preview URL — land on `/`, submit a scan against an UNCLAIMED address, observe `/scan/[id]` loads.

- [ ] **Step 3: Open PR**

```bash
gh pr create --base main --head plan-01-scaffold --title "Plan 01 — Project scaffold and design system" --body "$(cat <<'EOF'
## Summary

Implements Plan 01 per spec (commit 04423df on main).

- Phase A: Next.js 14 + Tailwind + pnpm + Node 22 + Prisma + Vercel preview
- Phase B: full Prisma schema per §4, seed for system org + 3 CURATED protocols
- Phase C: NextAuth + Resend magic link + post-auth scan linking
- Phase D: POST /api/scan with atomic cooldown (pg_advisory_xact_lock) + dedupe + curated protection; GET /api/scan/[id] with visibility gating
- Phase E: Storm Cyan tokens + Break Line logo + UI primitives + OG image
- Phase F: landing page with all 6 sections + Lighthouse a11y ≥ 90, perf ≥ 75
- Phase G: /scan/[id] polling shell + per-status rendering + gating UI
- Phase H: docs, robots.txt, env audit

SVH Hub patterns that were referenced (not copy-pasted) are listed in PORTS.md.

No scan dispatch in this plan — all new scans write QUEUED ModuleRuns and stop. Plan 02 wires Inngest to consume them.

## Test plan

- [ ] pnpm build succeeds
- [ ] pnpm test passes (unit)
- [ ] INTEGRATION_DB=1 pnpm test passes (integration incl. curated + cooldown)
- [ ] Vercel preview URL renders landing + loads /scan/[id] for a fresh scan
- [ ] Lighthouse mobile on preview: a11y ≥ 90, perf ≥ 75
- [ ] Magic-link sign-in round-trips end-to-end

## Codex review focus

Second Codex round — on implementation, not spec. Key scrutiny points:
- pg_advisory_xact_lock placement in src/lib/cooldown.ts (must be inside the same transaction as the ACCEPTED insert)
- Step ordering in src/app/api/scan/route.ts matches §5.1 steps 1–12 exactly
- No SVH Hub code was copy-pasted (validate against PORTS.md)
- Finding visibility gating in src/lib/findingVisibility.ts is server-side only

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Paste the PR URL back to the user**

**Phase H exit gate:**
- `pnpm build` + `pnpm test` pass
- Vercel preview URL for `plan-01-scaffold` is green
- PR open at `plan-01-scaffold` → `main`
- PORTS.md covers all three port phases (A, C, E)

---

## Exit criteria (spec §14)

- [x] `pnpm build` succeeds on `main` after merging the Plan 01 PR.
- [x] `pnpm test` green.
- [x] `INTEGRATION_DB=1 pnpm test` green against Railway dev DB.
- [x] Vercel preview URL renders the landing page on the latest `plan-01-scaffold` commit.
- [x] Lighthouse mobile on preview: Accessibility ≥ 90, Performance ≥ 75.
- [x] `POST /api/scan` round-trips for an UNCLAIMED address; `/scan/[id]` shows the QUEUED shell.
- [x] Magic-link auth works end-to-end against a real email.
- [x] PRIVACY.md present with `Last updated: 2026-04-20`.
- [x] PORTS.md documents every SVH pattern port.
- [x] PR opened against `main`, ready for Codex post-implementation review.

## Deferred to later plans

- **§17.4 dedupe-after-IP-quota ordering** → Plan 02, once real rate-limit traffic patterns are observable.
- **Inngest dispatcher** → Plan 02.
- **Real detectors** → Plans 03 (Governance), 04 (Oracle), 05 (Signer), 06 (Frontend).
- **Freemium gating, shareable badges, email signup polish** → Plan 07.
- **Expired-scan cron** → Plan 02.
- **Slug conflict resolution beyond `${chain}-${shortAddress}-${timestamp}`** → Plan 02+.
- **Redis-backed rate limiting** (if Codex requests it at round 2+ review) → Plan 02 refactor.

---

## Self-review checklist (complete before starting execution)

- [x] Every spec section has at least one task: §3 (A), §4 (B), §5 (D), §6 (C), §7 (F), §8 (E), §9 (A+H), §10 (distributed), §11 (H), §12 (A+H), §14 (H).
- [x] No placeholders or "TODO" steps.
- [x] Types and function signatures match across tasks (e.g., `PayloadInput` in D.1, `computePayloadHash` call in D.2).
- [x] Each phase ends in a green state.
- [x] Every phase has a risk callout + rollback.
- [x] SVH Hub references are read-only per PORTS.md policy.

---

## Revision log

Execution-time changes to this plan. The spec on `main` (`docs/superpowers/specs/2026-04-20-breakwater-plan-01-scaffold-design.md`) is frozen and out of scope for this log — if the spec needs to change, open a separate commit against `main` and run it through Codex review first.

- **2026-04-20 — Phase C re-scoped from 2 commits into 5 sub-tasks (C.1–C.5).** Original C.1 bundled NextAuth wiring, Resend integration, both email templates, and the scan-linking stub into a single commit, with C.2 layering the integration test and E2E on top. That's too coarse for a clean Codex round — a regression in any of those layers is hard to isolate. Split so the auth foundation (C.1) ships with a console-log `sendVerificationRequest` and can be validated before Resend (C.2), templates (C.3), post-auth callback (C.4), and automated tests + Lighthouse (C.5) land on top. Status tracker (`docs/superpowers/plans/2026-04-20-breakwater-plan-01-status.md`) updated in commit `7a7b1ba`; this plan file updated in the accompanying commit.
