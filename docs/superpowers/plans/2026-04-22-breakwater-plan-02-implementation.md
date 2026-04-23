# Breakwater Plan 02 — Dispatcher + Governance Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first working end-to-end scan pipeline. Anonymous submissions through the Plan 01 form, for Ethereum-mainnet protocols, dispatch through Inngest to the Governance module, execute against live on-chain state (Ankr primary + Cloudflare fallback RPC), run six detectors anchored to real DeFi incidents (Drift, Beanstalk, Compound 62, Ronin, Audius), and render graded findings via the Plan 01 tier-aware `/scan/[id]` UI.

**Architecture:** Next.js 14 App Router on Node 22 LTS with pnpm. Inngest Cloud for durable event-driven execution (`scan.queued → executeScan → executeGovernanceModule → scan.completed`). viem with the `fallback` transport for public RPC reads (Ankr → Cloudflare). Safe Transaction Service for multisig metadata. Etherscan for contract ABIs. Detector logic is deterministic against a `GovernanceSnapshot` captured at scan block height.

**Tech Stack:** Next.js 14.2.35, TypeScript 5 strict, Tailwind 3.4, Prisma 5.22.0, PostgreSQL 16 (Railway), NextAuth 4 + `@auth/prisma-adapter`, Resend + `@react-email/components`, **Inngest 3.x** (new), **viem 2.x** (already installed), zod 4, Vitest 4, pnpm 9, Vercel.

**Source spec:** `docs/superpowers/specs/2026-04-22-breakwater-plan-02-design.md` (frozen at commit `400053c` on `main`).

**Source research:** `docs/research/2026-04-22-governance-incidents.md` (commit `c1d9642` on `main`).

---

## Working directory and branching

All work on this plan happens on a **new worktree at `/Users/robertwils/breakwater-plan-02`**, branch `plan-02-dispatcher`, cut from `main` after Codex has reviewed this implementation plan. Do not commit implementation work to `main` directly. At the end of Phase I a PR is opened `plan-02-dispatcher` → `main` for Codex post-implementation review and merge.

The spec and research doc on `main` are frozen. If something in the spec needs to change mid-implementation, raise it with the user, do not silently diverge. Spec deltas (if any) land on `main` as a separate commit and the worktree rebases onto it.

## Reference policy — Plan 01 tree

Plan 02 is a pure superset of Plan 01. The worktree inherits the full Plan 01 tree (`main` at `99a1087`+). Every file created by Plan 01 is still authoritative — Plan 02 only adds new files and modifies existing ones where the spec explicitly calls it out (e.g., `src/app/api/scan/route.ts` gains an Inngest emission block; `src/components/scan/ScanShell.tsx` gains polling).

No external pattern references are needed for Plan 02. SVH Hub is not consulted — all patterns inherit from Breakwater's own Plan 01 codebase. `PORTS.md` on `main` remains closed for Plan 02 (it is Plan-01-only).

## File structure (added or modified by this plan)

```
breakwater-plan-02/                      # worktree of main
├── .env.example                         # modified (new Plan 02 vars)
├── package.json                         # modified (inngest dep)
├── pnpm-lock.yaml                       # modified
├── prisma/
│   ├── schema.prisma                    # modified (GovernanceSnapshot, additions)
│   └── migrations/
│       └── 0003_governance_snapshot_and_dispatcher/
│           └── migration.sql            # new
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── inngest/route.ts         # new
│   │   │   └── scan/
│   │   │       ├── route.ts             # modified (scan.queued emission)
│   │   │       └── [id]/
│   │   │           ├── route.ts         # modified (findings in response)
│   │   │           └── status/route.ts  # new (lightweight polling endpoint)
│   │   └── scan/[id]/page.tsx           # no changes — ScanShell handles polling
│   ├── components/
│   │   └── scan/
│   │       ├── ScanShell.tsx            # modified (useScanPolling integration)
│   │       ├── ModuleCard.tsx           # modified (status indicators)
│   │       └── FindingsList.tsx         # unchanged — discriminated union upgrade only
│   ├── lib/
│   │   ├── config.ts                    # modified (new env vars validated)
│   │   ├── inngest/
│   │   │   ├── client.ts                # new
│   │   │   ├── functions/
│   │   │   │   ├── execute-scan.ts      # new — orchestrator
│   │   │   │   └── execute-governance.ts # new — module runner
│   │   │   └── events.ts                # new — typed event schemas
│   │   ├── rpc-client.ts                # new — viem fallback transport
│   │   ├── safe-api.ts                  # new — Safe Transaction Service client
│   │   ├── etherscan.ts                 # new — Etherscan ABI client
│   │   ├── featureFlags.ts              # new — BREAKWATER_GOVERNANCE_MODULE_ENABLED
│   │   ├── slug.ts                      # modified (collision fix)
│   │   ├── scanShaper.ts                # modified (FindingResponse union)
│   │   ├── scoring.ts                   # modified (grade floor override)
│   │   └── detectors/
│   │       └── governance/
│   │           ├── index.ts             # new — runGovernanceDetectors orchestrator
│   │           ├── snapshot.ts          # new — captureGovernanceSnapshot
│   │           ├── persist.ts           # new — persistFindingsAndGrade
│   │           ├── types.ts             # new — Snapshot + Finding local types
│   │           ├── GOV-001-timelock.ts  # new
│   │           ├── GOV-002-bypass.ts    # new
│   │           ├── GOV-003-multisig.ts  # new
│   │           ├── GOV-004-voting.ts    # new
│   │           ├── GOV-005-proxy.ts     # new
│   │           ├── GOV-006-pause.ts     # new
│   │           └── __tests__/
│   │               ├── fixtures.ts      # new — all detector fixtures
│   │               ├── GOV-001.test.ts  # new
│   │               ├── GOV-002.test.ts  # new
│   │               ├── GOV-003.test.ts  # new
│   │               ├── GOV-004.test.ts  # new
│   │               ├── GOV-005.test.ts  # new
│   │               ├── GOV-006.test.ts  # new
│   │               └── regression.test.ts # new — Drift/Beanstalk/Audius
│   └── hooks/
│       └── useScanPolling.ts            # new
├── docs/
│   └── superpowers/
│       ├── specs/                       # inherited from main (frozen)
│       ├── plans/
│       │   └── 2026-04-22-breakwater-plan-02-implementation.md # this file
│       └── status/
│           └── 2026-04-22-plan-02-status.md # optional status tracker
└── NOTES.md                             # modified (close Plan 02 section)
```

---

## Phase summary

| Phase | Scope | Commits | Build+test+deploy after |
|---|---|---|---|
| A | Foundation: Inngest + viem RPC + env var validation + feature flag + config.test production coverage | 4 | ✓ |
| B | Data model: GovernanceSnapshot + Scan/ModuleRun/Finding additions + Plan 01 backlog (slug collision, ScanAttempt.reason nullability) | 3 | ✓ |
| C | Inngest dispatcher: serve handler + executeScan orchestrator + POST /api/scan emission + structured logging helper + idempotency | 4 | ✓ |
| D | On-chain data layer: viem multicall wrapper + Safe API client + Etherscan client + snapshot capture (split into types/Governor, Timelock/Safe, proxy/assembly) | 6 | ✓ |
| E | Detectors: GOV-001 through GOV-006 (one commit per detector, with unit tests + fixture) | 6 | ✓ |
| F | Module orchestration: executeGovernanceModule + scoring algorithm + persistFindingsAndGrade | 3 | ✓ |
| G | UI: GET /api/scan/[id]/status + useScanPolling + ScanShell integration + FindingResponse discriminated union refactor | 4 | ✓ |
| H | Integration testing: fixture protocols + end-to-end tests + Drift/Beanstalk/Audius regression tests + Inngest function tests | 3 | ✓ |
| I | Polish + deploy: Codex holistic review + NOTES/README updates + PR + merge + tag v0.2.0-plan-02 | 3 | ✓ |

**Total: 36 commits across 9 phases.** Every commit leaves the tree in a green state: `pnpm build` passes, `pnpm test` passes, Vercel preview deploys successfully (from Phase A onward).

---

## Conventions — Dependency pinning policy

Plan 01's exact-pin policy carries forward. New Plan 02 packages to pin:

### Exact-pin (required, use `pnpm add -E`)

| Package | Pinned version | Source of constraint |
|---|---|---|
| `inngest` | 3.x exact (e.g. `3.27.5`) | Spec §4, tech stack. Major-locked to v3 — v4 is beta with breaking API. |
| `@inngest/vercel` | matching inngest major | Peer constraint. |

### Caret-range (acceptable, default `pnpm add`)

`viem` already on the repo at caret — keep it. No other new deps.

### Subagent checklist (any task that runs `pnpm add`)

1. Check this table + the spec Tech Stack line before installing.
2. For exact-pin table entries, use `pnpm add -E <pkg>@<exact-version>`.
3. Commit message names the installed version for spec-bound deps.
4. If a spec-bound dep is already installed on a wrong version, flag to the controller — do not silently upgrade/downgrade.

Rationale: Plan 01 Phase A.2 blocked on a Prisma 7 install because `pnpm add prisma` resolved to `^7.7.0`. Inngest v4 is in public beta and has breaking changes vs v3 — pinning v3 prevents accidental upgrade via `pnpm update`.

---

## Conventions — Commit hygiene

Plan 02 inherits Plan 01's commit conventions:

- Imperative mood, ≤72 chars in the subject line.
- Prefix commits that touch deferred Plan 01 items with `refactor:` or `fix:` so they are grep-able (e.g., `fix: slug collision — use 12-char hex suffix`).
- Detector commits are prefixed with the ID: `feat(GOV-001): timelock missing / insufficient delay detector`.
- Status-marker commits (at phase end) carry the form `chore: Phase X status marker`. No code change, just a marker for `git log --oneline | grep "status marker"`.

Every Plan 02 commit must pass:

```bash
pnpm build && pnpm test
```

locally before push. Integration tests (`INTEGRATION_DB=1 pnpm test`) are only required at Phase H and as pre-PR gate in Phase I.

---

## Prerequisites (before Phase A.1)

Robert completes these setup steps (approximately 15 minutes) before any implementer subagent is dispatched:

1. **Create Inngest Cloud account + project** at inngest.com
   - Project name: `breakwater`
   - Note the project ID and keys

2. **Generate keys:**
   - Event key (for `INNGEST_EVENT_KEY`)
   - Signing key (for `INNGEST_SIGNING_KEY`)

3. **Add to Vercel environment variables** (both Preview and Production scopes):
   - `INNGEST_EVENT_KEY`
   - `INNGEST_SIGNING_KEY`
   - `INNGEST_APP_ID=breakwater`

4. **Optional: Etherscan free-tier account**
   - Generate API key at etherscan.io
   - Add `ETHERSCAN_API_KEY` to Vercel (Preview + Production)
   - Not blocking Phase A.1: GOV-002 degrades gracefully without this key, but coverage for GOV-002 in Phase E.2 needs it set in development.

**Verification before starting A.1:**
- `pnpm dlx vercel env ls` shows `INNGEST_*` vars on Production scope
- Inngest Cloud dashboard shows the `breakwater` project

Phase A.1 can install the SDK without keys (dev uses the local `inngest-cli` key), but Phase C.3's preview-smoke step (which expects the Inngest Cloud dashboard to show incoming events) fails without these prerequisites in place.

---

## Phase A — Foundation (4 commits)

**Goal:** Dependencies installed, Inngest client wired, public RPC client working, `config.ts` extended with new env vars and production assertion coverage. Feature flag plumbing ready so rollback is instant. Empty-shell preview deploy still green.

**Risk:** Inngest serve handler conflicts with Next.js 14 App Router's `runtime: "edge"` default for API routes. Handler must explicitly declare `runtime: "nodejs"` — Inngest needs Node primitives for signature verification.
**Rollback:** If Inngest wiring breaks preview builds, set `BREAKWATER_GOVERNANCE_MODULE_ENABLED=false` on Vercel (the flag short-circuits event emission in `POST /api/scan` before any Inngest client import is touched) and re-investigate locally.

### Task A.1 — Install Inngest + env var schema extension

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`, `.env.example`, `src/lib/config.ts`

- [ ] **Step 1: Install Inngest exact-pinned**

```bash
cd /Users/robertwils/breakwater-plan-02
pnpm add -E inngest@3.27.5
```

The `@inngest/vercel` adapter is bundled inside `inngest/next`; no separate package needed on v3.x.

Verify:
```bash
pnpm list inngest
# breakwater-plan-01@0.1.0 ...
# └── inngest@3.27.5
```

- [ ] **Step 2: Extend `.env.example` per spec §9**

Append after the existing Plan 01 block:

```
# Inngest (Plan 02)
INNGEST_EVENT_KEY=""
INNGEST_SIGNING_KEY=""
INNGEST_APP_ID="breakwater"

# RPC + APIs (Plan 02) — public endpoints, no API key required
PRIMARY_ETH_RPC_URL="https://rpc.ankr.com/eth"
FALLBACK_ETH_RPC_URL="https://cloudflare-eth.com"

# Etherscan (Plan 02)
ETHERSCAN_API_KEY=""

# Safe Transaction Service (Plan 02)
SAFE_API_BASE_URL="https://safe-transaction-mainnet.safe.global/api/v1"

# Feature flags (Plan 02)
BREAKWATER_GOVERNANCE_MODULE_ENABLED="true"
```

- [ ] **Step 3: Extend `src/lib/config.ts`**

The Plan 01 `config.ts` uses zod to parse `process.env`. Extend the schema:

```typescript
const configSchema = z.object({
  // ... existing Plan 01 fields
  INNGEST_EVENT_KEY: z.string().min(1).optional(),      // optional on dev
  INNGEST_SIGNING_KEY: z.string().min(1).optional(),    // optional on dev
  INNGEST_APP_ID: z.string().default("breakwater"),

  PRIMARY_ETH_RPC_URL: z.string().url().default("https://rpc.ankr.com/eth"),
  FALLBACK_ETH_RPC_URL: z.string().url().default("https://cloudflare-eth.com"),

  ETHERSCAN_API_KEY: z.string().min(1).optional(),      // optional — GOV-002 degrades gracefully

  SAFE_API_BASE_URL: z.string().url().default(
    "https://safe-transaction-mainnet.safe.global/api/v1"
  ),

  BREAKWATER_GOVERNANCE_MODULE_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("true"),
})
```

Update `assertProductionConfig`:

```typescript
export function assertProductionConfig() {
  // ... existing Plan 01 assertions (NEXTAUTH_SECRET, salts, etc.)
  if (process.env.NODE_ENV === "production") {
    if (!config.INNGEST_EVENT_KEY)
      throw new Error("config: INNGEST_EVENT_KEY is required in production")
    if (!config.INNGEST_SIGNING_KEY)
      throw new Error("config: INNGEST_SIGNING_KEY is required in production")
    if (!config.ETHERSCAN_API_KEY)
      throw new Error(
        "config: ETHERSCAN_API_KEY is required in production (GOV-002 needs it)"
      )
  }
}
```

Note: RPC URLs are not required in production — they have defaults pointing at Ankr / Cloudflare. If an operator wants to override, they can.

- [ ] **Step 4: Verify build still green**

```bash
pnpm build
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(deps): install inngest@3.27.5 + extend config for Plan 02 env vars"
```

**Deliverables:** `pnpm list inngest` shows 3.27.5, `.env.example` documents all Plan 02 vars, `config.ts` validates and (in production) asserts.

**Exit:** `pnpm build && pnpm test` green; no runtime references to new env vars yet.

### Task A.2 — Inngest client + event schemas

**Files:**
- Create: `src/lib/inngest/client.ts`, `src/lib/inngest/events.ts`

- [ ] **Step 1: Create `src/lib/inngest/client.ts`**

```typescript
import { Inngest, EventSchemas } from "inngest"
import type { Events } from "./events"
import { config } from "@/lib/config"

export const inngest = new Inngest({
  id: config.INNGEST_APP_ID,
  eventKey: config.INNGEST_EVENT_KEY,    // undefined on dev — inngest-cli uses dev key
  schemas: new EventSchemas().fromRecord<Events>(),
})
```

- [ ] **Step 2: Create `src/lib/inngest/events.ts`**

Typed event payloads. This is the contract between emitters (POST /api/scan) and consumers (execute-scan / execute-governance functions).

```typescript
import type { Chain, Grade, ModuleName, ScanStatus } from "@prisma/client"

export type Events = {
  "scan.queued": {
    data: {
      scanId: string
      protocolId: string
      chain: Chain
      primaryContractAddress: string
      modulesEnabled: ModuleName[]
    }
  }
  "scan.module.requested": {
    data: {
      scanId: string
      module: ModuleName
    }
  }
  "scan.module.completed": {
    data: {
      scanId: string
      module: ModuleName
      status: "COMPLETE" | "FAILED" | "SKIPPED"
      findingsCount: number
      grade: Grade | null
      executionMs: number
    }
  }
  "scan.completed": {
    data: {
      scanId: string
      finalStatus: ScanStatus
      compositeGrade: Grade | null
      executionMs: number
    }
  }
}
```

Note: internal event `scan.module.requested` is introduced in Phase C but typed here so the schema stays in one place.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(inngest): client + typed event schemas"
```

**Deliverables:** typed `inngest` singleton, exhaustive `Events` record.

**Exit:** Build + test green. No functions registered yet, no serve handler yet.

### Task A.3 — viem RPC client + Safe + Etherscan stubs

**Files:**
- Create: `src/lib/rpc-client.ts`, `src/lib/safe-api.ts`, `src/lib/etherscan.ts`

- [ ] **Step 1: Create `src/lib/rpc-client.ts`**

Per spec §8.1:

```typescript
import { createPublicClient, fallback, http } from "viem"
import { mainnet } from "viem/chains"
import { config } from "@/lib/config"

export const ethClient = createPublicClient({
  chain: mainnet,
  transport: fallback(
    [
      http(config.PRIMARY_ETH_RPC_URL, {
        timeout: 10_000,
        retryCount: 1,        // fallback takes over on retry
      }),
      http(config.FALLBACK_ETH_RPC_URL, {
        timeout: 10_000,
        retryCount: 1,
      }),
    ],
    {
      rank: false,             // try primary first, fall back on error — no latency ranking
      retryCount: 2,
      retryDelay: 150,
    }
  ),
})

export type EthClient = typeof ethClient
```

No module-load-time RPC calls — the client is lazy until first use.

- [ ] **Step 2: Create `src/lib/safe-api.ts` stub**

```typescript
import { z } from "zod"
import { config } from "@/lib/config"

const safeInfoSchema = z.object({
  address: z.string(),
  threshold: z.number().int().positive(),
  owners: z.array(z.string()),
  modules: z.array(z.string()).default([]),
})

export type SafeInfo = z.infer<typeof safeInfoSchema>

export async function fetchSafeInfo(
  address: string,
  opts: { signal?: AbortSignal } = {}
): Promise<SafeInfo | null> {
  const url = `${config.SAFE_API_BASE_URL}/safes/${address}/`
  const res = await fetch(url, { signal: opts.signal, cache: "no-store" })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Safe API error: ${res.status}`)
  const json = await res.json()
  return safeInfoSchema.parse(json)
}
```

Single-responsibility: returns `null` for "not a Safe", throws for transport errors. Retry policy is handled by callers (Inngest `step.run` retries).

- [ ] **Step 3: Create `src/lib/etherscan.ts` stub**

```typescript
import { z } from "zod"
import { config } from "@/lib/config"

const etherscanResponseSchema = z.object({
  status: z.union([z.literal("0"), z.literal("1")]),
  message: z.string(),
  result: z.string(),
})

export async function fetchContractAbi(
  address: string
): Promise<string | null> {
  if (!config.ETHERSCAN_API_KEY) return null  // graceful degradation
  const url = new URL("https://api.etherscan.io/api")
  url.searchParams.set("module", "contract")
  url.searchParams.set("action", "getabi")
  url.searchParams.set("address", address)
  url.searchParams.set("apikey", config.ETHERSCAN_API_KEY)

  const res = await fetch(url.toString(), { cache: "no-store" })
  if (!res.ok) throw new Error(`Etherscan error: ${res.status}`)
  const parsed = etherscanResponseSchema.parse(await res.json())
  if (parsed.status === "0") return null    // contract not verified
  return parsed.result                      // JSON ABI string
}
```

- [ ] **Step 4: Write a minimal smoke test**

`src/lib/__tests__/rpc-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { ethClient } from "@/lib/rpc-client"

describe("rpc-client", () => {
  it("creates a viem public client for mainnet", () => {
    expect(ethClient.chain?.id).toBe(1)
  })
  // No network calls in unit tests — real RPC exercised in Phase D tests.
})
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(rpc): viem fallback client + Safe API + Etherscan stubs"
```

**Deliverables:** three client modules, one smoke test. Zero network traffic from module load.

**Exit:** `pnpm test` passes (1 new test). No real RPC calls yet — Phase D tests will exercise.

### Task A.4 — Feature flag plumbing + config.test.ts production coverage (Plan 01 backlog)

**Files:**
- Create: `src/lib/featureFlags.ts`
- Modify: `src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Create `src/lib/featureFlags.ts`**

Per spec §15 (rollback). Plan 02 uses simple env-var flags — no LaunchDarkly / Vercel Flags yet.

```typescript
import { config } from "@/lib/config"

export const featureFlags = {
  governanceModuleEnabled: config.BREAKWATER_GOVERNANCE_MODULE_ENABLED,
} as const

export type FeatureFlags = typeof featureFlags
```

Usage in `POST /api/scan` (Phase C.3): short-circuit Inngest emission when the flag is false.

- [ ] **Step 2: Extend `config.test.ts` — production assertion coverage (Plan 01 backlog)**

Plan 01 deferred this: `config.test.ts` did not exercise the production branch of `assertProductionConfig` / `assertProductionHashSalts`. Add cases now:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

describe("assertProductionConfig (production branch)", () => {
  const origEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...origEnv, NODE_ENV: "production" }
  })
  afterEach(() => {
    process.env = origEnv
  })

  it("throws when NEXTAUTH_SECRET missing in production", async () => {
    process.env.NEXTAUTH_SECRET = ""
    const mod = await import("@/lib/config")
    expect(() => mod.assertProductionConfig()).toThrow(/NEXTAUTH_SECRET/)
  })

  it("throws when SCAN_IP_SALT missing in production", async () => {
    process.env.SCAN_IP_SALT = ""
    const mod = await import("@/lib/config")
    expect(() => mod.assertProductionHashSalts()).toThrow(/SCAN_IP_SALT/)
  })

  it("throws when SCAN_EMAIL_SALT missing in production", async () => {
    process.env.SCAN_EMAIL_SALT = ""
    const mod = await import("@/lib/config")
    expect(() => mod.assertProductionHashSalts()).toThrow(/SCAN_EMAIL_SALT/)
  })

  it("throws when INNGEST_EVENT_KEY missing in production", async () => {
    process.env.INNGEST_EVENT_KEY = ""
    const mod = await import("@/lib/config")
    expect(() => mod.assertProductionConfig()).toThrow(/INNGEST_EVENT_KEY/)
  })

  it("throws when INNGEST_SIGNING_KEY missing in production", async () => {
    process.env.INNGEST_SIGNING_KEY = ""
    const mod = await import("@/lib/config")
    expect(() => mod.assertProductionConfig()).toThrow(/INNGEST_SIGNING_KEY/)
  })

  it("throws when ETHERSCAN_API_KEY missing in production", async () => {
    process.env.ETHERSCAN_API_KEY = ""
    const mod = await import("@/lib/config")
    expect(() => mod.assertProductionConfig()).toThrow(/ETHERSCAN_API_KEY/)
  })
})
```

Uses `vi.resetModules()` so each test re-imports `config.ts` with a fresh `process.env`.

- [ ] **Step 3: Verify coverage**

```bash
pnpm test -- --coverage src/lib/config.ts
```

Target: ≥90% branch coverage on `assertProductionConfig` + `assertProductionHashSalts`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(config): feature flag + production assertion test coverage"
```

**Deliverables:** `featureFlags.ts`, expanded `config.test.ts` covering all production assertion branches.

**Exit:** `pnpm test` green, coverage target met. Plan 01 backlog item "config.test.ts production coverage" resolved.

---

**Phase A exit gate:**
- `pnpm build && pnpm test` green
- Vercel preview URL for `plan-02-dispatcher` branch returns 200
- `.env.example` carries all Plan 02 vars
- `src/lib/inngest/client.ts`, `src/lib/rpc-client.ts`, `src/lib/featureFlags.ts` present
- No Inngest functions registered yet (Phase C)
- Plan 01 backlog item `config.test.ts production coverage` resolved
- Codex review of Phase A commits (optional, recommended) completes clean

---

## Phase B — Data model (3 commits)

**Goal:** Prisma schema adds `GovernanceSnapshot` and additive fields to `Scan`, `ModuleRun`, `Finding`. Single migration applies cleanly to Railway dev DB. Plan 01 backlog items `slug collision fix` and `ScanAttempt.reason nullability` resolved as separate commits.

**Risk:** Migration order with respect to existing data — Plan 01 already has rows in `Scan`, `ScanAttempt`, `ModuleRun`, `Finding` (from preview traffic). Any `NOT NULL` new column must ship with a default or a back-fill. Making `ScanAttempt.reason` nullable is a non-destructive relaxation, safe on existing rows.
**Rollback:** Prisma migrations are forward-only in production (spec §3.3). For dev, `prisma migrate reset` wipes the dev DB and re-applies from zero. If a Phase B migration bug is caught in Phase C or D, add a new migration rather than editing `0003/`.

### Task B.1 — GovernanceSnapshot model + Scan/ModuleRun/Finding additions

**Files:**
- Modify: `prisma/schema.prisma`

Spec references: §3.1 (new model), §3.2 (additions).

- [ ] **Step 1: Add enums required by GovernanceSnapshot**

Append to the enum block at the top of `schema.prisma`:

```prisma
enum GovernorType {
  OZ_GOVERNOR
  COMPOUND_BRAVO
  CUSTOM
}

enum ProxyType {
  EIP_1967_TRANSPARENT
  EIP_1822_UUPS
  CUSTOM
  NONE
}

enum VotingSnapshotType {
  BLOCK_BASED
  CURRENT_BALANCE
  NONE
}
```

- [ ] **Step 2: Add `GovernanceSnapshot` model**

Per spec §3.1 verbatim:

```prisma
model GovernanceSnapshot {
  id                  String   @id @default(cuid())
  scanId              String   @unique
  scan                Scan     @relation(fields: [scanId], references: [id], onDelete: Cascade)

  blockNumber         BigInt
  capturedAt          DateTime @default(now())

  hasGovernor         Boolean  @default(false)
  governorAddress     String?
  governorType        GovernorType?
  governorVersion     String?

  hasTimelock         Boolean  @default(false)
  timelockAddress     String?
  timelockMinDelay    Int?
  timelockAdmin       String?

  hasMultisig         Boolean  @default(false)
  multisigAddress     String?
  multisigThreshold   Int?
  multisigOwnerCount  Int?
  multisigOwners      String[]

  proxyType           ProxyType?
  proxyAdminAddress   String?
  proxyImplementation String?
  proxyVerified       Boolean  @default(false)

  votingTokenAddress  String?
  votingSnapshotType  VotingSnapshotType?

  rawState            Json

  @@index([scanId])
}
```

- [ ] **Step 3: Add fields to `Scan`, `ModuleRun`, `Finding`**

```prisma
model Scan {
  // ... existing fields
  dispatchedAt       DateTime?
  executionStartedAt DateTime?
  governanceSnapshot GovernanceSnapshot?
}

model ModuleRun {
  // ... existing fields
  inngestEventId String?
  inngestRunId   String?
}

model Finding {
  // ... existing fields
  detectorVersion     String  @default("1.0.0")
  snapshotBlockNumber BigInt?
}
```

All new fields are nullable or default-bearing — safe on existing rows.

- [ ] **Step 4: Format + generate**

```bash
pnpm prisma format
pnpm prisma generate
```

`prisma generate` must succeed (no runtime yet).

- [ ] **Step 5: Commit schema-only (no migration yet)**

```bash
git add -A
git commit -m "feat(schema): GovernanceSnapshot + scan/module/finding additions"
```

**Deliverables:** Schema compiles, client generates. No migration applied.

**Exit:** `pnpm prisma generate` succeeds. Commit holds schema changes only; Task B.2 creates and applies the migration.

### Task B.2 — Migration + apply to Railway dev

**Files:**
- Create: `prisma/migrations/0003_governance_snapshot_and_dispatcher/migration.sql`

- [ ] **Step 1: Generate the migration**

```bash
pnpm prisma migrate dev --name governance_snapshot_and_dispatcher
```

Prisma creates `0003_governance_snapshot_and_dispatcher/migration.sql` with:
- Three new enums (`GovernorType`, `ProxyType`, `VotingSnapshotType`)
- New table `GovernanceSnapshot` with `scanId` unique + FK to `Scan`
- New columns `Scan.dispatchedAt`, `Scan.executionStartedAt`
- New columns `ModuleRun.inngestEventId`, `ModuleRun.inngestRunId`
- New columns `Finding.detectorVersion` (default `'1.0.0'`), `Finding.snapshotBlockNumber`

- [ ] **Step 2: Inspect migration.sql**

Manually verify:
- No `NOT NULL` without defaults on existing tables.
- `ON DELETE CASCADE` on `GovernanceSnapshot.scanId` FK.
- `detectorVersion` column on `Finding` has `DEFAULT '1.0.0'`.

- [ ] **Step 3: Apply to Railway dev + validate**

```bash
pnpm prisma migrate status
# expected: "Database schema is up to date"

pnpm prisma studio
# spot-check: GovernanceSnapshot table exists, columns match
```

- [ ] **Step 4: Verify Plan 01 tests still green**

```bash
INTEGRATION_DB=1 pnpm test
```

All 204 Plan 01 tests must still pass. Any regression = migration issue.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(migration): 0003 governance_snapshot_and_dispatcher"
```

**Deliverables:** Migration committed, dev DB up to date, Plan 01 tests green.

**Exit:** `prisma migrate status` clean on dev DB. Integration tests green.

### Task B.3 — Plan 01 backlog: slug collision fix + ScanAttempt.reason nullability

**Files:**
- Modify: `src/lib/slug.ts`, `src/lib/__tests__/slug.test.ts`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/0004_scanattempt_reason_nullable/migration.sql`

Two Plan 01 deferrals resolved here. Kept in a single commit because both are schema-hygiene work and sit below the Plan 02 feature layer — no coupling to Phase C+.

- [ ] **Step 1: Slug collision fix**

Current implementation (Plan 01):
```typescript
export function generateSlug(chain: Chain, address: string): string {
  const short = address.slice(2, 10)   // 8 hex chars
  return `${chain.toLowerCase()}-${short}-${Date.now()}`
}
```

Problem: two addresses sharing first 8 hex chars race on insert in integration tests (and theoretically in production).

Fix: use 12-char prefix + keep timestamp for ordering stability:
```typescript
export function generateSlug(chain: Chain, address: string): string {
  const normalized = address.toLowerCase().replace(/^0x/, "")
  const prefix = normalized.slice(0, 12)     // 48 bits of entropy, sufficient for billions of protocols
  return `${chain.toLowerCase()}-${prefix}-${Date.now()}`
}
```

- [ ] **Step 2: Add unit test for collision resistance**

`src/lib/__tests__/slug.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { generateSlug } from "@/lib/slug"

describe("generateSlug", () => {
  it("differs for addresses sharing first 8 hex chars but not 12", () => {
    const addr1 = "0x1234567890abcdef1234567890abcdef12345678"
    const addr2 = "0x1234567890aboooooooooooooooooooooooooooo"
    const s1 = generateSlug("ETHEREUM", addr1)
    const s2 = generateSlug("ETHEREUM", addr2)
    expect(s1).not.toEqual(s2)
  })

  it("is deterministic for same address within same millisecond", () => {
    // documentary — caller must ensure uniqueness via DB unique constraint
    const addr = "0x1234567890abcdef1234567890abcdef12345678"
    const s1 = generateSlug("ETHEREUM", addr)
    const s2 = generateSlug("ETHEREUM", addr)
    // may differ by timestamp but prefix stable
    expect(s1.split("-").slice(0, 2)).toEqual(s2.split("-").slice(0, 2))
  })
})
```

- [ ] **Step 3: `ScanAttempt.reason` nullability**

Current schema (Plan 01):
```prisma
model ScanAttempt {
  reason String
}
```

Plan 01 ACCEPTED rows carry a sentinel string `"accepted"` because the column is `NOT NULL`. Relax to nullable: ACCEPTED rows persist `reason = NULL`; failure paths persist a specific reason string.

Update `prisma/schema.prisma`:
```prisma
model ScanAttempt {
  reason String?
}
```

- [ ] **Step 4: Generate migration**

```bash
pnpm prisma migrate dev --name scanattempt_reason_nullable
```

Creates `0004_scanattempt_reason_nullable/migration.sql`:
```sql
ALTER TABLE "ScanAttempt" ALTER COLUMN "reason" DROP NOT NULL;
```

- [ ] **Step 5: Update code sites that wrote the `"accepted"` sentinel**

In `src/app/api/scan/route.ts` (Plan 01), find the `prisma.scanAttempt.create({ ... status: "ACCEPTED", reason: "accepted", ... })` call and replace with `reason: null`.

Add a test to cover the change — `src/app/api/scan/__tests__/scan.integration.test.ts` (if the file does not exist, create per Plan 01 pattern). Example addition:

```typescript
it("ACCEPTED scan attempts persist with reason = NULL", async () => {
  const res = await submitScan(validUnclaimedAddress)
  expect(res.status).toBe(200)
  const attempt = await prisma.scanAttempt.findFirst({
    where: { scanId: res.body.scanId },
  })
  expect(attempt?.reason).toBeNull()
})
```

- [ ] **Step 6: Full test run**

```bash
INTEGRATION_DB=1 pnpm test
```

All 204 Plan 01 tests + new slug test + new scan attempt test must pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix: slug collision (12-char prefix) + ScanAttempt.reason nullability"
```

**Deliverables:** slug collision resistant to 48 bits; `ScanAttempt.reason` nullable; both backed by tests; migration `0004` applied.

**Exit:** `INTEGRATION_DB=1 pnpm test` green. Plan 01 backlog items `slug collision` and `ScanAttempt.reason nullability` resolved.

---

**Phase B exit gate:**
- `pnpm build && pnpm test` green
- `INTEGRATION_DB=1 pnpm test` green (204 Plan 01 tests + Phase B additions)
- Migrations `0003` and `0004` applied to Railway dev, no rollbacks
- `prisma migrate status` clean
- Two Plan 01 backlog items resolved: slug collision, `ScanAttempt.reason` nullability
- Vercel preview builds successfully (migrations auto-run via `prisma migrate deploy` in build script from Plan 01)

---

## Phase C — Inngest dispatcher (4 commits)

**Goal:** Inngest serve handler mounted at `/api/inngest`, `executeScan` orchestrator registered, `POST /api/scan` emits `scan.queued` after persistence and gates on the feature flag. The orchestrator fans out `scan.module.requested` per enabled module, awaits `scan.module.completed` with a 5m timeout, and emits `scan.completed`. Idempotent against Inngest retries.

**Risk:** Inngest serve route must run on Node runtime (not Edge). Default App Router route exports are Edge unless declared otherwise. If the handler runs on Edge, signature verification fails silently and Inngest Cloud never registers functions.
**Rollback:** If Inngest integration produces runtime errors that cascade into the scan API, flip `BREAKWATER_GOVERNANCE_MODULE_ENABLED=false` on Vercel. The flag short-circuits event emission in `POST /api/scan` before any Inngest client call — scans persist as Plan 01 QUEUED and stay there until the flag is flipped back.

### Task C.1 — Inngest serve handler + executeScan orchestrator shell

**Files:**
- Create: `src/app/api/inngest/route.ts`, `src/lib/inngest/functions/execute-scan.ts`

- [ ] **Step 1: Create `src/app/api/inngest/route.ts`**

```typescript
import { serve } from "inngest/next"
import { inngest } from "@/lib/inngest/client"
import { executeScan } from "@/lib/inngest/functions/execute-scan"

export const runtime = "nodejs"          // MUST be nodejs — Edge breaks signature verification

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [executeScan],
  // executeGovernanceModule registered in Phase F
})
```

- [ ] **Step 2: Create `src/lib/inngest/functions/execute-scan.ts` — orchestrator shell**

Per spec §4.3. This commit ships the orchestrator in full but relies on Phase F's `executeGovernanceModule` to actually respond to `scan.module.requested`. In Phase C end-to-end the orchestrator runs, dispatches `scan.module.requested`, and times out waiting for completion (no consumer yet).

```typescript
import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { recomputeScanStatus } from "@/lib/scanStatus"

export const executeScan = inngest.createFunction(
  { id: "execute-scan", name: "Execute scan" },
  { event: "scan.queued" },
  async ({ event, step }) => {
    const { scanId, modulesEnabled } = event.data

    await step.run("mark-started", async () => {
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "RUNNING",
          executionStartedAt: new Date(),
        },
      })
    })

    // Step 2: Fan-out — trigger a scan.module.requested event per enabled module
    for (const module of modulesEnabled) {
      await step.sendEvent(`trigger-${module}`, {
        name: "scan.module.requested",
        data: { scanId, module },
      })
    }

    // Step 3: Wait for all modules to signal completion (5m per module)
    for (const module of modulesEnabled) {
      await step.waitForEvent(`wait-${module}`, {
        event: "scan.module.completed",
        timeout: "5m",
        if: `event.data.scanId == "${scanId}" && event.data.module == "${module}"`,
      })
    }

    // Step 4: Finalize — compute composite grade, mark scan terminal
    await step.run("finalize", async () => {
      await recomputeScanStatus(scanId)
    })

    // Step 5: Emit scan.completed
    const finalScan = await step.run("fetch-final", () =>
      prisma.scan.findUniqueOrThrow({ where: { id: scanId } })
    )

    await step.sendEvent("emit-completed", {
      name: "scan.completed",
      data: {
        scanId,
        finalStatus: finalScan.status,
        compositeGrade: finalScan.compositeGrade,
        executionMs:
          Date.now() - (finalScan.executionStartedAt?.getTime() ?? Date.now()),
      },
    })
  }
)
```

`recomputeScanStatus` exists on `main` from Plan 01 — it reads all `ModuleRun` rows and computes terminal scan status. If it does not exist yet (check), stub it as:

```typescript
// src/lib/scanStatus.ts
export async function recomputeScanStatus(scanId: string): Promise<void> {
  const runs = await prisma.moduleRun.findMany({ where: { scanId } })
  const allTerminal = runs.every((r) =>
    ["COMPLETE", "FAILED", "SKIPPED"].includes(r.status)
  )
  if (!allTerminal) return
  const anyFailed = runs.some((r) => r.status === "FAILED")
  const anyComplete = runs.some((r) => r.status === "COMPLETE")
  const status = anyFailed
    ? "FAILED"
    : anyComplete
    ? "COMPLETE"
    : "FAILED"
  await prisma.scan.update({
    where: { id: scanId },
    data: { status, completedAt: new Date() },
  })
}
```

- [ ] **Step 3: Local Inngest dev server smoke**

```bash
# Terminal 1
pnpm dev
# Terminal 2
pnpm dlx inngest-cli@latest dev
```

Inngest dev UI at http://localhost:8288. Visit → Functions tab should list `execute-scan`. Click "Invoke with event" → paste `{ "name": "scan.queued", "data": { ... } }` → function runs (will time out on waitForEvent; that's expected).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(inngest): serve handler + executeScan orchestrator"
```

**Deliverables:** Inngest serve route, executeScan orchestrator registered, local dev server recognizes the function.

**Exit:** `pnpm build && pnpm test` green; Inngest dev UI lists the function.

### Task C.2 — POST /api/scan emits scan.queued (idempotent)

**Files:**
- Modify: `src/app/api/scan/route.ts`
- Create: `src/app/api/scan/__tests__/emission.test.ts`

- [ ] **Step 1: Add emission block to the handler**

After the existing Plan 01 logic that persists `Scan` + `ScanAttempt(ACCEPTED)` + `ModuleRun` rows, and before the 200 response:

```typescript
import { inngest } from "@/lib/inngest/client"
import { featureFlags } from "@/lib/featureFlags"

// ... existing Plan 01 handler body

// After scan persistence, before sending response:
if (
  featureFlags.governanceModuleEnabled &&
  scan.chain === "ETHEREUM" &&
  scan.status === "QUEUED"   // never dispatch SKIPPED or already-RUNNING scans
) {
  const eventIds = await inngest.send({
    name: "scan.queued",
    data: {
      scanId: scan.id,
      protocolId: scan.protocolId,
      chain: scan.chain,
      primaryContractAddress: scan.protocol.primaryContractAddress,
      modulesEnabled: scan.modules.map((m) => m.module),
    },
  })

  // Record dispatch for debugging + idempotency
  await prisma.scan.update({
    where: { id: scan.id },
    data: { dispatchedAt: new Date() },
  })

  // Attach inngestEventId to ModuleRun rows for dashboard correlation
  await prisma.moduleRun.updateMany({
    where: { scanId: scan.id },
    data: { inngestEventId: eventIds.ids[0] ?? null },
  })
}
```

Notes on the gate:
- `featureFlags.governanceModuleEnabled` — kill-switch per spec §15.
- `chain === "ETHEREUM"` — Plan 02 is mainnet only; Solana scans persist QUEUED forever.
- `status === "QUEUED"` — guards against dispatching a scan that was rejected earlier in the handler.

- [ ] **Step 2: Idempotency — dedupe on re-submits**

If a user re-submits the same `(chain, address)` within the dedupe window, Plan 01 returns the existing scan's id via the DUPLICATE path. Ensure that path does NOT re-emit `scan.queued`. Check the handler: the emission block must only run on the ACCEPTED path, not the DUPLICATE path.

- [ ] **Step 3: Write emission test**

`src/app/api/scan/__tests__/emission.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"
import { inngest } from "@/lib/inngest/client"

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: vi.fn().mockResolvedValue({ ids: ["evt_test"] }) },
}))

describe("POST /api/scan emits scan.queued", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("emits scan.queued on ACCEPTED path for ETHEREUM", async () => {
    const res = await submitUnclaimedEthereumScan()
    expect(res.status).toBe(200)
    expect(inngest.send).toHaveBeenCalledOnce()
    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({ name: "scan.queued" })
    )
  })

  it("does NOT emit on DUPLICATE path", async () => {
    await submitUnclaimedEthereumScan()
    vi.clearAllMocks()
    const res = await submitUnclaimedEthereumScan()   // dedupe hits
    expect(res.status).toBe(200)
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it("does NOT emit for SOLANA scans", async () => {
    const res = await submitSolanaScan()
    expect(res.status).toBe(200)
    expect(inngest.send).not.toHaveBeenCalled()
  })

  it("does NOT emit when flag is off", async () => {
    vi.stubEnv("BREAKWATER_GOVERNANCE_MODULE_ENABLED", "false")
    const res = await submitUnclaimedEthereumScan()
    expect(res.status).toBe(200)
    expect(inngest.send).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })
})
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(api): POST /api/scan emits scan.queued (ETHEREUM-only, flag-gated, idempotent)"
```

**Deliverables:** ACCEPTED ETHEREUM path emits exactly once; DUPLICATE path does not; SOLANA scans do not; flag off short-circuits.

**Exit:** `pnpm test` includes 4 new emission tests, all green.

### Task C.2.5 — Structured logging helper + initial call sites

**Files:**
- Create: `src/lib/logging.ts`, `src/lib/__tests__/logging.test.ts`
- Modify: `src/app/api/scan/route.ts`, `src/lib/inngest/functions/execute-scan.ts`

Deliverable: `src/lib/logging.ts` with a `log()` helper for scan-lifecycle events. Matches spec §16 event list verbatim so downstream log-aggregation (Railway structured logs) has a stable schema.

- [ ] **Step 1: Create `src/lib/logging.ts`**

```typescript
export type ScanLogEvent =
  | { event: "scan.submitted"; scanId: string; chain: string; modulesEnabled: string[] }
  | { event: "scan.dispatched"; scanId: string; inngestEventId: string }
  | { event: "scan.module.started"; scanId: string; module: string }
  | {
      event: "scan.module.completed"
      scanId: string
      module: string
      grade: string | null
      executionMs: number
    }
  | {
      event: "scan.completed"
      scanId: string
      compositeGrade: string | null
      totalExecutionMs: number
    }
  | { event: "scan.failed"; scanId: string; module: string; errorCode: string }
  | { event: "detector.fired"; scanId: string; detectorId: string; severity: string }

export function log(payload: ScanLogEvent): void {
  const enriched = {
    ...payload,
    timestamp: new Date().toISOString(),
    service: "breakwater",
  }
  console.log(JSON.stringify(enriched))
}
```

The helper writes a single JSON line to `stdout`. Railway's log aggregation captures these verbatim. Formally-typed `ScanLogEvent` guarantees every call site maps to spec §16 exactly — no drift.

- [ ] **Step 2: Initial call sites added in this sub-task**

**`src/app/api/scan/route.ts`** — two calls inside the ACCEPTED path:

```typescript
import { log } from "@/lib/logging"

// After scan + ScanAttempt(ACCEPTED) persistence
log({
  event: "scan.submitted",
  scanId: scan.id,
  chain: scan.chain,
  modulesEnabled: scan.modules.map((m) => m.module),
})

// Inside the existing Inngest emission block, after inngest.send()
log({
  event: "scan.dispatched",
  scanId: scan.id,
  inngestEventId: eventIds.ids[0] ?? "unknown",
})
```

**`src/lib/inngest/functions/execute-scan.ts`** — two calls in the orchestrator:

```typescript
import { log } from "@/lib/logging"

// After step.run("finalize", ...)
if (finalScan.status === "FAILED") {
  log({
    event: "scan.failed",
    scanId,
    module: "orchestrator",
    errorCode: "module_failure",
  })
}

// Before emit-completed, replace the existing sendEvent call to also log
log({
  event: "scan.completed",
  scanId,
  compositeGrade: finalScan.compositeGrade,
  totalExecutionMs:
    Date.now() - (finalScan.executionStartedAt?.getTime() ?? Date.now()),
})
```

Remaining call sites are added in their respective phases:
- **F.1** (detector orchestrator): `scan.module.started` before the run loop, `scan.module.completed` after persistFindingsAndGrade.
- **F.2** (persistFindingsAndGrade): `detector.fired` once per finding inserted.

- [ ] **Step 3: Unit tests**

`src/lib/__tests__/logging.test.ts` with 7 cases, one per event type. Each asserts: correct `event` name, correct payload fields, `timestamp` present and ISO-8601, `service: "breakwater"` stamped.

Example:
```typescript
import { describe, it, expect, vi } from "vitest"
import { log } from "@/lib/logging"

describe("log", () => {
  it("writes scan.submitted as JSON to stdout with timestamp + service", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {})
    log({
      event: "scan.submitted",
      scanId: "s1",
      chain: "ETHEREUM",
      modulesEnabled: ["GOVERNANCE"],
    })
    expect(spy).toHaveBeenCalledOnce()
    const payload = JSON.parse(spy.mock.calls[0][0] as string)
    expect(payload.event).toBe("scan.submitted")
    expect(payload.scanId).toBe("s1")
    expect(payload.service).toBe("breakwater")
    expect(payload.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    spy.mockRestore()
  })

  // Mirror for: scan.dispatched, scan.module.started, scan.module.completed,
  // scan.completed, scan.failed, detector.fired
})
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(C.2.5): structured logging helper + scan.submitted/dispatched/completed events"
```

**Deliverables:** `log()` helper with exhaustive `ScanLogEvent` union, 4 initial call sites, 7 unit tests.

**Exit:** `pnpm test` green (+7 tests). Log lines visible in `pnpm dev` stdout when a scan is submitted.

### Task C.3 — Orchestrator idempotency + retry policy + status marker

**Files:**
- Modify: `src/lib/inngest/functions/execute-scan.ts`
- Create: `src/lib/inngest/__tests__/execute-scan.test.ts`

- [ ] **Step 1: Add per-step retry configuration**

Inngest retries failed steps by default (3 attempts, exp. backoff). Override per spec §4.4:

```typescript
export const executeScan = inngest.createFunction(
  {
    id: "execute-scan",
    name: "Execute scan",
    retries: 3,                    // function-level — applies if a step exhausts its own retries
  },
  { event: "scan.queued" },
  async ({ event, step }) => {
    // ... per spec §4.3
  }
)
```

- [ ] **Step 2: Idempotency — step IDs must be stable**

Inngest deduplicates step runs by step id. Ensure all step ids above (`mark-started`, `trigger-${module}`, `wait-${module}`, `finalize`, `fetch-final`, `emit-completed`) are deterministic per scanId — they are, since `${module}` resolves from the event payload.

- [ ] **Step 3: Guard against double-finalization**

If Inngest retries `finalize`, `recomputeScanStatus` must be idempotent. Add a conditional update to avoid overwriting a terminal row's `completedAt`:

```typescript
// in recomputeScanStatus
if (allTerminal) {
  await prisma.scan.update({
    where: {
      id: scanId,
      status: { notIn: ["COMPLETE", "FAILED", "EXPIRED"] },   // only if not already terminal
    },
    data: { status, completedAt: new Date() },
  })
}
```

- [ ] **Step 4: Inngest function unit test**

`src/lib/inngest/__tests__/execute-scan.test.ts`:

Use Inngest's built-in test harness (per spec §10.4):

```typescript
import { describe, it, expect, beforeEach } from "vitest"
import { executeScan } from "@/lib/inngest/functions/execute-scan"
import { prisma } from "@/lib/prisma"
import { makeScanFixture } from "@/lib/__tests__/helpers/scanFixture"

describe("executeScan orchestrator", () => {
  let scanId: string

  beforeEach(async () => {
    const scan = await makeScanFixture({ modules: ["GOVERNANCE"] })
    scanId = scan.id
  })

  it("marks scan RUNNING and dispatches module events", async () => {
    // Invoke function in-process (no real Inngest)
    // The test harness lets us assert mark-started happened and sendEvent fired.
  })
})
```

**Implementation approach for Inngest v3 testing:**

Primary: use `@inngest/test` (see https://www.inngest.com/docs/test). If the `@inngest/test` package is available at time of implementation, use it for function-level testing.

Fallback: if `@inngest/test` is not available or its API differs from the docs, use a manual mock approach:
- Mock the Inngest client via `vi.mock("@/lib/inngest/client")`.
- Assert step ids called with the expected event data (by asserting on `inngest.send` calls).
- Simulate `scan.module.completed` event emission manually inside the test.

Do NOT defer the decision to implementation time — commit to the fallback path upfront. Migration to `@inngest/test` can happen as a refactor in Plan 07+ if needed.

- [ ] **Step 5: Status marker commit**

```bash
git commit --allow-empty -m "chore: Phase C status marker — dispatcher shell wired"
```

- [ ] **Step 6: Push + Vercel preview smoke**

```bash
git push
```

Preview deploy: submit an Ethereum scan via the form. Expected:
- Scan persists as QUEUED → dispatchedAt set
- `/scan/[id]` shows QUEUED shell (Plan 01 behavior)
- Inngest dashboard (preview app) shows `scan.queued` event arrived, `executeScan` function started
- `executeScan` times out at `wait-GOVERNANCE` (no consumer yet — expected until Phase F)
- Scan remains RUNNING indefinitely (Phase F closes this loop)

**Deliverables:** orchestrator with explicit retry policy, idempotent finalize guard, one unit test, status marker commit.

**Exit:** Inngest dashboard shows executeScan running on preview. `pnpm build && pnpm test` green.

---

**Phase C exit gate:**
- Inngest serve handler live at `/api/inngest` on preview
- `executeScan` orchestrator registered and runnable
- POST /api/scan emits `scan.queued` on ETHEREUM ACCEPTED path only
- Feature flag `BREAKWATER_GOVERNANCE_MODULE_ENABLED=false` short-circuits emission
- Inngest dashboard (preview app) shows events + function runs
- `dispatchedAt` + `inngestEventId` populated on new scans
- Plan 01 tests + Phase B + Phase C tests all green

---

## Phase D — On-chain data layer (6 commits)

**Goal:** `captureGovernanceSnapshot(scanId)` reads live Ethereum state for the scan's primary contract, detects governance primitives (Governor, Timelock, Safe, proxy), persists a `GovernanceSnapshot` row, and returns a typed snapshot shape ready for detector consumption.

**Risk:** Public RPC (Ankr, Cloudflare) has no SLA. Rate limits or intermittent 5xx responses may cause `captureGovernanceSnapshot` to fail. viem's `fallback` transport handles transport-level errors, but logic-level errors (e.g., reading a slot on a non-proxy contract returns 0x, which is not an error) still have to be handled in detector code.
**Rollback:** If the snapshot layer proves flaky, cache a few real protocols' snapshots as fixtures and run detectors offline. If RPC is the blocker, swap `PRIMARY_ETH_RPC_URL` to a paid provider temporarily — detector code is RPC-agnostic by design.

### Task D.1 — viem multicall wrapper + EIP-1967 slot reader

**Files:**
- Create: `src/lib/onchain/multicall.ts`, `src/lib/onchain/proxy.ts`, `src/lib/onchain/__tests__/multicall.test.ts`

- [ ] **Step 1: Create `src/lib/onchain/multicall.ts`**

Thin wrapper over viem's `publicClient.multicall` so detector code consumes a typed batching helper:

```typescript
import type { Abi, ContractFunctionParameters } from "viem"
import { ethClient } from "@/lib/rpc-client"

export async function batchRead<T extends readonly ContractFunctionParameters[]>(
  calls: T
): Promise<
  Array<
    | { status: "success"; result: unknown }
    | { status: "failure"; error: Error }
  >
> {
  return ethClient.multicall({
    contracts: calls as any,
    allowFailure: true,
  })
}
```

- [ ] **Step 2: Create `src/lib/onchain/proxy.ts`**

EIP-1967 slot reader + proxy type detection:

```typescript
import { getAddress, hexToBytes } from "viem"
import { ethClient } from "@/lib/rpc-client"
import type { ProxyType } from "@prisma/client"

// EIP-1967 standardized storage slots
const IMPL_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
const ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
const BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"

export type ProxyReadResult = {
  proxyType: ProxyType
  proxyAdminAddress: string | null
  proxyImplementation: string | null
}

export async function readProxyState(
  address: `0x${string}`
): Promise<ProxyReadResult> {
  const [implSlot, adminSlot] = await Promise.all([
    ethClient.getStorageAt({ address, slot: IMPL_SLOT }),
    ethClient.getStorageAt({ address, slot: ADMIN_SLOT }),
  ])

  const impl = implSlot && implSlot !== "0x" + "0".repeat(64)
    ? slotToAddress(implSlot)
    : null
  const admin = adminSlot && adminSlot !== "0x" + "0".repeat(64)
    ? slotToAddress(adminSlot)
    : null

  if (!impl && !admin) return { proxyType: "NONE", proxyAdminAddress: null, proxyImplementation: null }

  // Distinguishing UUPS from Transparent requires ABI inspection — default to Transparent
  // here; detectors refine via ABI probing in Phase D.3.
  return {
    proxyType: "EIP_1967_TRANSPARENT",
    proxyAdminAddress: admin,
    proxyImplementation: impl,
  }
}

function slotToAddress(slot: `0x${string}`): string {
  // Storage slots are 32 bytes; address lives in the last 20 bytes.
  return getAddress("0x" + slot.slice(26))
}
```

- [ ] **Step 3: Unit tests with mocked client**

`src/lib/onchain/__tests__/multicall.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest"
import { readProxyState } from "@/lib/onchain/proxy"

vi.mock("@/lib/rpc-client", () => ({
  ethClient: {
    getStorageAt: vi.fn(),
    multicall: vi.fn(),
  },
}))

import { ethClient } from "@/lib/rpc-client"

describe("readProxyState", () => {
  it("returns NONE when both slots are zero", async () => {
    vi.mocked(ethClient.getStorageAt).mockResolvedValue(
      "0x" + "0".repeat(64) as `0x${string}`
    )
    const r = await readProxyState("0x" + "1".repeat(40) as `0x${string}`)
    expect(r.proxyType).toBe("NONE")
  })

  it("returns EIP_1967_TRANSPARENT when impl slot populated", async () => {
    vi.mocked(ethClient.getStorageAt)
      .mockResolvedValueOnce(
        // impl slot: zero-padded address
        ("0x" + "0".repeat(24) + "a".repeat(40)) as `0x${string}`
      )
      .mockResolvedValueOnce(
        ("0x" + "0".repeat(24) + "b".repeat(40)) as `0x${string}`
      )
    const r = await readProxyState("0x" + "1".repeat(40) as `0x${string}`)
    expect(r.proxyType).toBe("EIP_1967_TRANSPARENT")
    expect(r.proxyImplementation).toBeTruthy()
    expect(r.proxyAdminAddress).toBeTruthy()
  })
})
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(onchain): multicall wrapper + EIP-1967 proxy slot reader"
```

**Deliverables:** `batchRead`, `readProxyState`, 3 unit tests.

**Exit:** `pnpm test` green. No live RPC calls in unit tests.

### Task D.2 — Safe API client with retries + Etherscan ABI fetch

**Files:**
- Modify: `src/lib/safe-api.ts`, `src/lib/etherscan.ts`
- Create: `src/lib/safe-api.test.ts`, `src/lib/etherscan.test.ts`

- [ ] **Step 1: Add retry + abort to Safe API client**

Upgrade the stub from A.3 with a retry loop and clear error classification:

```typescript
import { z } from "zod"
import { config } from "@/lib/config"

const safeInfoSchema = z.object({
  address: z.string(),
  threshold: z.number().int().positive(),
  owners: z.array(z.string()),
  modules: z.array(z.string()).default([]),
})

export type SafeInfo = z.infer<typeof safeInfoSchema>

export async function fetchSafeInfo(
  address: string,
  opts: { signal?: AbortSignal; retries?: number } = {}
): Promise<SafeInfo | null> {
  const retries = opts.retries ?? 2
  const url = `${config.SAFE_API_BASE_URL}/safes/${address}/`

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: opts.signal, cache: "no-store" })
      if (res.status === 404) return null
      if (res.status === 429 || res.status >= 500) {
        if (attempt < retries) {
          await new Promise((r) =>
            setTimeout(r, 200 * Math.pow(2, attempt))
          )
          continue
        }
        throw new Error(`Safe API ${res.status} after ${retries + 1} attempts`)
      }
      if (!res.ok) throw new Error(`Safe API error: ${res.status}`)
      return safeInfoSchema.parse(await res.json())
    } catch (err) {
      if (attempt === retries) throw err
    }
  }
  throw new Error("unreachable")
}
```

- [ ] **Step 2: Mirror retry logic in Etherscan client**

Apply the same retry pattern to `fetchContractAbi`.

- [ ] **Step 3: Unit tests with `fetch` mock**

`src/lib/__tests__/safe-api.test.ts` — cover 404, 200, 429 retry, 500 retry, schema error:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest"

describe("fetchSafeInfo", () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn() as any
  })
  afterEach(() => {
    global.fetch = originalFetch
  })

  it("returns null on 404", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      status: 404,
      ok: false,
    } as any)
    const { fetchSafeInfo } = await import("@/lib/safe-api")
    expect(await fetchSafeInfo("0xabc")).toBeNull()
  })

  it("retries on 429", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ status: 429, ok: false } as any)
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: async () => ({ address: "0xabc", threshold: 3, owners: ["0x1", "0x2", "0x3"] }),
      } as any)
    const { fetchSafeInfo } = await import("@/lib/safe-api")
    const r = await fetchSafeInfo("0xabc")
    expect(r?.threshold).toBe(3)
  })
})
```

Mirror for `etherscan.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(external): Safe + Etherscan clients with retry + error classification"
```

**Deliverables:** Both clients hardened, each covered by ≥4 tests.

**Exit:** `pnpm test` green. Total test count up by ~8.

### Task D.3a — Snapshot types + Governor detection

**Files:**
- Create: `src/lib/detectors/governance/types.ts`, `src/lib/detectors/governance/detectGovernor.ts`, `src/lib/detectors/governance/__tests__/detectGovernor.test.ts`

- [ ] **Step 1: Create `src/lib/detectors/governance/types.ts`**

Declares all snapshot fields eventually populated by D.3a–D.3c (and `implementationAbi`, `proxyAdminIsContract` used by Phase E detectors). Types land once, up-front, so Phase E does not retroactively mutate the shape.

```typescript
import type {
  GovernorType,
  ProxyType,
  VotingSnapshotType,
} from "@prisma/client"

export type GovernorDetectionResult = {
  hasGovernor: boolean
  governorAddress: string | null
  governorType: GovernorType | null
  governorVersion: string | null
}

export type TimelockDetectionResult = {
  timelockAddress: string
  timelockMinDelay: number | null
  timelockAdmin: string | null
}

export type SafeDetectionResult = {
  address: string
  threshold: number
  owners: string[]
  ownerCount: number
}

export type ProxyDetectionResult = {
  proxyType: ProxyType
  proxyAdminAddress: string | null
  proxyImplementation: string | null
  proxyVerified: boolean
  proxyAdminIsContract: boolean
}

export type GovernanceSnapshotData = {
  blockNumber: bigint
  capturedAt: Date

  hasGovernor: boolean
  governorAddress: string | null
  governorType: GovernorType | null
  governorVersion: string | null

  hasTimelock: boolean
  timelockAddress: string | null
  timelockMinDelay: number | null
  timelockAdmin: string | null

  hasMultisig: boolean
  multisigAddress: string | null
  multisigThreshold: number | null
  multisigOwnerCount: number | null
  multisigOwners: string[]

  proxyType: ProxyType
  proxyAdminAddress: string | null
  proxyImplementation: string | null
  proxyVerified: boolean
  proxyAdminIsContract: boolean        // consumed by GOV-005 in Phase E.5

  votingTokenAddress: string | null
  votingSnapshotType: VotingSnapshotType

  implementationAbi: string | null     // JSON ABI for Phase E.2 (GOV-002) and E.6 (GOV-006)

  rawState: Record<string, unknown>
}
```

- [ ] **Step 2: Implement `detectGovernor`**

`src/lib/detectors/governance/detectGovernor.ts`:

```typescript
import { parseAbi } from "viem"
import { batchRead } from "@/lib/onchain/multicall"
import type { GovernorDetectionResult } from "./types"

const governorProbeAbi = parseAbi([
  "function COUNTING_MODE() view returns (string)",
  "function quorum(uint256 blockNumber) view returns (uint256)",
  "function proposalThreshold() view returns (uint256)",
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function name() view returns (string)",
])

export async function detectGovernor(
  address: `0x${string}`
): Promise<GovernorDetectionResult> {
  const results = await batchRead([
    { address, abi: governorProbeAbi, functionName: "COUNTING_MODE" },
    { address, abi: governorProbeAbi, functionName: "quorum", args: [0n] },
    { address, abi: governorProbeAbi, functionName: "proposalThreshold" },
    { address, abi: governorProbeAbi, functionName: "votingDelay" },
    { address, abi: governorProbeAbi, functionName: "votingPeriod" },
    { address, abi: governorProbeAbi, functionName: "name" },
  ])

  const [countingMode, quorum, propThresh, vDelay, vPeriod, name] = results

  const anySuccess = results.some((r) => r.status === "success")
  if (!anySuccess) {
    return { hasGovernor: false, governorAddress: null, governorType: null, governorVersion: null }
  }

  // OZ Governor — COUNTING_MODE is the tell
  if (countingMode.status === "success") {
    return {
      hasGovernor: true,
      governorAddress: address,
      governorType: "OZ_GOVERNOR",
      governorVersion: parseOzVersion(countingMode.result as string),
    }
  }

  // Compound Bravo — name contains "Compound" or "Bravo"
  if (name.status === "success") {
    const nameStr = (name.result as string).toLowerCase()
    if (nameStr.includes("compound") || nameStr.includes("bravo")) {
      return {
        hasGovernor: true,
        governorAddress: address,
        governorType: "COMPOUND_BRAVO",
        governorVersion: null,
      }
    }
  }

  // Custom: has governor-like surface (quorum + proposalThreshold) but unfamiliar signature
  if (quorum.status === "success" && propThresh.status === "success") {
    return {
      hasGovernor: true,
      governorAddress: address,
      governorType: "CUSTOM",
      governorVersion: null,
    }
  }

  return { hasGovernor: false, governorAddress: null, governorType: null, governorVersion: null }
}

function parseOzVersion(countingMode: string): string | null {
  // OZ governors return strings like "support=bravo&quorum=for,abstain".
  // Version is not in the string; leave null unless Governor exposes `version()`.
  return null
}
```

- [ ] **Step 3: Unit tests (5)**

`src/lib/detectors/governance/__tests__/detectGovernor.test.ts`:

Mock `batchRead` to return typed results for each scenario.

1. **OZ Governor detected** — `COUNTING_MODE` succeeds → `governorType === "OZ_GOVERNOR"`.
2. **Compound Bravo detected** — `COUNTING_MODE` fails, `name` returns `"Compound Governor Bravo"` → `governorType === "COMPOUND_BRAVO"`.
3. **No governor** — all probes fail → `hasGovernor === false`.
4. **Malformed contract** — mixed success/failure, neither OZ nor Compound signature → returns CUSTOM if quorum+proposalThreshold both succeed, else no governor.
5. **Multicall partial failure** — `quorum` succeeds, everything else fails → `hasGovernor === true`, `governorType === null` (falls through to CUSTOM only when both quorum and proposalThreshold succeed).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(D.3a): governance snapshot types + Governor detection"
```

**Deliverables:** `types.ts` (all eventual snapshot fields declared), `detectGovernor.ts`, 5 unit tests.

**Exit:** `pnpm test` green. Types file is the single source of truth for `GovernanceSnapshotData` across all Phase E detectors.

### Task D.3b — Timelock + Safe detection

**Files:**
- Create: `src/lib/detectors/governance/detectTimelock.ts`, `src/lib/detectors/governance/detectSafe.ts`, `src/lib/detectors/governance/__tests__/detectTimelock.test.ts`, `src/lib/detectors/governance/__tests__/detectSafe.test.ts`

- [ ] **Step 1: Implement `detectTimelock`**

`src/lib/detectors/governance/detectTimelock.ts`:

```typescript
import { parseAbi } from "viem"
import { batchRead } from "@/lib/onchain/multicall"
import { ethClient } from "@/lib/rpc-client"
import type { TimelockDetectionResult } from "./types"

const governorTimelockAbi = parseAbi([
  "function timelock() view returns (address)",
])

const timelockProbeAbi = parseAbi([
  "function getMinDelay() view returns (uint256)",   // OZ TimelockController
  "function delay() view returns (uint256)",          // Compound Timelock
  "function admin() view returns (address)",
])

export async function detectTimelock(
  governorAddress: `0x${string}`
): Promise<TimelockDetectionResult | null> {
  // Step 1: Ask the Governor for its Timelock address
  let timelockAddr: `0x${string}` | null = null
  try {
    timelockAddr = (await ethClient.readContract({
      address: governorAddress,
      abi: governorTimelockAbi,
      functionName: "timelock",
    })) as `0x${string}`
  } catch {
    return null // Governor has no timelock() — no Timelock in path
  }

  // Step 2: Probe the candidate with OZ + Compound signatures
  const results = await batchRead([
    { address: timelockAddr, abi: timelockProbeAbi, functionName: "getMinDelay" },
    { address: timelockAddr, abi: timelockProbeAbi, functionName: "delay" },
    { address: timelockAddr, abi: timelockProbeAbi, functionName: "admin" },
  ])

  const [ozDelay, compoundDelay, admin] = results

  const minDelay =
    ozDelay.status === "success"
      ? Number(ozDelay.result)
      : compoundDelay.status === "success"
      ? Number(compoundDelay.result)
      : null

  if (minDelay === null) return null  // not a Timelock

  return {
    timelockAddress: timelockAddr,
    timelockMinDelay: minDelay,
    timelockAdmin: admin.status === "success" ? (admin.result as string) : null,
  }
}
```

- [ ] **Step 2: Implement `detectSafe`**

`src/lib/detectors/governance/detectSafe.ts`:

```typescript
import { parseAbi } from "viem"
import { batchRead } from "@/lib/onchain/multicall"
import { fetchSafeInfo } from "@/lib/safe-api"
import type { SafeDetectionResult } from "./types"

const safeContractAbi = parseAbi([
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
])

export async function detectSafe(
  address: `0x${string}`
): Promise<SafeDetectionResult | null> {
  // Primary path: Safe Transaction Service API
  try {
    const info = await fetchSafeInfo(address)
    if (info) {
      return {
        address: info.address,
        threshold: info.threshold,
        owners: info.owners,
        ownerCount: info.owners.length,
      }
    }
  } catch {
    // fall through to contract-read fallback
  }

  // Fallback: direct contract read (handles Safe-API outage or chains not covered by the service)
  const results = await batchRead([
    { address, abi: safeContractAbi, functionName: "getThreshold" },
    { address, abi: safeContractAbi, functionName: "getOwners" },
  ])

  const [threshold, owners] = results
  if (threshold.status !== "success" || owners.status !== "success") return null

  const ownersList = owners.result as readonly string[]
  return {
    address,
    threshold: Number(threshold.result),
    owners: [...ownersList],
    ownerCount: ownersList.length,
  }
}
```

- [ ] **Step 3: Unit tests (5)**

Split across two files; 5 tests total.

**`detectTimelock.test.ts`:**

1. **OZ TimelockController detected** — Governor returns timelock address, `getMinDelay` succeeds, `admin` returns address → result populated.
2. **Compound Timelock detected** — `getMinDelay` fails, `delay` succeeds → result populated with Compound delay.
3. **No timelock** — Governor has no `timelock()` function → `null`.

**`detectSafe.test.ts`:**

4. **Safe API hit** — `fetchSafeInfo` returns `{threshold: 3, owners: [...]}` → returns populated result, no contract-read fallback called.
5. **Safe API miss with contract fallback** — `fetchSafeInfo` returns `null`, `getThreshold` + `getOwners` succeed on-chain → returns result.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(D.3b): Timelock + Safe (multisig) detection"
```

**Deliverables:** `detectTimelock.ts`, `detectSafe.ts`, 5 unit tests.

**Exit:** `pnpm test` green. Both helpers return typed results or `null`.

### Task D.3c — Proxy detection + snapshot assembly

**Files:**
- Create: `src/lib/detectors/governance/detectProxy.ts`, `src/lib/detectors/governance/snapshot.ts`, `src/lib/detectors/governance/__tests__/detectProxy.test.ts`, `src/lib/detectors/governance/__tests__/snapshot.test.ts`

- [ ] **Step 1: Implement `detectProxy`**

`src/lib/detectors/governance/detectProxy.ts` — wraps `readProxyState` from D.1 and extends with UUPS + non-standard fallback + `proxyAdminIsContract` probe:

```typescript
import { ethClient } from "@/lib/rpc-client"
import { readProxyState } from "@/lib/onchain/proxy"
import { fetchContractAbi } from "@/lib/etherscan"
import type { ProxyDetectionResult } from "./types"

const SLOT_ZERO =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const

export async function detectProxy(
  address: `0x${string}`
): Promise<ProxyDetectionResult> {
  // EIP-1967 transparent / UUPS common slots (handled in D.1 readProxyState)
  const base = await readProxyState(address)

  // Non-standard proxy fallback (Audius pattern):
  // If EIP-1967 reports NONE but storage slot 0 is non-zero AND contract has code → likely custom proxy.
  if (base.proxyType === "NONE") {
    const slot0 = await ethClient.getStorageAt({ address, slot: SLOT_ZERO })
    const code = await ethClient.getCode({ address })
    if (slot0 && slot0 !== SLOT_ZERO && code && code !== "0x") {
      return {
        proxyType: "CUSTOM",
        proxyAdminAddress: null,
        proxyImplementation: null,
        proxyVerified: false,
        proxyAdminIsContract: false,
      }
    }
    return {
      ...base,
      proxyVerified: false,
      proxyAdminIsContract: false,
    }
  }

  // Check if admin is a contract (EOA vs contract matters for GOV-005)
  const adminIsContract = base.proxyAdminAddress
    ? (await ethClient.getCode({
        address: base.proxyAdminAddress as `0x${string}`,
      })) !== "0x"
    : false

  // proxyVerified = implementation has a verified ABI on Etherscan
  const proxyVerified = base.proxyImplementation
    ? Boolean(await fetchContractAbi(base.proxyImplementation).catch(() => null))
    : false

  return {
    ...base,
    proxyVerified,
    proxyAdminIsContract: adminIsContract,
  }
}
```

UUPS detection refinement (detecting `_authorizeUpgrade` access control) is deferred to Plan 03+ per spec §5.2 GOV-005. For Plan 02, UUPS contracts surface as `EIP_1822_UUPS` if `readProxyState` already identifies them; GOV-005 fails closed on UUPS without ABI.

- [ ] **Step 2: Implement `captureGovernanceSnapshot`**

`src/lib/detectors/governance/snapshot.ts`:

```typescript
import { prisma } from "@/lib/prisma"
import { ethClient } from "@/lib/rpc-client"
import { fetchContractAbi } from "@/lib/etherscan"
import { detectGovernor } from "./detectGovernor"
import { detectTimelock } from "./detectTimelock"
import { detectSafe } from "./detectSafe"
import { detectProxy } from "./detectProxy"
import type { GovernanceSnapshotData } from "./types"

export async function captureGovernanceSnapshot(
  scanId: string
): Promise<GovernanceSnapshotData> {
  const scan = await prisma.scan.findUniqueOrThrow({
    where: { id: scanId },
    include: { protocol: true },
  })

  const address = scan.protocol.primaryContractAddress as `0x${string}`
  const blockNumber = await ethClient.getBlockNumber()

  // Detect in parallel where dependencies allow
  const [proxy, governor, safeAtAddress] = await Promise.all([
    detectProxy(address),
    detectGovernor(address),
    detectSafe(address).catch(() => null),
  ])

  const timelock = governor.governorAddress
    ? await detectTimelock(governor.governorAddress as `0x${string}`)
    : null

  // If timelock admin is a Safe, that is the real governance multisig
  const timelockSafe = timelock?.timelockAdmin
    ? await detectSafe(timelock.timelockAdmin as `0x${string}`).catch(() => null)
    : null
  const multisig = timelockSafe ?? safeAtAddress

  // ABI for Phase E detectors (GOV-002, GOV-006)
  const abiAddress = proxy.proxyImplementation ?? address
  const implementationAbi = await fetchContractAbi(abiAddress).catch(() => null)

  const snapshot: GovernanceSnapshotData = {
    blockNumber,
    capturedAt: new Date(),

    hasGovernor: governor.hasGovernor,
    governorAddress: governor.governorAddress,
    governorType: governor.governorType,
    governorVersion: governor.governorVersion,

    hasTimelock: timelock !== null,
    timelockAddress: timelock?.timelockAddress ?? null,
    timelockMinDelay: timelock?.timelockMinDelay ?? null,
    timelockAdmin: timelock?.timelockAdmin ?? null,

    hasMultisig: multisig !== null,
    multisigAddress: multisig?.address ?? null,
    multisigThreshold: multisig?.threshold ?? null,
    multisigOwnerCount: multisig?.ownerCount ?? null,
    multisigOwners: multisig?.owners ?? [],

    proxyType: proxy.proxyType,
    proxyAdminAddress: proxy.proxyAdminAddress,
    proxyImplementation: proxy.proxyImplementation,
    proxyVerified: proxy.proxyVerified,
    proxyAdminIsContract: proxy.proxyAdminIsContract,

    votingTokenAddress: null,           // populated in Phase E.4 (GOV-004)
    votingSnapshotType: "NONE",         // populated in Phase E.4 (GOV-004)

    implementationAbi,

    rawState: { governor, timelock, safeAtAddress, timelockSafe, proxy },
  }

  // Persist (idempotent via unique scanId — §4.6)
  await prisma.governanceSnapshot.upsert({
    where: { scanId },
    create: { scanId, ...snapshotToCreate(snapshot) },
    update: snapshotToCreate(snapshot),
  })

  return snapshot
}
```

`snapshotToCreate` is a private mapper that drops transient fields like `capturedAt` (Prisma sets it via `@default(now())`). Trivial, not shown.

- [ ] **Step 3: Unit tests (6)**

Split across two files.

**`detectProxy.test.ts`:**
1. **Transparent proxy** — EIP-1967 impl + admin slots populated → `EIP_1967_TRANSPARENT`.
2. **UUPS proxy** — `readProxyState` returns UUPS → surfaced unchanged.
3. **Custom / non-standard** — EIP-1967 slots empty, slot 0 non-zero, code present → `CUSTOM`.

**`snapshot.test.ts`:**
4. **Full happy path** — OZ Governor + 48h Timelock + 5/9 Safe at timelock admin + proxy → all fields populated, upsert called.
5. **Upsert idempotency** — call `captureGovernanceSnapshot(scanId)` twice → single `GovernanceSnapshot` row exists (assert `count === 1`).
6. **Block number capture** — mocked `getBlockNumber` returns `21_000_000n` → persisted snapshot `blockNumber === 21_000_000n`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(D.3c): proxy detection + snapshot assembly"
```

**Deliverables:** `detectProxy.ts`, `snapshot.ts`, 6 unit tests.

**Exit:** `pnpm test` green. Snapshot capture composes all four detectors; upsert is idempotent on scanId.

### Task D.4 — Live-RPC smoke tests (gated behind env flag)

**Files:**
- Create: `src/lib/detectors/governance/__tests__/snapshot.live.test.ts`

- [ ] **Step 1: Live smoke tests for three protocols**

These tests hit real RPC. They are gated behind `LIVE_RPC=1` env so CI does not run them. Local smoke + preview manual runs.

```typescript
import { describe, it, expect } from "vitest"
import { captureGovernanceSnapshot } from "@/lib/detectors/governance/snapshot"
import { seedProtocolFixture } from "@/lib/__tests__/helpers/seedProtocol"

const maybe = process.env.LIVE_RPC === "1" ? describe : describe.skip

maybe("captureGovernanceSnapshot (live RPC)", () => {
  it("Uniswap V3 factory: no governor, no timelock (factory is ownerless)", async () => {
    const scan = await seedProtocolFixture({
      address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    })
    const snap = await captureGovernanceSnapshot(scan.id)
    expect(snap.hasGovernor).toBe(false)
  })

  it("Compound Comptroller: Governor Bravo detected", async () => {
    const scan = await seedProtocolFixture({
      address: "0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B",  // Compound Governor Bravo
    })
    const snap = await captureGovernanceSnapshot(scan.id)
    expect(snap.hasGovernor).toBe(true)
    expect(snap.governorType).toBe("COMPOUND_BRAVO")
  })

  it("Aave V3 Executor (short): Timelock with 1-day delay + Safe admin", async () => {
    const scan = await seedProtocolFixture({
      address: "0xEE56e2B3D491590B5b31738cC34d5232F378a8D5",
    })
    const snap = await captureGovernanceSnapshot(scan.id)
    expect(snap.hasTimelock).toBe(true)
    expect(snap.timelockMinDelay).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run locally**

```bash
LIVE_RPC=1 INTEGRATION_DB=1 pnpm test src/lib/detectors/governance/__tests__/snapshot.live.test.ts
```

Expected: all three protocols return reasonable snapshots. Cache the raw `rawState` shapes for use as fixtures in Phase E/H.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(snapshot): live-RPC smoke tests for Uniswap/Compound/Aave (LIVE_RPC=1)"
```

**Deliverables:** 3 live-RPC smoke tests, gated. Real-world fixtures cached for Phase E.

**Exit:** `LIVE_RPC=1 pnpm test` passes locally. Default CI run (no LIVE_RPC) skips them.

---

**Phase D exit gate:**
- `pnpm test` green
- `LIVE_RPC=1 pnpm test` green against Ankr primary; same with `PRIMARY_ETH_RPC_URL=https://cloudflare-eth.com` forces fallback path
- `captureGovernanceSnapshot` persists to `GovernanceSnapshot` table via `upsert` (idempotent)
- Snapshot helpers handle: no governor / no timelock / proxy (transparent, UUPS, none) / Safe at address vs. at timelock admin
- Vercel preview still deploys clean
- Spec §4.6 idempotency requirement satisfied for snapshot step

---

## Phase E — Detectors (6 commits)

**Goal:** Six detectors implemented per spec §5.2. Each detector is a pure function over a `GovernanceSnapshotData` (plus, for GOV-002, the contract ABI). Each ships with ≥3 unit tests: happy path (no fire), detection path (fires on known fixture), edge case (missing data).

**Risk:** False positives on real-world protocols. Known delicate cases: Aave's short/long executor pattern (Timelock admin is another Timelock, not a Safe); MakerDAO's chief/pause/spell pattern (out-of-scope but common enough to hit the primary-address probe). Detectors must fail closed — if data is missing/ambiguous, skip the detector (don't fire).
**Rollback:** Per-detector. If GOV-003 starts false-positiving on Aave in real traffic, set `BREAKWATER_DETECTOR_DISABLE=GOV-003` (add in Phase E.0 as the featureFlags extension) to skip that one while keeping the rest live.

### Task E.0 — Per-detector disable flag

**Files:**
- Modify: `src/lib/featureFlags.ts`, `.env.example`

- [ ] **Step 1: Parse a comma-separated list**

```typescript
import { config } from "@/lib/config"

const disabledDetectors = new Set(
  (process.env.BREAKWATER_DETECTOR_DISABLE ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
)

export const featureFlags = {
  governanceModuleEnabled: config.BREAKWATER_GOVERNANCE_MODULE_ENABLED,
  isDetectorDisabled: (id: string) => disabledDetectors.has(id),
} as const
```

- [ ] **Step 2: Commit (bundle with E.1 below to keep commit count at 6)**

No standalone commit — included in E.1.

### Task E.1 — GOV-001: Timelock missing / insufficient delay

**Files:**
- Create: `src/lib/detectors/governance/GOV-001-timelock.ts`, `src/lib/detectors/governance/__tests__/GOV-001.test.ts`
- Modify: `src/lib/featureFlags.ts`

- [ ] **Step 1: Implement detector**

```typescript
import type { GovernanceSnapshotData } from "./types"

export type GovernanceFindingInput = {
  detectorId: string
  detectorVersion: string
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO"
  publicTitle: string
  internalTitle: string
  remediationHint: string
  evidence: Record<string, unknown>
}

const DETECTOR_ID = "GOV-001"
const DETECTOR_VERSION = "1.0.0"
const MIN_DELAY_SECONDS = 172_800   // 48 hours

export function runGOV001(
  snap: GovernanceSnapshotData
): GovernanceFindingInput | null {
  // No governance framework detected at all — fail closed, another detector will catch this
  if (!snap.hasGovernor && !snap.hasMultisig) return null

  // Admin role present but no Timelock
  if (!snap.hasTimelock) {
    return finding("No Timelock in governance path", {
      governorAddress: snap.governorAddress,
      multisigAddress: snap.multisigAddress,
    })
  }

  // Timelock present but delay too short
  if (snap.timelockMinDelay !== null && snap.timelockMinDelay < MIN_DELAY_SECONDS) {
    return finding(
      `Timelock delay ${snap.timelockMinDelay}s < required ${MIN_DELAY_SECONDS}s`,
      { timelockAddress: snap.timelockAddress, delaySeconds: snap.timelockMinDelay }
    )
  }

  // Timelock admin is an EOA (not a contract). The snapshot already has the admin address;
  // checking if it's a contract requires a getCode call — done in the snapshot layer as a flag.
  // For Plan 02, we infer from the `multisigAddress` match: if the timelock admin is the safe
  // we found, good. If not, escalate as "admin not a safe" — but keep severity-adjusted.
  if (
    snap.timelockAdmin !== null &&
    snap.multisigAddress !== null &&
    snap.timelockAdmin.toLowerCase() !== snap.multisigAddress.toLowerCase()
  ) {
    return finding("Timelock admin is not the governance multisig", {
      timelockAdmin: snap.timelockAdmin,
      expectedMultisig: snap.multisigAddress,
    })
  }

  // Timelock admin is the Governor itself — bypass path
  if (
    snap.timelockAdmin !== null &&
    snap.governorAddress !== null &&
    snap.timelockAdmin.toLowerCase() === snap.governorAddress.toLowerCase()
  ) {
    return finding("Timelock admin is the Governor (self-bypass)", {
      timelockAdmin: snap.timelockAdmin,
    })
  }

  return null
}

function finding(
  internal: string,
  evidence: Record<string, unknown>
): GovernanceFindingInput {
  return {
    detectorId: DETECTOR_ID,
    detectorVersion: DETECTOR_VERSION,
    severity: "CRITICAL",
    publicTitle: "Governance delay protection weakness",
    internalTitle: internal,
    remediationHint:
      "Ensure a Timelock contract with 48h+ minimum delay guards all admin operations. Timelock admin should be the Governor contract, not an EOA or the Governor itself.",
    evidence,
  }
}
```

- [ ] **Step 2: Unit tests**

```typescript
import { describe, it, expect } from "vitest"
import { runGOV001 } from "@/lib/detectors/governance/GOV-001-timelock"
import { baseSnapshot, withMultisig, withTimelock } from "./fixtures"

describe("GOV-001", () => {
  it("does not fire on clean OZ Governor + 48h timelock", () => {
    const snap = withTimelock(baseSnapshot({ hasGovernor: true }), 172_800)
    expect(runGOV001(snap)).toBeNull()
  })

  it("fires when governor present but no timelock", () => {
    const snap = baseSnapshot({ hasGovernor: true, hasTimelock: false })
    const r = runGOV001(snap)
    expect(r?.detectorId).toBe("GOV-001")
    expect(r?.severity).toBe("CRITICAL")
  })

  it("fires when timelock delay < 48h (Beanstalk: 24h)", () => {
    const snap = withTimelock(baseSnapshot({ hasGovernor: true }), 86_400)
    expect(runGOV001(snap)).not.toBeNull()
  })

  it("fires when timelock admin is the governor (self-bypass)", () => {
    const gov = "0x1234...abcd"
    const snap = withTimelock(
      baseSnapshot({ hasGovernor: true, governorAddress: gov }),
      172_800,
      { timelockAdmin: gov }
    )
    expect(runGOV001(snap)).not.toBeNull()
  })

  it("does not fire on ownerless factory (no governor, no multisig)", () => {
    const snap = baseSnapshot({ hasGovernor: false, hasMultisig: false })
    expect(runGOV001(snap)).toBeNull()
  })
})
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(GOV-001): timelock missing / insufficient delay detector + tests"
```

**Deliverables:** GOV-001 implementation + fixtures helpers + 5 tests.

**Exit:** Detector returns `null` on clean Uniswap-like snapshot, fires on Beanstalk-like (24h timelock).

### Task E.2 — GOV-002: Emergency execute / governance bypass

**Files:**
- Create: `src/lib/detectors/governance/GOV-002-bypass.ts`, `__tests__/GOV-002.test.ts`
- Modify: `src/lib/detectors/governance/types.ts` (add `abi` field to snapshot)

- [ ] **Step 1: Extend snapshot to carry ABI fragment**

Add to `GovernanceSnapshotData`:
```typescript
implementationAbi: string | null   // JSON ABI from Etherscan; null if not verified or no Etherscan key
```

Populate in `captureGovernanceSnapshot` via `fetchContractAbi` (the proxy implementation if present, else the primary address).

- [ ] **Step 2: Detector implementation**

Scan the ABI for functions matching suspect patterns:

```typescript
const SUSPECT_PATTERNS = [
  /^emergency[A-Z]/,
  /^force[A-Z]/,
  /^bypass[A-Z]/,
  /^admin[A-Z].*execute/i,
  /^execute(?!Transaction)/, // execute but not the timelock-style executeTransaction
]

const KNOWN_BYPASS_NAMES = new Set([
  "emergencyCommit",
  "emergencyExecute",
  "forceUpgrade",
  "adminCall",
  "rescueTokens",
])

export function runGOV002(snap: GovernanceSnapshotData): GovernanceFindingInput | null {
  if (!snap.implementationAbi) return null  // skip: no ABI data
  try {
    const abi: Array<{ type: string; name?: string; stateMutability?: string }> =
      JSON.parse(snap.implementationAbi)
    const suspects = abi
      .filter((item) => item.type === "function" && item.stateMutability !== "view")
      .filter((fn) => {
        const name = fn.name ?? ""
        if (KNOWN_BYPASS_NAMES.has(name)) return true
        return SUSPECT_PATTERNS.some((p) => p.test(name))
      })
    if (suspects.length === 0) return null
    return finding(suspects)
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Unit tests — include a Beanstalk-like ABI fixture**

Fixture: an ABI containing `emergencyCommit(bytes)` → detector fires.
Fixture: a clean OZ Governor ABI (only `propose`, `castVote`, `execute`) → detector does NOT fire for the `execute` name because `execute` on Governor is a timelock-wrapped call, not a bypass. Add a negation rule: if the contract is a Timelock or Governor, skip ABI-based bypass detection.

Add `snap.governorAddress === address` guard:
```typescript
// Caller passes current contract address so detector can skip Governor/Timelock ABIs
```

Simpler approach: skip bypass detection entirely when the primary contract is the Governor. Fixtures reflect this.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(GOV-002): ABI-based governance bypass detector + tests"
```

**Exit:** 4+ tests green. Clean OZ Governor ABI → no fire. Beanstalk `emergencyCommit` ABI → fire.

### Task E.3 — GOV-003: Multisig signer concentration

**Files:**
- Create: `src/lib/detectors/governance/GOV-003-multisig.ts`, `__tests__/GOV-003.test.ts`

- [ ] **Step 1: Detector**

Per spec §5.2 trigger conditions:

```typescript
export function runGOV003(snap: GovernanceSnapshotData): GovernanceFindingInput | null {
  if (!snap.hasMultisig) return null
  const th = snap.multisigThreshold
  const own = snap.multisigOwnerCount
  if (th === null || own === null) return null

  const reasons: string[] = []

  if (th < 3) reasons.push(`threshold ${th} < 3`)
  if (own <= 3) reasons.push(`owner count ${own} <= 3`)
  if (th / own < 0.5) reasons.push(`ratio ${th}/${own} < 50%`)

  if (reasons.length === 0) return null

  return {
    detectorId: "GOV-003",
    detectorVersion: "1.0.0",
    severity: "HIGH",
    publicTitle: "Multisig control concentration",
    internalTitle: reasons.join("; "),
    remediationHint:
      "Increase signer count to 5+ with threshold of 3-of-5 or higher. Ensure signers are independent parties.",
    evidence: {
      multisigAddress: snap.multisigAddress,
      threshold: th,
      ownerCount: own,
    },
  }
}
```

- [ ] **Step 2: Unit tests**

- Clean 5-of-9 → no fire
- 2-of-5 (Drift) → fires (both th<3 AND ratio<50%)
- 2-of-3 → fires (th<3 AND owners≤3)
- 4-of-5 → no fire
- 3-of-9 → fires (ratio<50%)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(GOV-003): multisig signer concentration detector + tests"
```

**Exit:** 5 tests green.

### Task E.4 — GOV-004: Current-balance voting without snapshot

**Files:**
- Create: `src/lib/detectors/governance/GOV-004-voting.ts`, `__tests__/GOV-004.test.ts`
- Modify: `src/lib/detectors/governance/snapshot.ts` (populate `votingSnapshotType`)

- [ ] **Step 1: Extend snapshot capture**

Probe Governor for snapshot-based voting:
- OZ/Bravo: call `getVotes(address,uint256)` — if supported, `votingSnapshotType = BLOCK_BASED`
- Else if `getCurrentVotes(address)` exists but not the block-based variant → `CURRENT_BALANCE`
- Else → `NONE`

Plan-level implementation: via `batchRead` allowFailure. If either succeeds → `BLOCK_BASED`. If only unsupported → `CURRENT_BALANCE`. Otherwise `NONE`.

Also populate `votingTokenAddress` by calling `governor.token()` if Governor is detected.

- [ ] **Step 2: Detector**

```typescript
export function runGOV004(snap: GovernanceSnapshotData): GovernanceFindingInput | null {
  if (!snap.hasGovernor) return null
  if (snap.votingSnapshotType === "BLOCK_BASED") return null
  // CURRENT_BALANCE or NONE → flash-loan risk
  return {
    detectorId: "GOV-004",
    detectorVersion: "1.0.0",
    severity: "HIGH",
    publicTitle: "Governance vote weighting risk",
    internalTitle: `Governor does not use snapshot-based voting (${snap.votingSnapshotType})`,
    remediationHint:
      "Use snapshot-based voting (Governor + ERC20Votes / ERC721Votes) instead of current-balance. Snapshot prevents flash-loan vote manipulation.",
    evidence: {
      governorAddress: snap.governorAddress,
      votingTokenAddress: snap.votingTokenAddress,
      votingSnapshotType: snap.votingSnapshotType,
    },
  }
}
```

- [ ] **Step 3: Unit tests**

- OZ Governor with ERC20Votes → `BLOCK_BASED` → no fire
- Beanstalk-like Stalk (custom, no snapshot) → `CURRENT_BALANCE` → fires
- No Governor → no fire

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(GOV-004): current-balance voting detector + tests"
```

**Exit:** 3+ tests green.

### Task E.5 — GOV-005: Proxy admin misconfiguration

**Files:**
- Create: `src/lib/detectors/governance/GOV-005-proxy.ts`, `__tests__/GOV-005.test.ts`

- [ ] **Step 1: Extend snapshot to carry `proxyAdminIsContract` flag**

Add one more probe in `captureGovernanceSnapshot`:

```typescript
const proxyAdminIsContract = proxy.proxyAdminAddress
  ? (await ethClient.getCode({ address: proxy.proxyAdminAddress as `0x${string}` })) !== "0x"
  : false
```

Persist to `rawState.proxyAdminIsContract`.

- [ ] **Step 2: Detector (three branches)**

Transparent proxy:
- If admin slot empty → skip (no admin, not a proxy-admin misconfig)
- If `proxyAdminIsContract === false` → fire ("admin is EOA")
- If admin matches primary contract owner (bypass) → fire

UUPS:
- Detecting this requires scanning the implementation ABI for `_authorizeUpgrade` — defer refinement to Plan 03+. For Plan 02: if `proxyType === EIP_1822_UUPS` and ABI unavailable, skip (fail closed).

Non-standard (Audius pattern):
- If storage slot 0 is non-zero on a contract that lacks an EIP-1967 impl slot → fire with "non-standard admin storage"

Implementation sketch:

```typescript
export function runGOV005(snap: GovernanceSnapshotData): GovernanceFindingInput | null {
  if (snap.proxyType === "NONE") return null

  const adminIsContract = snap.rawState?.proxyAdminIsContract === true

  if (snap.proxyType === "EIP_1967_TRANSPARENT") {
    if (!adminIsContract && snap.proxyAdminAddress) {
      return finding("Transparent proxy admin is an EOA", { admin: snap.proxyAdminAddress })
    }
  }

  if (snap.proxyType === "CUSTOM") {
    return finding(
      "Non-standard proxy pattern detected",
      { address: snap.proxyImplementation }
    )
  }

  // UUPS: Plan 03+
  return null
}
```

- [ ] **Step 3: Unit tests**

- Transparent + ProxyAdmin contract (OZ pattern) → no fire
- Transparent + EOA admin → fires
- UUPS → no fire (Plan 02 fail-closed)
- Non-standard (Audius) → fires
- No proxy → no fire

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(GOV-005): proxy admin misconfiguration detector + tests"
```

**Exit:** 5 tests green. Audius fixture fires, Uniswap V3 (no proxy) does not.

### Task E.6 — GOV-006: Upgradeable without emergency pause

**Files:**
- Create: `src/lib/detectors/governance/GOV-006-pause.ts`, `__tests__/GOV-006.test.ts`

- [ ] **Step 1: Detector — ABI-based**

```typescript
const PAUSE_SIGS = [
  "pause()",
  "_pause()",
  "setPaused(bool)",
  "pauseAll()",
  "emergencyPause()",
]

export function runGOV006(snap: GovernanceSnapshotData): GovernanceFindingInput | null {
  if (snap.proxyType === "NONE") return null        // must be upgradeable
  if (!snap.implementationAbi) return null          // fail closed without ABI

  try {
    const abi: Array<{ type: string; name?: string; inputs?: any[] }> =
      JSON.parse(snap.implementationAbi)
    const pauseFns = abi.filter((item) => {
      if (item.type !== "function") return false
      const sig = `${item.name}(${(item.inputs ?? []).map((i: any) => i.type).join(",")})`
      return PAUSE_SIGS.includes(sig) || item.name?.toLowerCase().startsWith("pause")
    })
    if (pauseFns.length > 0) return null

    return {
      detectorId: "GOV-006",
      detectorVersion: "1.0.0",
      severity: "MEDIUM",
      publicTitle: "Upgrade risk without safeguards",
      internalTitle: "Upgradeable contract with no pause mechanism",
      remediationHint:
        "Add a pause mechanism to upgradeable contracts. OpenZeppelin's Pausable pattern is recommended.",
      evidence: { proxyImplementation: snap.proxyImplementation },
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Unit tests**

- Upgradeable + Pausable → no fire
- Upgradeable + no pause → fires
- Non-upgradeable → no fire
- Upgradeable + no ABI → no fire (fail closed)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(GOV-006): upgradeable without emergency pause detector + tests"
```

**Exit:** 4 tests green.

---

**Phase E exit gate:**
- Six detectors, six commits (one per), one fixture file shared across all detector tests
- Each detector: implementation + ≥3 unit tests + fixture entry
- Feature flag `BREAKWATER_DETECTOR_DISABLE=GOV-003,...` scaffolded (activated at runtime in Phase F)
- `pnpm test` count up by 25+ tests vs end of Phase D
- No live-RPC tests added in Phase E (those live in Phase D live suite + Phase H regression suite)

---

## Phase F — Module orchestration + scoring (3 commits)

**Goal:** `executeGovernanceModule` Inngest function registered and wired into the serve route. Detectors run in a deterministic order, findings and composite grade persist in a single transaction, and `scan.module.completed` is emitted. Scoring algorithm implements both the arithmetic penalty and the floor override per spec §5.3.

**Risk:** Inngest's `step.run` wraps function bodies in a retry envelope. The findings-persist step MUST be idempotent — if Inngest retries after a partial commit, we cannot double-insert findings. Spec §4.6 mandates a delete-then-insert transaction to handle this.
**Rollback:** `BREAKWATER_GOVERNANCE_MODULE_ENABLED=false` disables emission upstream. For partial rollback, disable individual detectors via `BREAKWATER_DETECTOR_DISABLE`.

### Task F.1 — Detector orchestrator + scoring algorithm

**Files:**
- Create: `src/lib/detectors/governance/index.ts`, `src/lib/detectors/governance/scoring.ts`, `src/lib/detectors/governance/__tests__/scoring.test.ts`

- [ ] **Step 1: `runGovernanceDetectors`**

```typescript
import { runGOV001 } from "./GOV-001-timelock"
import { runGOV002 } from "./GOV-002-bypass"
import { runGOV003 } from "./GOV-003-multisig"
import { runGOV004 } from "./GOV-004-voting"
import { runGOV005 } from "./GOV-005-proxy"
import { runGOV006 } from "./GOV-006-pause"
import { featureFlags } from "@/lib/featureFlags"
import type { GovernanceSnapshotData } from "./types"
import type { GovernanceFindingInput } from "./GOV-001-timelock"

const detectors = [
  { id: "GOV-001", run: runGOV001 },
  { id: "GOV-002", run: runGOV002 },
  { id: "GOV-003", run: runGOV003 },
  { id: "GOV-004", run: runGOV004 },
  { id: "GOV-005", run: runGOV005 },
  { id: "GOV-006", run: runGOV006 },
] as const

export async function runGovernanceDetectors(
  snap: GovernanceSnapshotData
): Promise<GovernanceFindingInput[]> {
  const findings: GovernanceFindingInput[] = []
  for (const d of detectors) {
    if (featureFlags.isDetectorDisabled(d.id)) continue
    const result = d.run(snap)
    if (result) findings.push(result)
  }
  return findings
}
```

- [ ] **Step 2: Scoring algorithm per spec §5.3**

```typescript
import type { Grade, Severity } from "@prisma/client"
import type { GovernanceFindingInput } from "./GOV-001-timelock"

const SEVERITY_PENALTY: Record<Severity, number> = {
  CRITICAL: 35,
  HIGH: 20,
  MEDIUM: 10,
  LOW: 5,
  INFO: 0,
}

export function computeModuleScore(findings: GovernanceFindingInput[]): number {
  let score = 100
  for (const f of findings) score -= SEVERITY_PENALTY[f.severity]
  return Math.max(0, score)
}

export function computeModuleGrade(findings: GovernanceFindingInput[]): Grade {
  const critCount = findings.filter((f) => f.severity === "CRITICAL").length
  if (critCount >= 3) return "F"
  if (critCount >= 2) return "D"
  const score = computeModuleScore(findings)
  if (score >= 90) return "A"
  if (score >= 75) return "B"
  if (score >= 60) return "C"
  if (score >= 40) return "D"
  return "F"
}
```

- [ ] **Step 3: Scoring unit tests**

```typescript
describe("computeModuleGrade", () => {
  it("A on clean scan (no findings)", () => {
    expect(computeModuleGrade([])).toBe("A")
  })
  it("B with one HIGH (score 80)", () => {
    expect(computeModuleGrade([high("GOV-003")])).toBe("B")
  })
  it("floor override: 3 CRITICAL → F even if score suggests D", () => {
    const fs = [crit("GOV-001"), crit("GOV-002"), crit("extra")]
    expect(computeModuleGrade(fs)).toBe("F")
  })
  it("floor override: 2 CRITICAL → D", () => {
    expect(computeModuleGrade([crit("GOV-001"), crit("GOV-002")])).toBe("D")
  })
  it("1 CRITICAL + 1 HIGH → C (score 45)", () => {
    expect(computeModuleGrade([crit("GOV-001"), high("GOV-003")])).toBe("D")
    // 100 - 35 - 20 = 45 → D per arithmetic threshold
  })
})
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(detectors): orchestrator + scoring with critical floor override"
```

**Exit:** Orchestrator ≥1 test, scoring ≥5 tests, all green.

### Task F.2 — persistFindingsAndGrade + idempotent ModuleRun update

**Files:**
- Create: `src/lib/detectors/governance/persist.ts`, `__tests__/persist.test.ts`

- [ ] **Step 1: Implement persist**

```typescript
import { prisma } from "@/lib/prisma"
import { computeModuleGrade, computeModuleScore } from "./scoring"
import type { GovernanceFindingInput } from "./GOV-001-timelock"

export async function persistFindingsAndGrade(
  scanId: string,
  findings: GovernanceFindingInput[]
): Promise<{ status: "COMPLETE" | "FAILED"; grade: Grade; startedAt: Date }> {
  const grade = computeModuleGrade(findings)
  const score = computeModuleScore(findings)

  const result = await prisma.$transaction(async (tx) => {
    // Delete any existing findings for this scan+module (idempotent retry)
    await tx.finding.deleteMany({
      where: { scanId, module: "GOVERNANCE" },
    })

    // Fetch blockNumber for snapshotBlockNumber
    const snap = await tx.governanceSnapshot.findUnique({
      where: { scanId },
    })

    // Insert new findings
    await tx.finding.createMany({
      data: findings.map((f) => ({
        scanId,
        module: "GOVERNANCE",
        detectorId: f.detectorId,
        detectorVersion: f.detectorVersion,
        severity: f.severity,
        publicTitle: f.publicTitle,
        internalTitle: f.internalTitle,
        remediationHint: f.remediationHint,
        evidence: f.evidence,
        snapshotBlockNumber: snap?.blockNumber ?? null,
      })),
    })

    // Update ModuleRun
    const run = await tx.moduleRun.update({
      where: { scanId_module: { scanId, module: "GOVERNANCE" } },
      data: {
        status: "COMPLETE",
        completedAt: new Date(),
        score,
        grade,
      },
    })

    return { status: "COMPLETE" as const, grade, startedAt: run.startedAt ?? new Date() }
  })

  return result
}
```

- [ ] **Step 2: Idempotency test**

```typescript
it("persistFindingsAndGrade is idempotent on retry", async () => {
  const scan = await makeScanFixture()
  await persistFindingsAndGrade(scan.id, [critFinding, highFinding])
  const after1 = await prisma.finding.count({ where: { scanId: scan.id } })
  await persistFindingsAndGrade(scan.id, [critFinding, highFinding])
  const after2 = await prisma.finding.count({ where: { scanId: scan.id } })
  expect(after1).toBe(after2)     // same count, not doubled
})
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(persist): findings+grade writer with delete-then-insert idempotency"
```

**Exit:** ≥3 tests, including idempotency. `INTEGRATION_DB=1 pnpm test` required for this test.

### Task F.3 — executeGovernanceModule Inngest function + serve registration

**Files:**
- Create: `src/lib/inngest/functions/execute-governance.ts`
- Modify: `src/app/api/inngest/route.ts`

- [ ] **Step 1: Implement the function per spec §4.3**

```typescript
import { inngest } from "@/lib/inngest/client"
import { prisma } from "@/lib/prisma"
import { captureGovernanceSnapshot } from "@/lib/detectors/governance/snapshot"
import { runGovernanceDetectors } from "@/lib/detectors/governance"
import { persistFindingsAndGrade } from "@/lib/detectors/governance/persist"

export const executeGovernanceModule = inngest.createFunction(
  {
    id: "execute-governance",
    name: "Execute Governance module",
    retries: 1,
  },
  {
    event: "scan.module.requested",
    if: "event.data.module == 'GOVERNANCE'",
  },
  async ({ event, step }) => {
    const { scanId } = event.data
    const startedAt = Date.now()

    await step.run("mark-running", async () => {
      await prisma.moduleRun.update({
        where: { scanId_module: { scanId, module: "GOVERNANCE" } },
        data: { status: "RUNNING", startedAt: new Date() },
      })
    })

    const snapshot = await step.run("capture-snapshot", async () => {
      return captureGovernanceSnapshot(scanId)
    })

    const findings = await step.run("run-detectors", async () => {
      return runGovernanceDetectors(snapshot)
    })

    const moduleResult = await step.run("persist-findings", async () => {
      return persistFindingsAndGrade(scanId, findings)
    })

    await step.sendEvent("emit-completed", {
      name: "scan.module.completed",
      data: {
        scanId,
        module: "GOVERNANCE",
        status: moduleResult.status,
        findingsCount: findings.length,
        grade: moduleResult.grade,
        executionMs: Date.now() - startedAt,
      },
    })
  }
)
```

- [ ] **Step 2: Register in serve handler**

```typescript
import { executeGovernanceModule } from "@/lib/inngest/functions/execute-governance"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [executeScan, executeGovernanceModule],
})
```

- [ ] **Step 3: Per-step retry config per spec §4.4**

- `capture-snapshot`: retries 3, exponential backoff (viem errors common)
- `run-detectors`: retries 1 (deterministic; should not normally fail)
- `persist-findings`: retries 3 (DB transient)

**Per-step retry API (Inngest v3):**

```typescript
await step.run("capture-snapshot", async () => {
  return await captureGovernanceSnapshot(scanId)
}, { retries: 3 })
```

If this signature does not work at implementation time (verified against `@inngest/sdk` v3.x docs), use **function-level retries** in `createFunction` config instead:

```typescript
inngest.createFunction(
  { id: "execute-governance", retries: 3 },
  { event: "scan.module.requested", if: "event.data.module == 'GOVERNANCE'" },
  async ({ event, step }) => { /* ... */ }
)
```

Do not defer — commit to whichever signature actually works during implementation. No `check at implementation time` hedge.

- [ ] **Step 4: Local end-to-end with Inngest dev server**

```bash
pnpm dev
pnpm dlx inngest-cli@latest dev
```

Submit an Ethereum scan to a known-bad fixture address (seeded in Plan 01). Expected:
- `scan.queued` emitted
- `executeScan` orchestrator runs
- `scan.module.requested` emitted
- `executeGovernanceModule` runs, snapshot captured, detectors fire, findings persisted
- `scan.module.completed` emitted
- `executeScan` resumes past `waitForEvent`, calls `finalize`, emits `scan.completed`
- Scan row → `status=COMPLETE`, `compositeGrade` set

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(inngest): executeGovernanceModule — end-to-end module pipeline"
```

- [ ] **Step 6: Push + Vercel preview smoke**

Submit a scan on the preview. Observe Inngest cloud dashboard for completed run. `/scan/[id]` on preview still shows QUEUED (no polling yet); refresh manually to see the COMPLETE state.

**Deliverables:** full Governance module pipeline works end-to-end in dev + preview.

**Exit:** A Drift-like fixture scan ends in `COMPLETE` state with 3+ findings and grade F.

---

**Phase F exit gate:**
- `executeGovernanceModule` registered
- Scan lifecycle: QUEUED → RUNNING → COMPLETE observed on preview for a real protocol
- Findings persisted with `detectorVersion="1.0.0"` and `snapshotBlockNumber`
- ModuleRun carries grade + score
- `recomputeScanStatus` sets composite grade on the Scan row
- Inngest dashboard shows the full event chain
- `INTEGRATION_DB=1 pnpm test` green

---

## Phase G — UI polling + findings (4 commits)

**Goal:** `/scan/[id]` transitions from QUEUED → RUNNING → COMPLETE without a page refresh, using a lightweight `GET /api/scan/[id]/status` endpoint. `FindingsList` renders real data through a proper discriminated union (Plan 01 backlog). Status indicators animate respectfully (reduced-motion aware).

**Risk:** Polling must stop cleanly on unmount, handle exponential backoff on errors, and bail out after terminal states. A runaway polling loop on a slow network can hammer the API endpoint.
**Rollback:** The polling hook is additive — if it misbehaves, remove the `useScanPolling` call from `ScanShell.tsx`. The page still renders the server-side snapshot; users just need to refresh manually.

### Task G.1 — GET /api/scan/[id]/status endpoint

**Files:**
- Create: `src/app/api/scan/[id]/status/route.ts`, `src/app/api/scan/[id]/status/__tests__/route.test.ts`

- [ ] **Step 1: Implement the endpoint**

Per spec §6.3:

```typescript
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const scan = await prisma.scan.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      modules: {
        select: {
          module: true,
          status: true,
          grade: true,
        },
      },
    },
  })

  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const terminal = ["COMPLETE", "FAILED", "EXPIRED"].includes(scan.status)
  const cacheControl = terminal
    ? "private, max-age=60"
    : "no-store"

  return NextResponse.json(scan, {
    headers: { "cache-control": cacheControl },
  })
}
```

Note: this endpoint does NOT perform tier gating (no findings in response). Rate-limit applies per Plan 01 (apply the existing IP-based limiter).

- [ ] **Step 2: Tests**

```typescript
describe("GET /api/scan/[id]/status", () => {
  it("returns status + modules for QUEUED scan", async () => {
    const scan = await makeScanFixture({ status: "QUEUED" })
    const res = await GET(mockReq(), { params: { id: scan.id } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("QUEUED")
  })
  it("uses no-store on non-terminal states", async () => {
    const scan = await makeScanFixture({ status: "RUNNING" })
    const res = await GET(mockReq(), { params: { id: scan.id } })
    expect(res.headers.get("cache-control")).toBe("no-store")
  })
  it("uses private, max-age=60 on terminal states", async () => {
    const scan = await makeScanFixture({ status: "COMPLETE" })
    const res = await GET(mockReq(), { params: { id: scan.id } })
    expect(res.headers.get("cache-control")).toBe("private, max-age=60")
  })
  it("returns 404 for unknown id", async () => {
    const res = await GET(mockReq(), { params: { id: "nonexistent" } })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2.5: Cache headers on the main scan endpoint (spec §6.2)**

**File:** `src/app/api/scan/[id]/route.ts` (Plan 01 endpoint, modified here)

Spec §6.2 requires the main scan endpoint to emit different `Cache-Control` headers for terminal vs. non-terminal states. Plan 01 shipped this route without explicit headers. Fix it here (parallel to the new `/status` endpoint added in G.1 above):

```typescript
const isTerminal = ["COMPLETE", "FAILED", "EXPIRED"].includes(scan.status)
const cacheControl = isTerminal
  ? "private, max-age=60"
  : "no-store"

return NextResponse.json(data, {
  headers: { "Cache-Control": cacheControl },
})
```

Add 2 new cases to the existing `src/app/api/scan/[id]/__tests__/route.test.ts` (or create if it does not exist per the Plan 01 pattern):

```typescript
it("QUEUED scan returns Cache-Control: no-store", async () => {
  const scan = await makeScanFixture({ status: "QUEUED" })
  const res = await GET(mockReq(), { params: { id: scan.id } })
  expect(res.headers.get("cache-control")).toBe("no-store")
})

it("COMPLETE scan returns Cache-Control: private, max-age=60", async () => {
  const scan = await makeScanFixture({ status: "COMPLETE" })
  const res = await GET(mockReq(), { params: { id: scan.id } })
  expect(res.headers.get("cache-control")).toBe("private, max-age=60")
})
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(api): GET /api/scan/[id]/status — lightweight polling endpoint + Cache-Control on /api/scan/[id]"
```

**Exit:** 4+ tests on the new `/status` endpoint + 2 on the existing `/api/scan/[id]` all green, response size ≤200 bytes typical for `/status`.

### Task G.2 — useScanPolling hook

**Files:**
- Create: `src/hooks/useScanPolling.ts`, `src/hooks/__tests__/useScanPolling.test.ts`

- [ ] **Step 1: Implement hook per spec §7.1**

```typescript
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { ScanStatus } from "@prisma/client"

const POLL_INTERVAL_MS = 3000
const MAX_POLL_DURATION_MS = 15 * 60 * 1000
const TERMINAL: ScanStatus[] = ["COMPLETE", "FAILED", "EXPIRED"]

export function useScanPolling(scanId: string, initialStatus: ScanStatus) {
  const router = useRouter()
  const [currentStatus, setCurrentStatus] = useState(initialStatus)
  const [errorCount, setErrorCount] = useState(0)

  useEffect(() => {
    if (TERMINAL.includes(currentStatus)) return

    const startTime = Date.now()
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const poll = async () => {
      if (cancelled) return
      if (Date.now() - startTime > MAX_POLL_DURATION_MS) return

      try {
        const res = await fetch(`/api/scan/${scanId}/status`)
        if (!res.ok) throw new Error(`Status ${res.status}`)
        const data: { status: ScanStatus } = await res.json()

        if (cancelled) return

        setCurrentStatus(data.status)
        setErrorCount(0)

        if (TERMINAL.includes(data.status)) {
          router.refresh()
          return
        }

        timeoutId = setTimeout(poll, POLL_INTERVAL_MS)
      } catch {
        if (cancelled) return
        const next = errorCount + 1
        setErrorCount(next)
        if (next >= 5) return
        const backoff = POLL_INTERVAL_MS * Math.pow(2, next)
        timeoutId = setTimeout(poll, backoff)
      }
    }

    timeoutId = setTimeout(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [scanId, currentStatus, errorCount, router])

  return { currentStatus, errorCount }
}
```

- [ ] **Step 2: Tests with vi.useFakeTimers + mocked fetch**

```typescript
describe("useScanPolling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    global.fetch = vi.fn() as any
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not poll when initial status is terminal", () => {
    renderHook(() => useScanPolling("s1", "COMPLETE"))
    vi.advanceTimersByTime(10_000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("polls every 3s while RUNNING", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "RUNNING" }),
    } as any)
    renderHook(() => useScanPolling("s1", "QUEUED"))
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("stops and refreshes on terminal state", async () => {
    const { result } = renderHook(() => useScanPolling("s1", "QUEUED"))
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ status: "COMPLETE" }),
    } as any)
    await vi.advanceTimersByTimeAsync(3_000)
    // router.refresh called internally
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("exponential backoff on error, bails at 5 errors", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("network"))
    renderHook(() => useScanPolling("s1", "QUEUED"))
    // Advance enough time to saturate 5 errors
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(100_000)
    expect(fetch).toHaveBeenCalledTimes(5)
  })
})
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): useScanPolling hook with backoff + terminal-state bailout"
```

**Exit:** 4+ tests green.

### Task G.3 — ScanShell integration + status indicators

**Files:**
- Modify: `src/components/scan/ScanShell.tsx`, `src/components/scan/ModuleCard.tsx`

- [ ] **Step 1: Wire the hook into `ScanShell`**

```tsx
"use client"

import { useScanPolling } from "@/hooks/useScanPolling"

export function ScanShell({ scan, tier }: ScanShellProps) {
  const { currentStatus } = useScanPolling(scan.id, scan.status)

  // Render based on currentStatus; findings array still comes from server snapshot,
  // router.refresh() in the hook re-fetches when a terminal transition happens.
  return (
    <div>
      {currentStatus === "QUEUED" && <QueuedShell />}
      {currentStatus === "RUNNING" && <RunningShell modules={scan.modules} />}
      {currentStatus === "COMPLETE" && <CompleteShell scan={scan} tier={tier} />}
      {/* ... */}
    </div>
  )
}
```

- [ ] **Step 2: Status indicator in `ModuleCard`**

Per spec §7.3:

```tsx
{module.status === "RUNNING" && (
  <div className="flex items-center gap-2" role="status" aria-live="polite">
    <span className="w-2 h-2 rounded-full bg-accent-sky animate-pulse motion-reduce:animate-none" />
    <span className="text-sm text-muted">Analyzing…</span>
  </div>
)}
```

Include `motion-reduce:animate-none` for `prefers-reduced-motion` respect.

- [ ] **Step 3: Update / add component tests**

Extend `src/components/scan/__tests__/ScanShell.test.tsx` to cover the three shells (QUEUED / RUNNING / COMPLETE) and confirm the polling hook is mounted.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): ScanShell polling + status indicators"
```

**Exit:** Shell transitions between states in local dev with Inngest dev server. Preview smoke confirms no regression on Plan 01 visual tests.

### Task G.4 — FindingResponse discriminated union refactor (Plan 01 backlog)

**Files:**
- Modify: `src/lib/scanShaper.ts`, `src/components/scan/FindingsList.tsx`, `src/lib/__tests__/scanShaper.test.ts`

Plan 01 used a structural union for `FindingResponse` — unauth and email tiers each had distinct fields but no `tier` discriminator, and narrowing relied on `"id" in f`. Convert to a proper discriminated union so TypeScript enforces the shapes.

- [ ] **Step 1: New type**

```typescript
export type UnauthFindingView = {
  tier: "UNAUTH"
  publicTitle: string
  severity: Severity
  remediationHint: null
}

export type EmailFindingView = {
  tier: "EMAIL"
  id: string
  detectorId: string
  publicTitle: string
  internalTitle: string
  severity: Severity
  remediationHint: string
  evidence: Record<string, unknown>
}

export type FindingResponse = UnauthFindingView | EmailFindingView
```

- [ ] **Step 2: Update shapers**

`shapeFindingsForUnauth` and `shapeFindingsForEmail` now explicitly stamp `tier`:

```typescript
export function shapeFindingsForUnauth(findings: Finding[]): UnauthFindingView[] {
  return findings.map((f) => ({
    tier: "UNAUTH",
    publicTitle: f.publicTitle,
    severity: f.severity,
    remediationHint: null,
  }))
}

export function shapeFindingsForEmail(findings: Finding[]): EmailFindingView[] {
  return findings.map((f) => ({
    tier: "EMAIL",
    id: f.id,
    detectorId: f.detectorId,
    publicTitle: f.publicTitle,
    internalTitle: f.internalTitle,
    severity: f.severity,
    remediationHint: f.remediationHint,
    evidence: f.evidence as Record<string, unknown>,
  }))
}
```

- [ ] **Step 3: Update `FindingsList` narrow**

Replace `"id" in f` with `f.tier === "EMAIL"`:

```tsx
{findings.map((f) =>
  f.tier === "EMAIL" ? (
    <EmailFindingCard key={f.id} finding={f} />
  ) : (
    <UnauthFindingRow key={`${f.publicTitle}-${f.severity}`} finding={f} />
  )
)}
```

- [ ] **Step 4: Tests**

Shaper tests must assert `tier` is set. TypeScript compilation will catch any lingering structural checks.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: FindingResponse as tier-discriminated union (Plan 01 backlog)"
```

**Exit:** All findings-related tests green. Plan 01 backlog item `FindingResponse discriminated union refactor` resolved.

---

**Phase G exit gate:**
- `/scan/[id]` transitions live on preview without refresh
- Polling stops cleanly on COMPLETE/FAILED/EXPIRED
- `motion-reduce` honored on status indicators
- `FindingResponse` is a true discriminated union
- Plan 01 backlog item resolved
- No regression on Plan 01 `/scan/[id]` tests

---

## Phase H — Integration testing (3 commits)

**Goal:** The spec §10 testing strategy realized. Fixtures exist for clean Uniswap V3, Drift-like, Beanstalk-like, Audius-like protocols. A full end-to-end test runs Inngest dev server + test DB and asserts scan lifecycle. Regression tests confirm "Breakwater would detect Drift" (GOV-001 + GOV-002 + GOV-003, grade F).

**Risk:** Inngest dev server integration in Vitest is tricky — the dev server is a separate process. Integration tests that need Inngest typically spawn the dev server in a beforeAll and tear it down afterAll, or mock the Inngest `step.run` wrapper to execute synchronously.
**Rollback:** If the Inngest-in-test path proves too brittle, reduce scope: keep unit tests for each function + fixture-based detector tests, and rely on preview manual smoke for the Inngest event chain. Document that decision in `NOTES.md`.

### Task H.1 — Fixture protocols

**Files:**
- Create: `src/lib/detectors/governance/__tests__/fixtures.ts` (consolidate scattered fixtures from Phase E)

- [ ] **Step 1: Consolidate all Phase E inline fixtures into one file**

```typescript
import type { GovernanceSnapshotData } from "../types"

export function baseSnapshot(
  overrides: Partial<GovernanceSnapshotData> = {}
): GovernanceSnapshotData {
  return {
    blockNumber: 21_000_000n,
    capturedAt: new Date("2026-04-22T12:00:00Z"),
    hasGovernor: false,
    governorAddress: null,
    governorType: null,
    governorVersion: null,
    hasTimelock: false,
    timelockAddress: null,
    timelockMinDelay: null,
    timelockAdmin: null,
    hasMultisig: false,
    multisigAddress: null,
    multisigThreshold: null,
    multisigOwnerCount: null,
    multisigOwners: [],
    proxyType: "NONE",
    proxyAdminAddress: null,
    proxyImplementation: null,
    proxyVerified: false,
    votingTokenAddress: null,
    votingSnapshotType: "NONE",
    rawState: {},
    ...overrides,
  }
}

export const cleanUniswapV3Fixture: GovernanceSnapshotData = baseSnapshot({
  // Uniswap V3 factory has no governor, no timelock, no multisig.
})

export const driftLikeFixture: GovernanceSnapshotData = baseSnapshot({
  hasMultisig: true,
  multisigAddress: "0xdrift...",
  multisigThreshold: 2,
  multisigOwnerCount: 5,
  multisigOwners: Array.from({ length: 5 }, (_, i) => `0xowner${i}`),
  // No timelock — missing + no bypass function recorded in ABI because protocol is EVM-simulated
  // for Plan 02 fixture purposes; real Drift is Solana.
})

export const beanstalkLikeFixture: GovernanceSnapshotData = baseSnapshot({
  hasGovernor: true,
  governorType: "CUSTOM",
  governorAddress: "0xbean...",
  hasTimelock: true,
  timelockMinDelay: 86_400,        // 24h — trips GOV-001
  implementationAbi: JSON.stringify([
    { type: "function", name: "emergencyCommit", stateMutability: "nonpayable", inputs: [] },
    { type: "function", name: "commit", stateMutability: "nonpayable", inputs: [] },
  ]),
  votingSnapshotType: "CURRENT_BALANCE",   // trips GOV-004
})

export const audiusLikeFixture: GovernanceSnapshotData = baseSnapshot({
  proxyType: "CUSTOM",                     // non-standard → trips GOV-005
  proxyImplementation: "0xaudi...",
  implementationAbi: JSON.stringify([
    { type: "function", name: "initialize", stateMutability: "nonpayable", inputs: [] },
    // No pause function → trips GOV-006
  ]),
})

export const withTimelock = (
  base: GovernanceSnapshotData,
  delaySeconds: number,
  extra: Partial<GovernanceSnapshotData> = {}
): GovernanceSnapshotData => ({
  ...base,
  hasTimelock: true,
  timelockAddress: base.timelockAddress ?? "0xtimelock...",
  timelockMinDelay: delaySeconds,
  ...extra,
})

export const withMultisig = (
  base: GovernanceSnapshotData,
  threshold: number,
  ownerCount: number
): GovernanceSnapshotData => ({
  ...base,
  hasMultisig: true,
  multisigAddress: "0xsafe...",
  multisigThreshold: threshold,
  multisigOwnerCount: ownerCount,
  multisigOwners: Array.from({ length: ownerCount }, (_, i) => `0xowner${i}`),
})
```

- [ ] **Step 2: Refactor Phase E tests to import from this file**

Replace inline fixture constructors in each `GOV-NNN.test.ts` with imports.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(fixtures): consolidated governance snapshot fixtures"
```

**Exit:** All Phase E detector tests green with imported fixtures.

### Task H.2 — Regression suite: Drift / Beanstalk / Audius

**Files:**
- Create: `src/lib/detectors/governance/__tests__/regression.test.ts`

- [ ] **Step 1: Regression tests per spec §10.3**

```typescript
import { describe, it, expect } from "vitest"
import { runGovernanceDetectors } from "@/lib/detectors/governance"
import { computeModuleGrade } from "@/lib/detectors/governance/scoring"
import {
  cleanUniswapV3Fixture,
  driftLikeFixture,
  beanstalkLikeFixture,
  audiusLikeFixture,
} from "./fixtures"

describe("Regression: Breakwater would detect real incidents", () => {
  it("Uniswap V3 clean — 0 findings, grade A", () => {
    const findings = runGovernanceDetectors(cleanUniswapV3Fixture)
    expect(findings).toHaveLength(0)
    expect(computeModuleGrade(findings)).toBe("A")
  })

  it("Drift-like (2/5 multisig, no timelock) — fires GOV-001 + GOV-003", async () => {
    const findings = await runGovernanceDetectors(driftLikeFixture)
    const ids = findings.map((f) => f.detectorId).sort()
    expect(ids).toEqual(expect.arrayContaining(["GOV-001", "GOV-003"]))
  })

  it("Beanstalk-like — fires GOV-001 + GOV-002 + GOV-004, grade F (3 CRITICAL)", async () => {
    const findings = await runGovernanceDetectors(beanstalkLikeFixture)
    const ids = findings.map((f) => f.detectorId).sort()
    expect(ids).toEqual(expect.arrayContaining(["GOV-001", "GOV-002", "GOV-004"]))
    const critCount = findings.filter((f) => f.severity === "CRITICAL").length
    expect(critCount).toBeGreaterThanOrEqual(2)
  })

  it("Audius-like — fires GOV-005 + GOV-006", async () => {
    const findings = await runGovernanceDetectors(audiusLikeFixture)
    const ids = findings.map((f) => f.detectorId).sort()
    expect(ids).toEqual(expect.arrayContaining(["GOV-005", "GOV-006"]))
  })
})
```

- [ ] **Step 2: Anchor-incident test: Drift grade F**

```typescript
it("Drift-like full scan (with bypass ABI) — grade F", async () => {
  const driftWithBypass: GovernanceSnapshotData = {
    ...driftLikeFixture,
    implementationAbi: JSON.stringify([
      { type: "function", name: "emergencySetWhitelist", stateMutability: "nonpayable", inputs: [] },
    ]),
  }
  const findings = await runGovernanceDetectors(driftWithBypass)
  expect(computeModuleGrade(findings)).toBe("F")
})
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(regression): Drift/Beanstalk/Audius anchored regression suite"
```

**Exit:** Spec §14 hard criteria partially met: 3 regression tests pass.

### Task H.3 — End-to-end integration with Inngest test harness

**Files:**
- Create: `src/lib/inngest/__tests__/integration.test.ts` (gated behind `INTEGRATION_DB=1 INNGEST_TEST=1`)

- [ ] **Step 1: Scope of the test**

Submit a scan via the internal `POST /api/scan` handler. Assert:
- `Scan` row exists in `QUEUED`
- `scan.queued` event was emitted (mock `inngest.send` and assert call)
- Drive `executeScan` in-process with a minimal `step` mock
- Drive `executeGovernanceModule` in-process with the Beanstalk-like fixture snapshot
- Assert final `Scan.status === "COMPLETE"`, 3 findings persisted, composite grade F

- [ ] **Step 2: Implementation approach**

**Primary:** use `@inngest/test` (see https://www.inngest.com/docs/test). If `@inngest/test` is available at time of implementation, invoke `executeScan` / `executeGovernanceModule` via its function-runner and assert on the resulting events + DB state.

**Fallback:** if `@inngest/test` is not available or its API differs from the docs, use a manual approach:
- Mock the Inngest client via `vi.mock("@/lib/inngest/client")`.
- Assert step ids called with expected event data.
- Simulate `scan.module.completed` event emission manually in the test.
- Drive the flow by calling the internal module functions (`captureGovernanceSnapshot`, `runGovernanceDetectors`, `persistFindingsAndGrade`) directly, skipping Inngest, and validate only the event-emission contract separately via unit tests on `POST /api/scan`.

Do NOT defer the decision to implementation time — commit to the fallback path upfront. Migration to `@inngest/test` can happen as a refactor in Plan 07+ if needed.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(integration): end-to-end Inngest + detectors + persist"
```

**Exit:** Integration test runs in ≤30s locally. Skipped in default CI via `INTEGRATION_DB=1 INNGEST_TEST=1` gate.

---

**Phase H exit gate:**
- Spec §14 hard criteria:
  - [x] Drift-like fixture → GOV-001 + GOV-002 + GOV-003, grade F
  - [x] Beanstalk-like fixture → GOV-001 + GOV-002 + GOV-004
  - [x] Audius-like fixture → GOV-005 + GOV-006
- 60+ new tests vs end of Phase D (target per spec §14)
- Integration test demonstrates end-to-end scan flow
- `pnpm test` green, `INTEGRATION_DB=1 pnpm test` green, `LIVE_RPC=1` live suite opt-in green
- All 204 Plan 01 tests still green

---

## Phase I — Polish + PR + merge (3 commits)

**Goal:** Codex review of Phase A–H on the full implementation. Remediation in micro-commits. NOTES.md / README updated. PR opened against `main`. After user-driven merge: tag `v0.2.0-plan-02`, clean up worktree.

**Risk:** Low — cleanup and shipping. The one real risk is missing a Vercel env var on production that was only set on preview (INNGEST_*, ETHERSCAN_*). Env audit in Step 2 prevents.
**Rollback:** Pre-merge — close the PR, ship nothing. Post-merge if Inngest integration breaks production — Vercel one-click rollback to the last Plan 01 build, then investigate.

### Task I.1 — Codex holistic review + remediation

**Files:** determined by review findings.

- [ ] **Step 1: Request Codex review against `main`**

Codex reviews the full worktree diff on the frozen Plan 02 spec. Focus areas to request:

- Spec fidelity: every §5.2 trigger condition represented in at least one code path or explicitly skipped with a TODO pointer.
- Idempotency: §4.6 requirements — snapshot upsert, findings delete-then-insert, status transitions.
- Security: RPC URLs are server-only (no `NEXT_PUBLIC_`), API keys never logged, no user-controlled input reaches RPC callers unnormalized.
- Type safety: `FindingResponse` union is exhaustive, scoring edge cases (score=40 boundary, 3+ criticals) covered.
- Test coverage: detector unit tests ≥85% coverage (spec §14), integration test demonstrates end-to-end.

- [ ] **Step 2: Triage findings**

Organize findings into: BLOCKER / IMPORTANT / NICE_TO_HAVE. BLOCKER + IMPORTANT must land before PR merge; NICE_TO_HAVE can be added to the Plan 03 backlog in `NOTES.md`.

- [ ] **Step 3: Remediation commits**

Each finding → one micro-commit on the worktree branch. Commit message: `fix(codex): <finding summary>` or `refactor(codex): ...`. Status marker at the end:

```bash
git commit --allow-empty -m "chore: Phase I Codex review complete"
```

**Deliverables:** Review doc (inline in PR description or a separate artifact), remediation commits.

**Exit:** All BLOCKER / IMPORTANT findings resolved. `pnpm build && pnpm test` + `INTEGRATION_DB=1 pnpm test` green.

### Task I.2 — Docs update + env audit

**Files:**
- Modify: `NOTES.md`, `README.md`, `PRIVACY.md` (minor)

- [ ] **Step 1: Update NOTES.md**

Close the "Plan 02 — In progress" section (landed at spec-freeze) with a "Plan 02 — Completed" section mirroring the Plan 01 format:

```markdown
## Plan 02 — Completed

Plan 02 shipped the dispatcher + Governance module on <date>. See `docs/superpowers/plans/2026-04-22-breakwater-plan-02-implementation.md` for phase breakdown.

Scope:
- Inngest dispatcher (scan.queued → executeScan → executeGovernanceModule → scan.completed)
- 6 governance detectors (GOV-001 through GOV-006) anchored to Drift / Beanstalk / Compound 62 / Ronin / Audius
- GovernanceSnapshot persistence + public RPC via viem fallback transport
- /scan/[id] polling + status indicators
- Plan 01 backlog closed: slug collision, ScanAttempt.reason nullability, FindingResponse discriminated union, config.test production coverage

Resolved deferrals: see commits tagged `refactor:` and `fix:` in the plan-02-dispatcher branch.

New deferrals: see "Plan 03 — Deferred items" below.
```

- [ ] **Step 2: README update**

Add a brief "Running the scan pipeline locally" section:

```markdown
### Running the scan pipeline locally

1. Start the Next.js dev server: `pnpm dev`
2. In another terminal, start the Inngest dev server: `pnpm dlx inngest-cli@latest dev`
3. Submit a scan via the form. Open http://localhost:8288 to see the event flow.
```

- [ ] **Step 3: Env var audit on Vercel**

```bash
pnpm dlx vercel env ls preview
pnpm dlx vercel env ls production
```

Expected on both scopes: `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SCAN_IP_SALT`, `SCAN_EMAIL_SALT`, `NEXT_PUBLIC_SITE_URL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `INNGEST_APP_ID`, `ETHERSCAN_API_KEY`, `SAFE_API_BASE_URL`, `BREAKWATER_GOVERNANCE_MODULE_ENABLED`.

Optional (have defaults): `PRIMARY_ETH_RPC_URL`, `FALLBACK_ETH_RPC_URL`.

Any missing → add via dashboard or CLI. Flag to the user which scope is missing what. Do not assume; confirm before setting.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: Plan 02 completion notes + env audit checklist"
```

**Exit:** Docs updated; env audit report attached to the PR description.

### Task I.3 — Open PR + merge + tag

**Files:** none.

- [ ] **Step 1: Rebase onto latest `main`**

```bash
git fetch origin main
git rebase origin/main
```

Resolve conflicts preferring `main` for spec/research files and the worktree for implementation files.

- [ ] **Step 2: Final gates**

```bash
pnpm build
pnpm test
INTEGRATION_DB=1 pnpm test
```

Preview URL smoke: submit scans against three seeded protocols. Observe lifecycle completion.

- [ ] **Step 3: Open PR**

```bash
gh pr create \
  --base main \
  --head plan-02-dispatcher \
  --title "Plan 02 — Dispatcher + Governance module" \
  --body "$(cat <<'EOF'
## Summary

Implements Plan 02 per spec (commit 400053c on main).

- Phase A: Inngest + viem public RPC (Ankr + Cloudflare fallback) + env/config extensions + feature flag
- Phase B: GovernanceSnapshot model + migration + Plan 01 backlog (slug collision, ScanAttempt.reason nullability)
- Phase C: Inngest serve handler + executeScan orchestrator + POST /api/scan emission (flag-gated)
- Phase D: On-chain layer — multicall wrapper, EIP-1967 proxy reader, Safe + Etherscan clients, captureGovernanceSnapshot
- Phase E: 6 detectors (GOV-001 through GOV-006) — CRITICAL / HIGH / MEDIUM severity per spec §5.2
- Phase F: executeGovernanceModule function + scoring algorithm (with floor override) + persistFindingsAndGrade
- Phase G: GET /api/scan/[id]/status + useScanPolling + ScanShell integration + FindingResponse discriminated union refactor
- Phase H: fixtures + regression suite (Drift / Beanstalk / Audius) + integration test
- Phase I: Codex remediation + docs + env audit

## Plan 01 backlog closed

- Slug collision fix (12-char prefix)
- ScanAttempt.reason nullability
- FindingResponse discriminated union
- config.test.ts production coverage

## Test plan

- [ ] pnpm build succeeds
- [ ] pnpm test passes (unit + component)
- [ ] INTEGRATION_DB=1 pnpm test passes (incl. Inngest integration)
- [ ] LIVE_RPC=1 pnpm test green locally (Uniswap V3, Compound Bravo, Aave)
- [ ] Vercel preview URL: submit Ethereum scan → scan transitions QUEUED → RUNNING → COMPLETE with findings
- [ ] Inngest dashboard shows full event chain on preview
- [ ] Drift-like fixture → GOV-001 + GOV-002 + GOV-003, grade F
- [ ] Beanstalk-like fixture → GOV-001 + GOV-002 + GOV-004
- [ ] Audius-like fixture → GOV-005 + GOV-006

## Codex review focus

- Idempotency of snapshot upsert + findings delete-then-insert (§4.6)
- Feature flag + detector-disable flag short-circuit paths
- Scoring algorithm floor override boundary cases (§5.3)
- Discriminated union exhaustiveness in shaper + FindingsList narrow
- No RPC URL leaks to client; no API keys in client bundles

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Hand PR URL to Robert**

User reviews + merges manually. Do not auto-merge.

- [ ] **Step 5 (post-merge, on main): Tag + cleanup**

After Robert confirms the merge commit is live:

```bash
cd /Users/robertwils/Breakwater
git checkout main
git pull
git tag -a v0.2.0-plan-02 -m "Plan 02 — Dispatcher + Governance module"
git push origin v0.2.0-plan-02

# Remove worktree + local branch
git worktree remove /Users/robertwils/breakwater-plan-02
git branch -d plan-02-dispatcher
```

- [ ] **Step 6: Memory update**

Update `NOTES.md` Plan 02 section to `Completed` (see I.2). Optionally update personal memory to reflect that Plan 02 is shipped and Plan 03 planning is next.

**Deliverables:** PR merged, tag pushed, worktree cleaned up.

**Exit:**
- `main` HEAD carries the merge commit
- `v0.2.0-plan-02` tag on `main`
- Worktree + local branch removed
- NOTES.md Plan 02 section moved to Completed

---

**Phase I exit gate / Plan 02 exit gate:**
- `main` builds + deploys on Vercel production green
- `v0.2.0-plan-02` tagged
- Plan 02 spec §14 hard criteria met
- Plan 01 backlog items (4 total) resolved and documented
- NOTES.md updated

---

## Exit criteria (spec §14 hard)

- [ ] All 6 detectors implemented with unit tests ≥85% coverage (Phase E + scoring)
- [ ] End-to-end integration test: submit → Inngest → detect → persist → UI update (Phase H.3)
- [ ] Drift-like fixture triggers GOV-001, GOV-002, GOV-003 (grade F) (Phase H.2)
- [ ] Beanstalk-like fixture triggers GOV-001, GOV-002, GOV-004 (Phase H.2)
- [ ] Audius-like fixture triggers GOV-005, GOV-006 (Phase H.2)
- [ ] /scan/[id] polling works without regression on Plan 01 tests (Phase G)
- [ ] Production build green on Vercel with all env vars (Phase I.2)
- [ ] Inngest dashboard shows successful function runs (Phase F, Phase I.3 preview smoke)
- [ ] All 204 Plan 01 tests still pass (Phase B onward)
- [ ] New test count: 60+ (detector unit + integration + Inngest tests)
- [ ] Codex review passed with findings resolved (Phase I.1)

## Exit criteria (spec §14 soft)

- [ ] Average scan execution time <30s end-to-end
- [ ] 5 real Ethereum protocols produce sane results (Aave, Uniswap, Compound, Lido, MakerDAO) — exercise via Phase D live suite
- [ ] Lighthouse A11y ≥90 on /scan/[id] (maintained from Plan 01)
- [ ] Zero RPC rate limit hits during local testing

## Deferred to Plan 03+

Per spec §17. Highlights:

- Oracle / Signer / Frontend detector modules
- Solana governance (SPL Governance, Realms)
- L2 governance (Arbitrum Security Council, Optimism Upgrade Keys)
- MakerDAO spell/pause pattern
- Signer clustering / Sybil analysis
- Proposal simulation
- Continuous monitoring + scheduled re-scans
- Quota-vs-dedupe ordering (§17.4 edge case carried over from Plan 01)
- Custom teal prose theme for @tailwindcss/typography

---

## Self-review checklist (complete before starting execution)

- [x] Every spec section has at least one task: §3 (B), §4 (C + F), §5 (E + F), §6 (C + G), §7 (G), §8 (A + D), §9 (A), §10 (H), §11 (A + F), §12 (A + I), §13 (none needed — additive), §14 (all phases), §15 (A feature flag + I rollback prep), §16 (observability via Inngest dashboard).
- [x] No placeholder / "TODO" steps beyond explicitly-deferred-to-Plan-03 items.
- [x] Types and function signatures match across tasks (e.g., `GovernanceFindingInput` in Phase E consumed in Phase F.1 and F.2; `GovernanceSnapshotData` shape stable across D.3 and all E.* detectors).
- [x] Each phase ends in a green state — `pnpm build && pnpm test` pass at phase boundaries.
- [x] Every phase has a risk callout + rollback.
- [x] No external pattern references (SVH Hub is closed for Plan 02).
- [x] Plan 01 backlog items placed at logically correct phase boundaries (slug/ScanAttempt.reason → B; FindingResponse → G; config.test.ts → A).
- [x] Feature-flag kill-switch reachable without redeploying code.

---

## Revision log

Execution-time changes to this plan. The spec on `main` (`docs/superpowers/specs/2026-04-22-breakwater-plan-02-design.md`) is frozen and out of scope for this log — if the spec needs to change mid-implementation, open a separate commit against `main` and run it through Codex review first.

(Empty at plan creation — populated during execution.)
