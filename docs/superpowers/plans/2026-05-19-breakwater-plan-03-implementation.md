# Breakwater Plan 03 — Protocol Graph (user-supplied) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the multi-contract scanning chassis. The user submits a primary contract plus an optional set of related contracts (proxy implementations, declared multisigs, timelocks, bridges, tokens, generic related). The dispatcher fans out one Inngest module run per `(Contract, module)` pair, parallel-waits for each completion, computes per-Contract grades, and rolls them up into a worst-grade-wins protocol composite with separate `worstContractScore` + `averageContractScore` fields. The Plan 02 Governance module's six detectors run unchanged at the detector layer — what changes is the orchestration above them and the snapshot-capture layer below them (role-aware probe routing).

**Architecture:** Next.js 14 App Router on Node 22 LTS with pnpm. Inngest 3.x parallel-fan-out via `Promise.all` over `step.waitForEvent`, with compound `if` expressions distinguishing trigger-event (`event.data.*`) from incoming-event (`async.data.*`). Postgres schema gains a `Contract` table; `ModuleRun`, `GovernanceSnapshot`, and `Finding` are re-keyed on `contractId`. Scan composite is restructured into three named fields (`compositeGrade` worst-wins, `worstContractScore`, `averageContractScore`). All other Plan 02 primitives — viem fallback RPC, Safe API, Etherscan, multicall — are reused unchanged.

**Tech Stack:** Inherits Plan 02 v0.2.0-plan-02. No new external dependencies. Plan 03 is a layer reshape, not a tech expansion.

**Source spec:** `docs/superpowers/specs/2026-05-19-breakwater-plan-03-design.md` (frozen at commit `0ebe7f8` on `main`, after two revision rounds remediating Codex's 4 BLOCKERs + 4 IMPORTANTs + 1 NICE_TO_HAVE).

---

## §1 Overview — two-PR strategy, phase inventory, review cadence

### §1.1 Two PRs, two deploys (spec §3.5 + §12 — non-negotiable)

`prisma migrate deploy` runs every pending migration sequentially. An additive migration and a constraint-tightening migration committed to the same PR will execute back-to-back with no opportunity for a manual backfill between them — the NOT NULL constraint would violate before the backfill ever ran. Plan 03 is therefore split across **two separate PRs and two separate Vercel production deploys**:

- **PR 1 (`plan-03-execution-model`):** Phases A through I. Multi-contract execution model + additive migration + backfill script + graceful-degradation read paths for any historical Scan that doesn't yet have a Contract row.
- **Soak window between PR 1 and PR 2:** verified backfill against production + at least one production multi-contract scan completes end-to-end (Aave V3 demo).
- **PR 2 (`plan-03-tighten-constraints`):** Phases J. Tightening migration (NOT NULL + new unique constraints) + removal of the PR 1 graceful-degradation adapter.

### §1.2 Phase inventory

| Phase | Scope | Commits (target) | PR |
|---|---|---|---|
| A | Schema additive migration + Contract model + response-type stubs (no business logic) | 3 | PR 1 |
| B | Scan submission + Contract creation + validation rules | 3 | PR 1 |
| C | Role-aware snapshot capture (spec BLOCKER 2 fix) | 4 | PR 1 |
| D | Inngest fan-out + parallel `waitForEvent` (spec BLOCKER 1 fix) | 4 | PR 1 |
| E | Per-Contract execution + idempotency invariant (spec §5.3.1) | 3 | PR 1 |
| F | Protocol composite + scoring (spec §6.2) + isPartialGrade two-clause (spec §6.3) | 3 | PR 1 |
| G | Response shape + UI rewrite + ProtocolGraphDisclaimer + proxy detect-and-warn | 5 | PR 1 |
| H | Backfill script + curated demo seed | 3 | PR 1 |
| I | PR 1 prep + manual smoke + production deploy | 2 | PR 1 |
| J | Soak verification + PR 2 (tightening migration + fallback removal) | 3 | PR 2 |
| K | Holistic A–K review + close + tag `v0.3.0-plan-03` | 3 | (post-merge) |

**Total: 36 commits across 11 phases.** Every commit leaves the tree in a green state: `pnpm build` passes, `pnpm test` passes, Vercel preview deploys successfully.

### §1.3 Codex review cadence

Plan 03 plans **seven Codex review touchpoints**. Cadence is denser than Plan 02 (which had a single Phase I holistic review) because Plan 02 surfaced cross-cutting issues only at the holistic review — Plan 03 front-loads per-phase reviews at the highest-risk boundaries to catch BLOCKER-class issues earlier. The seven touchpoints:

| Review # | After Phase | Focus | Why |
|---|---|---|---|
| 1 | A | Schema delta only | Migration physical SQL was a spec BLOCKER. Catch shape issues before code references new columns. |
| 2 | C | Role-aware capture | Spec BLOCKER 2 — the fix's correctness depends on the exact branch table; mis-routing a probe silently breaks GOV-003. Deserves a dedicated second look. |
| 3 | D | Inngest expression syntax + race handling | Spec BLOCKER 1 — `event` vs `async` is a load-bearing factual claim about Inngest 3.x. A regression here means waiters never match. |
| 4 | E | Idempotency scope | Plan 02 I.1 FIX 1 precedent. Widening `deleteMany` to include `contractId` is mechanically simple but fragile — a missed call site silently destroys sibling Contracts' findings. |
| 5 | H (end of PR 1) | PR 1 holistic | Catches cross-cutting issues that per-phase reviews miss. Plan 02's Phase I review found exactly these. |
| 6 | J | PR 2 tightening migration + fallback removal | Small surface but irreversible (constraint tightening). Worth a final look before deploy. |
| 7 | K | Final sign-off | Plan 02 precedent — last chance to catch holistic concerns post-PR-2. |

Skipped boundaries: B (validation, low-novel-risk — covered by per-task tests), F (scoring logic well-specified by spec §6.2, small surface), G (response shape mechanical — adapter logic reviewed under #5 holistic). Robert can opt in to ad-hoc B / F / G reviews if anything surprising surfaces.

### §1.4 Spec-deferred items resolved in this plan

Per spec §17.x, two IMPORTANTs deferred from the spec:

- **§13 below — RPC budget + Inngest concurrency policy.** Concrete number + Inngest function-level concurrency cap.
- **§14 below — `isPartialGrade` reason codes.** Implementation choice (split two booleans vs. enum array).

---

## §2 Working directory and branching

Plan 03 work happens on **two sequential worktrees** off `main`:

### PR 1 worktree

- Path: `/Users/robertwils/breakwater-plan-03`
- Branch: `plan-03-execution-model`
- Cut from `main` after Codex has reviewed this implementation plan (review #0 — out of the seven listed above; this is the "pre-implementation" plan review per Plan 02 precedent).
- Phases A through I happen here.

### PR 2 worktree

- Path: `/Users/robertwils/breakwater-plan-03-pr2`
- Branch: `plan-03-tighten-constraints`
- Cut from `main` *after PR 1 has merged AND the soak window has passed.* Do not cut PR 2 earlier — its migration assumes the PR 1 backfill has completed.
- Phase J happens here.

### Spec freeze

The spec on `main` (`docs/superpowers/specs/2026-05-19-breakwater-plan-03-design.md`) is frozen at commit `0ebe7f8`. If something needs to change mid-implementation, raise it with the user; do not silently diverge. Spec deltas (if any) land on `main` as a separate commit and the worktree rebases onto it.

### Reference policy — Plan 02 tree

Plan 03 is a strict superset of Plan 02 (`v0.2.0-plan-02` tag). The worktree inherits the full Plan 02 tree from `main`. Every file authored by Plan 02 stays authoritative; Plan 03 only adds new files or modifies existing ones where the spec explicitly calls it out (e.g., `src/lib/detectors/governance/capture-snapshot.ts` widens its `CaptureSnapshotContext`; `src/lib/inngest/functions/execute-scan.ts` fans out per-Contract).

---

## §3 File structure (added or modified by this plan)

```
breakwater-plan-03/                       # PR 1 worktree
├── prisma/
│   ├── schema.prisma                     # modified (Contract model + per-Contract relations)
│   └── migrations/
│       └── plan_03_add_contract_model_additive/
│           └── migration.sql             # new — PR 1 additive migration (spec §3.5 PR 1 section)
├── scripts/
│   └── backfill-plan-03-contracts.ts     # new — idempotent backfill (spec §3.5)
├── src/
│   ├── lib/
│   │   ├── config.ts                     # modified — MAX_RELATED_CONTRACTS constant
│   │   ├── schemas/
│   │   │   └── scan.ts                   # modified — RelatedContractSchema + new validation rules
│   │   ├── inngest/
│   │   │   ├── client.ts                 # modified — contractId on event payloads
│   │   │   └── functions/
│   │   │       ├── execute-scan.ts       # modified — Promise.all fan-out, compound waitForEvent
│   │   │       └── execute-governance-module.ts # modified — per-Contract execution + idempotency scope
│   │   ├── detectors/
│   │   │   └── governance/
│   │   │       ├── capture-snapshot.ts   # modified — role-aware probe routing (BLOCKER 2)
│   │   │       ├── persist-snapshot.ts   # modified — contractId in persistence
│   │   │       └── types.ts              # modified — CaptureSnapshotContext widened
│   │   ├── scan-response.ts              # modified — ContractResponse + new score fields
│   │   └── scoring/
│   │       ├── composite-grade.ts        # unchanged — per-Contract score unchanged
│   │       └── protocol-rollup.ts        # new — worst-wins + averageContractScore + worstContractScore
│   ├── app/api/scan/
│   │   ├── route.ts                      # modified — relatedContracts pass-through
│   │   └── [id]/
│   │       ├── route.ts                  # modified — multi-Contract response shape
│   │       └── status/route.ts           # modified — multi-Contract polling shape
│   └── components/scan/
│       ├── ScanShell.tsx                 # modified — ContractList integration
│       ├── ContractList.tsx              # new
│       ├── ContractCard.tsx              # new — per-Contract card with proxy detect-and-warn
│       ├── CompositePanel.tsx            # modified — worstContractScore + averageContractScore copy
│       ├── FindingsList.tsx              # modified — grouped by contractId
│       ├── ModuleCard.tsx                # modified — per-Contract status
│       └── ProtocolGraphDisclaimer.tsx   # modified — multi vs single variants
├── prisma/seed.ts                        # modified — Aave V3 + Uniswap V3 multi-Contract shape
└── docs/
    └── superpowers/
        └── plans/
            └── 2026-05-19-breakwater-plan-03-implementation.md  # this file (lives on main)

breakwater-plan-03-pr2/                   # PR 2 worktree (cut after PR 1 merge + soak)
└── prisma/
    └── migrations/
        └── plan_03_tighten_contract_id_constraints/
            └── migration.sql             # new — PR 2 tightening migration (spec §3.5 PR 2 section)
    # plus removal of PR 1 graceful-degradation adapter in src/lib/scan-response.ts
```

---

## §4 Conventions — Commit hygiene

Plan 03 inherits Plan 02's conventions:

- Imperative mood, ≤72 chars in the subject line.
- Phase-aware prefixes: `feat(graph): …`, `feat(role-capture): …`, `feat(fan-out): …`, `refactor(rollup): …`, `chore(migration): …`.
- Status-marker commits at phase end: `chore: Phase X status marker` (empty commit, grep-able).
- Every commit must pass `pnpm build && pnpm test` locally before push. Integration tests (`INTEGRATION_DB=1 pnpm test`) are required at Phase E, Phase H, and as pre-PR gates at Phases I and J.

---

## §5 Prerequisites (before Phase A.1)

Robert completes setup before any implementer subagent is dispatched:

1. **Confirm Plan 02 is healthy in production.** Vercel main deploy green; `prisma migrate deploy` baseline applies cleanly; v0.2.0-plan-02 tag is on `main`. If anything is amber, fix it on `main` before cutting the Plan 03 worktree.
2. **Verify Inngest Cloud quota.** Plan 03's fan-out increases per-scan step count from ~5 (Plan 02) to ~5 + 3N where N = number of Contracts. A 20-Contract scan emits ~65 step executions. Inngest free tier (50k step runs/month) supports ~750 such scans/month — sufficient for MVP but worth confirming on the Inngest dashboard before launching.
3. **No new environment variables required.** Plan 03 uses zero new credentials, zero new third-party endpoints. The `MAX_RELATED_CONTRACTS = 20` constant is hardcoded in `src/lib/config.ts` (spec §4.1 — product policy, not deployment policy).

---

## §6 Phase A — Schema additive migration + Contract model (3 commits)

**Goal:** Land the additive Prisma migration described in spec §3.5 PR 1 section. Schema delta only — no application code yet uses the new tables / columns. The migration applies cleanly on local dev DB; the running app behaves identically to Plan 02. This phase is the **schema chassis**; subsequent phases populate it.

**Risk:** A wrong column type or missed `ON DELETE` clause in the migration manifests only when later phases write data. Defensive measure: each migration step is tested against the spec §3.5 SQL block before committing.
**Rollback:** Code-only rollback to Plan 02 is NOT clean — the `Scan.compositeScore → Scan.averageContractScore` rename means a code revert would leave Plan 02 reading/writing a column under the wrong name. Rollback requires EITHER (a) keeping the renamed column and a one-line compat shim aliasing `compositeScore` → `averageContractScore` in the Plan 02 code path, OR (b) running a down-migration that renames `averageContractScore` back to `compositeScore` before reverting code. Option (a) is preferred for production speed; option (b) for clean schema state. See `docs/deployment-env.md` for the runbook entry.

### Task A.1 — Prisma schema additions

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `ContractRole` enum** (spec §3.1)

```prisma
enum ContractRole {
  PRIMARY
  PROXY_IMPLEMENTATION
  DECLARED_MULTISIG
  DECLARED_BRIDGE
  TOKEN_CONTRACT
  TIMELOCK
  RELATED
}
```

- [ ] **Step 2: Add `Contract` model** (spec §3.1 — the full block including `compositeScore` / `compositeGrade` / `isPartialGrade` per-Contract fields)

```prisma
model Contract {
  id              String        @id @default(cuid())
  scanId          String
  scan            Scan          @relation(fields: [scanId], references: [id], onDelete: Cascade)
  address         String
  chain           Chain
  role            ContractRole
  label           String?
  crossChainTwins Json          @default("[]")
  isPrimary       Boolean       @default(false)
  createdAt       DateTime      @default(now())

  compositeScore  Int?
  compositeGrade  Grade?
  isPartialGrade  Boolean       @default(false)

  governanceSnapshot GovernanceSnapshot?
  moduleRuns         ModuleRun[]
  findings           Finding[]

  @@unique([scanId, address])
  @@index([scanId])
}
```

- [ ] **Step 3: Add nullable `contractId` columns to existing tables**

`ModuleRun`, `GovernanceSnapshot`, `Finding` each gain `contractId String?` plus a `contract` relation. The existing Plan 02 `@@unique([scanId, module])` on `ModuleRun` and `@unique([scanId])` on `GovernanceSnapshot.scanId` stay in place for PR 1; PR 2 swaps them.

- [ ] **Step 4: Rename `Scan.compositeScore → Scan.averageContractScore` + add `Scan.worstContractScore`**

Both columns are nullable Int. `Scan.compositeGrade` keeps its column name; spec §6.2 widens its semantic to "worst contributing contract's grade."

- [ ] **Step 5: Generate Prisma client + verify type-check**

```bash
pnpm prisma generate
pnpm tsc --noEmit
```

**Deliverables:** `schema.prisma` updated; Prisma client regenerated; type-check passes.
**Exit:** No runtime changes to the app (Phase A only adds types; no code references the new tables yet).

### Task A.2 — Migration SQL

**Files:**
- Create: `prisma/migrations/plan_03_add_contract_model_additive/migration.sql`

- [ ] **Step 1: Run `prisma migrate dev` with explicit migration name**

```bash
pnpm prisma migrate dev --name plan_03_add_contract_model_additive
```

This produces the migration SQL. Open it and verify it matches the spec §3.5 PR 1 section's explicit SQL block:

- `CREATE TABLE "Contract"` with all fields incl. `compositeScore`/`compositeGrade`/`isPartialGrade`.
- `ALTER TABLE "ModuleRun" ADD COLUMN "contractId" TEXT` (nullable; FK to Contract).
- `ALTER TABLE "GovernanceSnapshot" ALTER COLUMN "scanId" DROP NOT NULL; DROP CONSTRAINT "GovernanceSnapshot_scanId_key"; ADD COLUMN "contractId" TEXT` (nullable; FK to Contract).
- `ALTER TABLE "Finding" ADD COLUMN "contractId" TEXT` (nullable; FK to Contract).
- `ALTER TABLE "Scan" RENAME COLUMN "compositeScore" TO "averageContractScore"; ADD COLUMN "worstContractScore" INTEGER`.

If Prisma's generated SQL diverges from the spec (e.g., it generates a default value the spec doesn't specify), **stop and report** — do not silently diverge.

- [ ] **Step 2: Verify migration applies cleanly on a fresh DB**

```bash
# In one terminal:
pnpm exec docker compose up -d  # if using local postgres
# Or against Railway dev DB.

DATABASE_URL=... pnpm prisma migrate reset --skip-seed
DATABASE_URL=... pnpm prisma migrate deploy
```

Should apply without error. No data loss because the renamed column preserves data and the new columns are nullable.

- [ ] **Step 3: Commit**

```bash
git add prisma/
git commit -m "feat(graph): additive migration — Contract model + per-Contract relations"
```

**Deliverables:** Migration SQL file matches spec §3.5; `prisma migrate deploy` clean on dev DB.
**Exit:** Schema migrated; no business logic yet; all 691 Plan 02 tests still green.

### Task A.3 — Response-type stubs

**Files:**
- Modify: `src/lib/scan-response.ts`

- [ ] **Step 1: Add `ContractResponse` type per spec §7.2**

Adds the new `contracts: ContractResponse[]` field and the new score fields (`averageContractScore`, `worstContractScore`) to `ScanResponse`. **Stub only** — no code populates these yet; the existing single-contract scan response builder returns `contracts: []` and `worstContractScore: null` for now.

```typescript
export interface ContractResponse {
  id: string;
  address: string;
  role: ContractRole;
  label: string | null;
  isPrimary: boolean;
  compositeScore: number | null;
  compositeGrade: Grade | null;
  isPartialGrade: boolean;
  crossChainTwins: { chain: string; address: string }[];
  modules: ModuleRunResponse[];
  findingsCount: number;
  proxyImplementationWarning: { detectedAddress: string } | null;
}
```

- [ ] **Step 2: Update `ScanResponse` shape**

```typescript
export interface ScanResponse {
  // existing fields…
  compositeGrade: Grade | null;
  averageContractScore: number | null;   // RENAMED from compositeScore
  worstContractScore: number | null;     // NEW
  isPartialGrade: boolean;
  isPartialCoverage: boolean;            // NEW — see §14 implementation choice
  // Phase A transitional: `modules` REMAINS at top level for Plan 02
  // backward compat with existing UI consumers. Removal deferred to
  // Phase G when the UI rewrite migrates consumers to
  // `contracts[].modules`. The response builder writes both legacy
  // `modules` AND new `contracts: []` (empty in Phase A) for the
  // duration of Phases A through F.
  modules: ModuleRunResponse[];
  contracts: ContractResponse[];
}
```

- [ ] **Step 3: Update existing response builder for backward compat**

The Plan 02 response builder still produces single-contract scans. Adapt it to:

- Keep returning the legacy `modules: ModuleRunResponse[]` at ScanResponse top level (unchanged from Plan 02).
- ALSO populate the new fields with empty/null defaults: `contracts: []`, `worstContractScore: null`, `isPartialCoverage: false`.
- Also expose `compositeScore` as a deprecated alias pointing at `averageContractScore` (single source of truth = the renamed column on Scan).

This dual-write pattern (legacy field + new field) keeps Phase A tests green at 691 while letting Phases B–F populate `contracts[]` incrementally. Phase G is the cutover that REMOVES the legacy `modules` field from the response shape (see Task G.6).

- [ ] **Step 4: Verify type-check + tests**

```bash
pnpm tsc --noEmit
pnpm test
```

All 691 tests still green. The shape change is backward-compat: response consumers using object spread or `.modules` accessor will get `[]` and `undefined` respectively but don't crash.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(graph): response-type stubs — ContractResponse + score field rename"
```

- [ ] **Step 6: Status marker**

```bash
git commit --allow-empty -m "chore: Phase A status marker"
```

**Deliverables:** Type definitions land; response builder backward-compat.
**Exit (Phase A):** Schema migrated; types in place; no behavior change to running app. Test count = 691 (unchanged).

**REVIEW GATE #1 — Codex review of schema delta only.** Focus: SQL matches spec §3.5, no unintended `DEFAULT` clauses, FK `ON DELETE` semantics correct, rename preserves data. Findings → micro-commits before Phase B starts.

---

## §7 Phase B — Scan submission + Contract creation (3 commits)

**Goal:** Submitting a scan with `relatedContracts` creates the right Contract rows + ModuleRun rows. Validation rules from spec §4.1 enforced. No execution changes yet — the dispatcher (Phase D) still fires the Plan 02 single-contract pattern.

**Risk:** Validation rule edge cases — particularly the duplicate-primary rule (spec §4.1: non-default role → 400; RELATED/no-role → silent dedupe). Defensive: every validation branch has a unit test.
**Rollback:** Phase B changes are additive to `submitScan` — `relatedContracts: []` produces a single-Contract scan identical to Plan 02.

### Task B.1 — Schema + validation rules

**Files:**
- Modify: `src/lib/schemas/scan.ts`, `src/lib/config.ts`

- [ ] **Step 1: Add `MAX_RELATED_CONTRACTS` constant**

```typescript
// src/lib/config.ts
export const MAX_RELATED_CONTRACTS = 20;
```

Per spec §4.1 — product policy, not deployment policy. Not a runtime env var.

- [ ] **Step 2: Add `RelatedContractSchema` + extend `ScanSubmissionSchema`**

Per spec §4.1 code block. The `relatedContracts: z.array(RelatedContractSchema).max(MAX_RELATED_CONTRACTS, "too_many_related_contracts")` enforces the cap at zod level.

- [ ] **Step 3: Add chain validation rule** (spec IMPORTANT 2)

In the submission API route (`src/app/api/scan/route.ts`), reject `chain !== "ETHEREUM"` with `400` + `{ error: "unsupported_chain_for_plan_03" }`. The Chain enum stays intact in Prisma (Solana demo data is static / never scanned).

- [ ] **Step 4: Implement primary-address-in-related rule** (spec §4.1 single coherent rule)

Three sub-cases handled inline in the validator:

```typescript
function validateRelatedContracts(
  primary: string,
  related: z.infer<typeof RelatedContractSchema>[],
): { ok: true; normalized: NormalizedRelatedContract[] } | { ok: false; code: string } {
  const seen = new Set<string>([primary.toLowerCase()]);
  const out: NormalizedRelatedContract[] = [];
  for (const r of related) {
    const addr = r.address.toLowerCase();
    if (addr === primary.toLowerCase()) {
      if (r.role && r.role !== "RELATED") {
        return { ok: false, code: "primary_address_in_related" };
      }
      continue;  // silently dedupe RELATED/no-role primary duplicate
    }
    if (seen.has(addr)) continue;  // inter-related dedupe
    seen.add(addr);
    out.push(r);
  }
  return { ok: true, normalized: out };
}
```

- [ ] **Step 5: Unit tests for every validation branch**

In `src/lib/schemas/__tests__/scan.test.ts`:
- `chain: "SOLANA"` → 400 `unsupported_chain_for_plan_03`.
- `relatedContracts.length === 21` → 400 `too_many_related_contracts`.
- Primary in related with `role: "DECLARED_MULTISIG"` → 400 `primary_address_in_related`.
- Primary in related with no role → silent dedupe, no error.
- Two related contracts with same address → silent dedupe, no error.
- Invalid hex address → 400 with index path.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(graph): scan submission validation — chain + max-20 + primary-in-related"
```

### Task B.2 — Contract row creation inside `submitScan`

**Files:**
- Modify: `src/lib/scan/submit-scan.ts` (or equivalent) — wherever the `prisma.scan.create({ data: { ...moduleRuns... } })` lives today.

- [ ] **Step 1: Within the existing `prisma.$transaction`, create Contract rows**

After the Scan row creation:

1. Create Contract row for `primaryContractAddress` (`role: PRIMARY`, `isPrimary: true`).
2. For each entry in normalized `relatedContracts`: create a Contract row with `role`, `label`, `crossChainTwins`.

- [ ] **Step 2: Apply role-applicability gate when seeding ModuleRuns** (spec §4.2)

For each `(Contract, module)` pair, seed one ModuleRun row. Status `QUEUED` if `module` is implemented (`GOVERNANCE`) AND `contract.role` is in the GOVERNANCE applicable-roles set (`PRIMARY`, `PROXY_IMPLEMENTATION`, `DECLARED_MULTISIG`, `TIMELOCK`, `RELATED`); otherwise `SKIPPED` with the H.6-style `errorMessage`:

- `module_disabled_by_user` (if user explicitly excluded the module via `modulesEnabled`)
- `module_not_implemented` (ORACLE / SIGNER / FRONTEND)
- `role_not_applicable_to_module` (GOVERNANCE on TOKEN_CONTRACT / DECLARED_BRIDGE)

- [ ] **Step 3: Stop writing `Protocol.extraContractAddresses` for new scans**

Per spec §3.4: PR 1 stops the dead-data writes; the column stays in the schema for backward-compat reads. Add an `@deprecated` JSDoc comment to the schema field.

- [ ] **Step 4: Integration test**

In `src/lib/scan/__tests__/submit-scan-multi-contract.test.ts` (new file):

```typescript
it("creates Contract + ModuleRun rows for a 4-contract scan", async () => {
  const result = await submitScan({
    chain: "ETHEREUM",
    primaryContractAddress: "0xPrim...",
    relatedContracts: [
      { address: "0xImpl...", role: "PROXY_IMPLEMENTATION" },
      { address: "0xTime...", role: "TIMELOCK" },
      { address: "0xMulti...", role: "DECLARED_MULTISIG" },
    ],
  });
  const scan = await prisma.scan.findUnique({
    where: { id: result.scanId },
    include: { contracts: { include: { moduleRuns: true } } },
  });
  expect(scan!.contracts).toHaveLength(4);
  // PRIMARY + 3 related, each with one QUEUED GOVERNANCE ModuleRun.
});
```

Also test the SKIPPED path (DECLARED_BRIDGE → `role_not_applicable_to_module`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(graph): submitScan creates Contract + per-Contract ModuleRun rows"
```

### Task B.3 — Status marker

- [ ] **Step 1: Status marker commit**

```bash
git commit --allow-empty -m "chore: Phase B status marker"
```

**Deliverables (Phase B):** Submitting a multi-contract scan persists the right rows; validation rejects per spec §4.1.
**Exit (Phase B):** Submission tests green; existing scan submission tests still green; `pnpm build && pnpm test` clean. Test count = 691 + ~10 new.

(No Codex review at this boundary — see §1.3 cadence.)

---

## §8 Phase C — Role-aware snapshot capture (4 commits)

**Goal:** `captureGovernanceSnapshot` becomes role-aware per spec §5.1.1. The `CaptureSnapshotContext` widens to carry `role`; a switch on `role` routes the detector probes correctly. This is the spec BLOCKER 2 fix — without it, a DECLARED_MULTISIG Contract is scanned as a governor target and GOV-003 never fires.

**Risk:** Mis-routing a probe (e.g., calling `detectSafe` on a PRIMARY Contract that isn't a Safe) wastes RPC budget and may produce noise findings. Defensive: the spec §5.1.1 table is the source of truth — every code branch references it.
**Rollback:** Phase C changes are internal to capture-snapshot; nothing else depends on the new branching yet (Phase D + E wire it in). A bug here is rollback-able without touching public surfaces.

### Task C.1 — Widen `CaptureSnapshotContext`

**Files:**
- Modify: `src/lib/detectors/governance/capture-snapshot.ts`, `src/lib/detectors/governance/types.ts`

- [ ] **Step 1: Update the interface**

Per spec §5.1.1:

```typescript
export interface CaptureSnapshotContext {
  contractAddress: string;             // renamed from protocolAddress
  role: ContractRole;                  // NEW
  blockNumber?: bigint;                // optional pin (see §5.1.2)
  declaredMultisigCandidate?: string;
  timelockCandidate?: string;
}
```

The rename `protocolAddress → contractAddress` cascades into the test files. Update all callers in the same commit so the build stays green.

- [ ] **Step 2: Verify existing tests still green with the rename**

```bash
pnpm test src/lib/detectors/governance/__tests__/capture-snapshot.test.ts
```

Tests should pass with no behavioral change yet — the role parameter is accepted but unused at this step. Behavior changes in C.2.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(role-capture): widen CaptureSnapshotContext with role + candidates"
```

### Task C.2 — Role-branched probe routing

**Files:**
- Modify: `src/lib/detectors/governance/capture-snapshot.ts`

- [ ] **Step 1: Implement the switch table from spec §5.1.1**

```typescript
async function probeForRole(
  ctx: CaptureSnapshotContext,
  blockNumber: bigint,
): Promise<{
  governorResult: GovernorDetectionResult | null;
  timelockResult: TimelockDetectionResult | null;
  safeResult: SafeDetectionResult | null;
  proxyResult: ProxyDetectionResult;
}> {
  const { contractAddress, role, declaredMultisigCandidate, timelockCandidate } = ctx;

  switch (role) {
    case "DECLARED_MULTISIG":
      // BLOCKER 2 load-bearing branch: scan the target AS a Safe.
      return {
        governorResult: null,
        timelockResult: null,
        safeResult: await detectSafe({ candidateAddress: contractAddress }),
        proxyResult: { proxyType: "NONE", proxyAdminAddress: null, proxyImplementation: null,
                       proxyAdminIsContract: null, implementationAbi: null },
      };

    case "TIMELOCK":
      // Direct timelock probe on the scan target.
      return {
        governorResult: null,
        timelockResult: await detectTimelock({ blockNumber, governorResult: null,
                                                candidateAddress: contractAddress }),
        safeResult: null,
        proxyResult: await detectProxy({ protocolAddress: contractAddress, blockNumber }),
      };

    case "TOKEN_CONTRACT":
    case "DECLARED_BRIDGE":
      // Entire GOVERNANCE module SKIPPED at submission per §4.2 — capture not invoked.
      // Defensive: if we get here, return an empty snapshot shell.
      throw new Error(
        `[capture-snapshot] role ${role} should be SKIPPED at submission, not reach capture`,
      );

    case "PRIMARY":
    case "PROXY_IMPLEMENTATION":
    case "RELATED":
    default:
      // Plan 02 default behavior — direct governor + proxy probes, cascade-from-governor
      // timelock, safe only if multisig candidate supplied.
      const governorResult = await detectGovernor({ protocolAddress: contractAddress, blockNumber });
      const timelockResult = await detectTimelock({
        blockNumber, governorResult, candidateAddress: timelockCandidate,
      });
      const safeResult = declaredMultisigCandidate
        ? await detectSafe({ candidateAddress: declaredMultisigCandidate })
        : null;
      const proxyResult = await detectProxy({ protocolAddress: contractAddress, blockNumber });
      return { governorResult, timelockResult, safeResult, proxyResult };
  }
}
```

The main `captureGovernanceSnapshot` function calls `probeForRole` and assembles the `GovernanceSnapshotData` from the results — same shape as Plan 02; the difference is which detectors ran.

- [ ] **Step 2: Populate `rawState.role` for forensic readability**

```typescript
rawState: {
  role,  // NEW — names the branch the capture took
  governor: ...,
  timelock: ...,
  safe: ...,
  proxy: ...,
},
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(role-capture): role-aware probe routing per spec §5.1.1"
```

### Task C.3 — Unit tests for each role branch

**Files:**
- Modify: `src/lib/detectors/governance/__tests__/capture-snapshot.test.ts`
- Create: fixtures for DECLARED_MULTISIG, TIMELOCK, PROXY_IMPLEMENTATION cases.

- [ ] **Step 1: DECLARED_MULTISIG scan-target test (BLOCKER 2 load-bearing case)**

```typescript
it("DECLARED_MULTISIG role: detectSafe fires on contractAddress, governor/timelock not invoked", async () => {
  const mockSafe = { isSafe: true, address: "0xMulti", threshold: 1, ownerCount: 2, owners: ["0xA", "0xB"] };
  vi.mocked(detectSafe).mockResolvedValue(mockSafe);
  const snapshot = await captureGovernanceSnapshot({
    contractAddress: "0xMulti",
    role: "DECLARED_MULTISIG",
  });
  expect(detectSafe).toHaveBeenCalledWith({ candidateAddress: "0xMulti" });
  expect(detectGovernor).not.toHaveBeenCalled();
  expect(detectTimelock).not.toHaveBeenCalled();
  expect(snapshot.hasMultisig).toBe(true);
  expect(snapshot.multisigThreshold).toBe(1);
});
```

- [ ] **Step 2: TIMELOCK scan-target test**

Verifies `detectTimelock` invoked with `candidateAddress: contractAddress`; `detectGovernor` not invoked.

- [ ] **Step 3: PROXY_IMPLEMENTATION scan-target test**

Verifies default cascade (governor + timelock + proxy) runs — implementation contracts can be governors or have their own admins.

- [ ] **Step 4: PRIMARY scan-target with multisig candidate**

Verifies the existing Plan 02 behavior is preserved — `detectSafe` invoked with the candidate, not the primary.

- [ ] **Step 5: TOKEN_CONTRACT / DECLARED_BRIDGE → throws (defensive case)**

```typescript
it("TOKEN_CONTRACT role throws — should be SKIPPED at submission, not reach capture", async () => {
  await expect(captureGovernanceSnapshot({
    contractAddress: "0xToken", role: "TOKEN_CONTRACT",
  })).rejects.toThrow(/should be SKIPPED at submission/);
});
```

This is a defense-in-depth assertion — submission-layer SKIPPED filtering should prevent capture from being called with these roles.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test(role-capture): unit tests per role branch incl. BLOCKER 2 case"
```

### Task C.4 — Status marker

- [ ] **Step 1: Status marker commit**

```bash
git commit --allow-empty -m "chore: Phase C status marker"
```

**Deliverables (Phase C):** Role-aware capture works; the DECLARED_MULTISIG case explicitly verified.
**Exit (Phase C):** Capture-snapshot tests green; test count = 691 + ~10 (Phase B) + ~6 (Phase C role tests).

**REVIEW GATE #2 — Codex review of role-aware capture.** Focus: the spec §5.1.1 switch table is fully implemented; the DECLARED_MULTISIG branch correctly passes `contractAddress` (not a sibling) as `candidateAddress`; defensive throws for SKIPPED-at-submission roles. Findings → micro-commits before Phase D starts.

---

## §9 Phase D — Inngest fan-out + parallel waitForEvent (4 commits)

**Goal:** `executeScan` fans out one `scan.module.requested` event per `(Contract, module)` pair (batched in a single `step.sendEvent`), then parallel-waits on `Promise.all` of `step.waitForEvent` calls with the compound `event` vs `async` expression per spec §4.3. Per-wait timeout writes the specific ModuleRun row to FAILED.

**Risk:** The `event` vs `async` distinction in Inngest expression syntax is the BLOCKER 1 fix; a regression silently breaks all waiters. Defensive: integration test #1 below explicitly verifies cross-scope isolation.
**Rollback:** Code-only — revert the fan-out commit and the Plan 02 single-contract dispatcher resurfaces.

### Task D.1 — Event payload changes

**Files:**
- Modify: `src/lib/inngest/client.ts`

- [ ] **Step 1: Extend `ScanModuleRequestedEventData` + `ScanModuleCompletedEventData`** per spec §4.3:

```typescript
export type ScanModuleRequestedEventData = {
  scanId: string;
  module: ModuleName;
  contractId: string;
  contractAddress: string;
};

export type ScanModuleCompletedEventData = {
  scanId: string;
  module: ModuleName;
  contractId: string;
  contractAddress: string;
  status: ModuleStatus;
  findingsCount: number;
  grade: string | null;
  executionMs: number;
};
```

`ScanCompletedEventData` is unchanged.

- [ ] **Step 2: Verify type-check**

```bash
pnpm tsc --noEmit
```

The Plan 02 emitters (`execute-governance-module.ts`'s final `step.sendEvent`) won't compile until D.3 lands the new payload. To keep the tree green at this step, emit with the new fields stubbed (`contractId: "TODO_PLAN_03_D3"`) inside `execute-governance-module.ts`. The single-contract scan flow continues to work because executeScan's existing `match: "data.scanId"` waiter doesn't filter by contractId.

Actually — *do not* stub. The Plan 02 dispatcher still works because Plan 02's `match: "data.scanId"` matches any completed event with the right scanId. To avoid stubbing, this commit only adds the *types* but does not change emitter call sites. Phase D.3's commit changes both emitter and waiter atomically.

Effective rule: D.1 adds the optional event-payload fields (mark `contractId` and `contractAddress` as required in the type but Plan 02 emitters don't compile against them — fix that in D.3). To keep the tree green between D.1 and D.3, mark `contractId` and `contractAddress` as **`?:` optional in the type** and tighten to required in D.4's status-marker commit.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(fan-out): event-payload types extended with contractId/contractAddress"
```

### Task D.2 — Batched `step.sendEvent` fan-out

**Files:**
- Modify: `src/lib/inngest/functions/execute-scan.ts`

- [ ] **Step 1: Replace single-event dispatch with batch dispatch**

Plan 02 sends one `scan.module.requested` event per scan. Plan 03 sends one per `(Contract, module)` pair, batched in a single `step.sendEvent` call (Inngest's API accepts an array):

```typescript
const queuedRuns = await prisma.moduleRun.findMany({
  where: { scanId, status: "QUEUED" },
  include: { contract: true },
});

if (queuedRuns.length > 0) {
  await step.sendEvent("dispatch-modules", queuedRuns.map((mr) => ({
    name: "scan.module.requested" as const,
    data: {
      scanId,
      module: mr.module,
      contractId: mr.contractId!,
      contractAddress: mr.contract.address,
    },
  })));
}
```

(The `mr.contractId!` non-null assertion is safe in PR 1 because the migration only adds nullable contractId on historical rows — new Plan 03 scans always populate it. PR 2's tightening makes the column NOT NULL.)

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(fan-out): batched per-Contract scan.module.requested dispatch"
```

### Task D.3 — Parallel `waitForEvent` with compound `if` expression

**Files:**
- Modify: `src/lib/inngest/functions/execute-scan.ts`, `src/lib/inngest/functions/execute-governance-module.ts`

- [ ] **Step 1: Replace single `waitForEvent` with `Promise.all` over per-Contract waits**

Per spec §4.3 code block:

```typescript
const waitResults = await Promise.all(
  queuedRuns.map((mr) =>
    step.waitForEvent(`wait-${mr.module}-${mr.contractId}`, {
      event: "scan.module.completed",
      if: `event.data.scanId == async.data.scanId && async.data.module == '${mr.module}' && async.data.contractId == '${mr.contractId}'`,
      timeout: "5m",
    }),
  ),
);
```

Critical: `event.data.scanId` references the original `scan.queued` trigger event; `async.data.{module,contractId,scanId}` references the incoming `scan.module.completed`. This is the BLOCKER 1 fix — the previous (spec revision 1) attempt used `event.data.module` which would never match because `scan.queued` has no `module` field.

- [ ] **Step 2: Per-wait timeout handling**

For each `waitResults[i]` that's `null` (timeout), call `mark-module-timeout` step for that specific `(scanId, module, contractId)` tuple. The `mark-module-timeout` step uses status-filtered `updateMany` (`where: { status: { in: ["QUEUED", "RUNNING"] } }`) so a delayed completion arriving after the timeout's write is a no-op. Per spec §4.3 race-handling section.

- [ ] **Step 3: Emit `scan.module.completed` from `executeGovernanceModule` with new fields**

Plan 02's `execute-governance-module.ts` emits `scan.module.completed` at the end. Update the emit to include `contractId` and `contractAddress`. The function trigger remains `event: "scan.module.requested", if: 'event.data.module == "GOVERNANCE"'` (this is the function-trigger filter, not a wait expression — `event` is unambiguous here because there's only one event in scope).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(fan-out): parallel waitForEvent with event-vs-async compound match"
```

### Task D.4 — Integration tests: cross-scope isolation + per-Contract timeout

**Files:**
- Modify: `src/lib/inngest/functions/__tests__/execute-scan.test.ts` (or create a new `multi-contract.test.ts`)

- [ ] **Step 1: Cross-scope isolation test (BLOCKER 1 exit criterion, spec §14)**

The test must cover the three cross-scope dimensions:

```typescript
describe("waitForEvent compound match — cross-scope isolation", () => {
  it("sibling scan's completion event does not match this scan's waiter", async () => {
    // Submit scan A with 1 Contract. While its waiter is active, fire a
    // scan.module.completed event for a DIFFERENT scanId. Assert scan A's
    // waiter is still active (not resolved).
  });
  it("different module's completion event does not match", async () => {
    // (Plan 03 only ships GOVERNANCE so this is forward-compat; assert
    // a "ORACLE" completion event with the right scanId+contractId does
    // not resolve a GOVERNANCE waiter.)
  });
  it("different contractId's completion event does not match", async () => {
    // Submit scan A with 2 Contracts. Fire scan.module.completed for Contract 1.
    // Assert Contract 2's waiter is still active.
  });
});
```

These tests use the Inngest test framework (`@inngest/test`) — Plan 02 Phase H integration deferred this to "later"; Plan 03 picks it up here because the BLOCKER 1 fix has no regression coverage otherwise.

- [ ] **Step 2: Per-Contract timeout isolation test**

Submit a scan with 2 Contracts. Send `scan.module.completed` for Contract 1 only. Advance the test clock past the 5-minute timeout. Assert: Contract 1's ModuleRun is COMPLETE; Contract 2's ModuleRun is FAILED with `errorMessage: "module_timeout"`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test(fan-out): cross-scope isolation + per-Contract timeout integration"
```

- [ ] **Step 4: Status marker**

```bash
git commit --allow-empty -m "chore: Phase D status marker"
```

**Deliverables (Phase D):** Parallel fan-out + correct event-vs-async filtering + per-Contract timeout isolation.
**Exit (Phase D):** All integration tests green; `pnpm build && INTEGRATION_DB=1 pnpm test` clean. Test count = 691 + ~16 + ~6 new integration.

**REVIEW GATE #3 — Codex review of Inngest expression syntax + race handling.** Focus: BLOCKER 1 expression syntax correct; `event` vs `async` used appropriately in every wait call site; cross-scope isolation tests cover all three dimensions; the `mark-module-timeout` + `markModuleComplete` race is idempotent (compare-and-set on RUNNING + status-filtered updateMany). Findings → micro-commits before Phase E starts.

---

## §10 Phase E — Per-Contract execution + idempotency invariant (3 commits)

**Goal:** `executeGovernanceModule` runs detectors per-Contract; findings are persisted with `contractId`; the Plan 02 I.1 FIX 1 idempotency pattern (`deleteMany({ scanId, module })`) widens to `deleteMany({ scanId, module, contractId })` per spec §5.3.1. This is the IMPORTANT 3 fix.

**Risk:** A missed `deleteMany` call site silently destroys sibling Contracts' findings on retry. Defensive: integration test #2 below explicitly verifies sibling isolation.
**Rollback:** Code-only.

### Task E.1 — Pass `contractId` through `executeGovernanceModule`

**Files:**
- Modify: `src/lib/inngest/functions/execute-governance-module.ts`

- [ ] **Step 1: Function reads `contractId` from event payload + plumbs it through**

```typescript
async ({ event, step }) => {
  const { scanId, contractId, contractAddress } = event.data;
  // … all downstream calls receive contractId …
}
```

- [ ] **Step 2: Load the Contract row + role for the capture call**

```typescript
const contract = await prisma.contract.findUnique({
  where: { id: contractId },
});
if (!contract) {
  throw new Error(`[execute-governance-module] Contract ${contractId} not found`);
}
const snapshot = await captureGovernanceSnapshot({
  contractAddress: contract.address,
  role: contract.role,
  declaredMultisigCandidate: /* PRIMARY role only — lookup from scan's other Contract rows where role === DECLARED_MULTISIG; null otherwise */,
});
```

**Note on sibling-candidate hint** (spec §5.1.1 row 1 of the table): when capturing a PRIMARY Contract that has a sibling DECLARED_MULTISIG Contract in the same scan, the PRIMARY's snapshot can populate its `multisigAddress` field from the sibling (the same behavior Plan 02 had via `declaredMultisigAddresses`). Plan 03 reads this hint from the sibling Contract list, not from `Protocol.knownMultisigs`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(per-contract): executeGovernanceModule reads contractId + role"
```

### Task E.2 — Widen idempotency scope to `(scanId, module, contractId)`

**Files:**
- Modify: `src/lib/inngest/functions/execute-governance-module.ts` (specifically `persistSnapshotAndFindings`), `src/lib/detectors/governance/persist-snapshot.ts`

- [ ] **Step 1: `persistSnapshotAndFindings` signature widens**

```typescript
export async function persistSnapshotAndFindings(
  tx: Prisma.TransactionClient,
  scanId: string,
  contractId: string,            // NEW
  snapshot: GovernanceSnapshotData,
  findings: GovernanceFindingInput[],
  errorDetectorCount: number = 0,
): Promise<PersistResult>
```

- [ ] **Step 2: `deleteMany` scope widens**

Plan 02:
```typescript
await tx.finding.deleteMany({
  where: { scanId, module: "GOVERNANCE" },
});
```

Plan 03 (spec §5.3.1 IMPORTANT 3 fix):
```typescript
await tx.finding.deleteMany({
  where: { scanId, module: "GOVERNANCE", contractId },
});
```

Comment block above the call explicitly references spec §5.3.1 + Plan 02 I.1 FIX 1 precedent — this is the load-bearing invariant.

- [ ] **Step 3: `ModuleRun.findFirst` keys on the full composite**

```typescript
const moduleRun = await tx.moduleRun.findFirst({
  where: { scanId, module: "GOVERNANCE", contractId },
  select: { id: true },
});
```

- [ ] **Step 4: `persistGovernanceSnapshot` keys on `contractId`** (PR 1: upsert tolerates both legacy `scanId`-keyed and new `contractId`-keyed shapes for graceful degradation; PR 2 removes the `scanId` fallback)

- [ ] **Step 5: `Finding.createMany` writes `contractId` per row**

```typescript
await tx.finding.createMany({
  data: findings.map((f) => ({
    scanId,
    contractId,                  // NEW
    moduleRunId: moduleRun.id,
    module: "GOVERNANCE" as const,
    // … rest unchanged …
  })),
});
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(per-contract): widen idempotency to (scanId, module, contractId) per §5.3.1"
```

### Task E.3 — Sibling-isolation integration test (IMPORTANT 3 exit criterion, spec §14)

**Files:**
- Modify: `src/lib/inngest/functions/__tests__/execute-governance-module.test.ts` (or new `idempotency.test.ts`)

- [ ] **Step 1: 3-Contract scan, retry one Contract, verify siblings untouched**

```typescript
it("retrying one Contract's ModuleRun does not affect sibling Contracts' findings", async () => {
  // Create scan with Contracts A, B, C. Run all three to completion;
  // each persists 2 findings.
  const scan = await setup3ContractScan();
  await runAllModules(scan.id);
  expect(await prisma.finding.count({ where: { scanId: scan.id } })).toBe(6);

  // Retry Contract A's GOVERNANCE module (simulate Inngest replay).
  await persistSnapshotAndFindings(prisma, scan.id, scan.contracts[0].id,
    /* fresh snapshot */, /* fresh findings */);

  // Contracts B and C still have their original 2 findings each (4 total + A's new 2).
  const bFindings = await prisma.finding.count({
    where: { scanId: scan.id, contractId: scan.contracts[1].id },
  });
  const cFindings = await prisma.finding.count({
    where: { scanId: scan.id, contractId: scan.contracts[2].id },
  });
  expect(bFindings).toBe(2);
  expect(cFindings).toBe(2);
});
```

Without the IMPORTANT 3 fix, B and C would each have zero findings after A's retry (Plan 02's broader `deleteMany` scope would have wiped them).

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "test(per-contract): sibling-isolation integration test"
```

- [ ] **Step 3: Status marker**

```bash
git commit --allow-empty -m "chore: Phase E status marker"
```

**Deliverables (Phase E):** Per-Contract execution + idempotency invariant verified.
**Exit (Phase E):** Sibling-isolation test green; existing detector unit tests + Phase C/D tests still green. Test count = 691 + ~22 + ~3 new integration.

### Phase E additional exit criteria (from Codex Review #3 IMPORTANT 1+2)

Phase D's D.5 live integration tests at `src/lib/inngest/functions/__tests__/execute-scan-fanout.integration.test.ts` currently **overclaim** runtime routing verification. The reason is structural: Phase D inherited Plan 02's `executeGovernanceModule` with scan-wide `markModuleRunning` + `markModuleComplete` updateManys (filter on `scanId + module + status`, NOT on `contractId`). When the dispatcher fires N events for a multi-Contract scan, only the FIRST `executeGovernanceModule` invocation does work — `markRunning` flips ALL ModuleRuns for that scan to RUNNING in one shot, subsequent invocations see `skipped: true` and short-circuit without emitting `scan.module.completed`. The first invocation's `markModuleComplete` then transitions ALL rows to COMPLETE.

Consequence: a D.5 test that polls "all ModuleRuns reach terminal state" passes even if the per-Contract wait routing is broken, because rows get marked COMPLETE via the scan-wide updateMany before the broken waiters ever come into play. The infra runs; the tests don't actually prove waiters consumed the right completion events.

Phase E's per-Contract refactor (Tasks E.1 + E.2 above) makes those D.5 tests meaningful naturally — once each invocation only updates `(scanId, module, contractId)` and only emits its own completion event, a regression in the wait expression (e.g., reverting `async.data.contractId` to `event.data.contractId`) would leave rows in non-terminal state and the tests would FAIL. Phase E MUST therefore:

- [ ] Refactor `executeGovernanceModule` so each invocation updates ONLY its own `(scanId, module, contractId)` ModuleRun row. Specifically: `markModuleRunning`, `persistSnapshotAndFindings`, and `markModuleComplete` all scoped by `contractId` per spec §5.3.1's idempotency invariant.
- [ ] After the refactor, **STRENGTHEN** the D.5 integration tests in `src/lib/inngest/functions/__tests__/execute-scan-fanout.integration.test.ts`:
  - **Test 1 (per-Contract routing):** assert each Contract's ModuleRun reaches `COMPLETE` via ITS OWN completion event — verifiable now that one invocation no longer terminates all rows. Current test asserts only the terminal state of all rows; strengthened test asserts the per-row completion's `executionMs` / `findingsCount` matches what that specific Contract's `executeGovernanceModule` returned.
  - **Test 2 (cross-scope isolation):** with per-Contract execution, a regression to `event.data.module` or `event.data.contractId` in the wait expression would leave rows in non-terminal/timeout state. The strengthened test asserts that the cross-scope contractId disjointness is observable mid-run (e.g., scan A's completion event count vs scan B's, polled before either finalizes), not just at the terminal state where the scan-wide updateMany previously masked the failure mode.
  - **Test 3 (per-Contract timeout):** make ONE Contract deliberately never emit a completion event (e.g., temporarily unregister its executeGovernanceModule handler for that contractId via a per-test serve-handler override, or filter the trigger-event `if` expression at the executeGovernanceModule level). Assert ONLY that row reaches `FAILED` with `errorMessage: "module_timeout"`, siblings reach `COMPLETE` normally. Add an elapsed-time bound assertion or a `Promise.all` source-level check to verify the scan-level wall-time is `~timeout`, not `N × timeout` (proves the parallel-wait pattern works, not serial).
- [ ] Remove the "overclaim" caveats from the D.5 test file header comments (lines 1-30 of `execute-scan-fanout.integration.test.ts`) and from each test's framing comments once the assertions genuinely prove what they claim. The `[Phase E carryover]` notes in `test 3 — per-wait timeout` and in the `captureGovernanceSnapshot` mock should disappear because the underlying scan-wide updateMany issue will be gone.

These three items are MUST-DO Phase E exit criteria. They flip the D.5 tests from "the infrastructure runs" to "the load-bearing BLOCKER 1 routing claim is verified end-to-end" — which is what the spec §4.3 BLOCKER 1 fix actually demands.

**REVIEW GATE #4 — Codex review of idempotency scope.** Focus: every `deleteMany` / `findFirst` / `upsert` call site in the persist path includes `contractId`; the IMPORTANT 3 test catches the regression mode; no implicit Plan 02 I.1 FIX 1 lingering scope; the strengthened D.5 tests now fail on a `event.data.contractId` regression where they previously passed. Findings → micro-commits before Phase F starts.

---

## §11 Phase F — Protocol composite + scoring (3 commits)

**Goal:** `markComplete` computes Per-Contract grades + the protocol-level rollup per spec §6.2 (worst-grade-wins + `averageContractScore` + `worstContractScore` + tie-breaking) and `isPartialGrade` + `isPartialCoverage` per spec §6.3.

**Risk:** Small surface but logic-heavy. Edge cases: all SKIPPED Contracts, mixed FAILED + COMPLETE, zero graded Contracts (Plan 02 H.9 BLOCKER Layer C extension to graph layer).
**Rollback:** Code-only.

### Task F.1 — `protocol-rollup.ts` — new module

**Files:**
- Create: `src/lib/scoring/protocol-rollup.ts`

- [ ] **Step 1: Implement the rollup function**

```typescript
export type ProtocolRollupResult = {
  compositeGrade: Grade | null;
  averageContractScore: number | null;
  worstContractScore: number | null;
  isPartialGrade: boolean;
  isPartialCoverage: boolean;
};

export function rollupProtocolComposite(
  contracts: Array<{
    compositeScore: number | null;
    compositeGrade: Grade | null;
    isPartialGrade: boolean;     // per-Contract
    status: "COMPLETE" | "FAILED" | "SKIPPED";  // derived from ModuleRuns
  }>,
): ProtocolRollupResult {
  const graded = contracts.filter((c) => c.compositeGrade !== null);
  if (graded.length === 0) {
    // Spec §6.2 zero-graded-Contracts guard — extends Plan 02 H.9 BLOCKER Layer C
    return { compositeGrade: null, averageContractScore: null,
             worstContractScore: null, isPartialGrade: false, isPartialCoverage: false };
  }
  // Worst grade = min by F→D→C→B→A ordering
  const compositeGrade = minGrade(graded.map((c) => c.compositeGrade!));
  // Tie-break: among Contracts whose grade matches compositeGrade, lowest score
  const tied = graded.filter((c) => c.compositeGrade === compositeGrade);
  const worstContractScore = Math.min(...tied.map((c) => c.compositeScore!));
  const averageContractScore = Math.round(
    graded.reduce((acc, c) => acc + c.compositeScore!, 0) / graded.length,
  );
  // §6.3 two-clause isPartialGrade — see §14 implementation choice below
  const isPartialGrade = contracts.some((c) => c.isPartialGrade);
  const isPartialCoverage = graded.length > 0 && contracts.some((c) => c.status === "FAILED");
  return { compositeGrade, averageContractScore, worstContractScore, isPartialGrade, isPartialCoverage };
}
```

- [ ] **Step 2: Unit tests for every rollup edge case**

```typescript
describe("rollupProtocolComposite", () => {
  it("all SKIPPED → null composite (spec §6.2 zero-graded-Contracts guard)");
  it("all FAILED → null composite");
  it("mix of FAILED and COMPLETE → composite from COMPLETE only + isPartialCoverage true");
  it("two Contracts both at F → worstContractScore is the lower of the two");
  it("two Contracts at F with same score → worstContractScore is that score (tie ok)");
  it("single COMPLETE Contract → average === worst === that score");
  it("isPartialGrade fires if ANY Contract has isPartialGrade true (detector errors)");
  it("isPartialCoverage fires if ≥1 graded Contract AND ≥1 FAILED Contract coexist");
  it("isPartialCoverage does NOT fire if FAILED Contract coexists with only SKIPPED siblings");
});
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(rollup): protocol composite — worst-wins + average + worst score"
```

### Task F.2 — Wire `markComplete` to call the rollup + persist Scan-level fields

**Files:**
- Modify: `src/lib/inngest/functions/execute-scan.ts` (`markComplete` function)

- [ ] **Step 1: Load Contracts + their ModuleRuns + findings counts**

```typescript
const scan = await prisma.scan.findUnique({
  where: { id: scanId },
  include: { contracts: { include: { moduleRuns: true, findings: { select: { severity: true } } } } },
});
```

- [ ] **Step 2: Compute per-Contract composite for each Contract**

For each Contract whose ModuleRuns are all terminal, call `calculateCompositeGrade(contract.findings)` (Plan 02 §5.3 algorithm — unchanged) and persist into `Contract.compositeScore` + `Contract.compositeGrade` + `Contract.isPartialGrade`.

- [ ] **Step 3: Compute protocol rollup + persist on Scan row**

```typescript
const rollup = rollupProtocolComposite(scan.contracts.map((c) => ({
  compositeScore: c.compositeScore,
  compositeGrade: c.compositeGrade,
  isPartialGrade: c.isPartialGrade,
  status: deriveContractStatus(c.moduleRuns),
})));
await tx.scan.updateMany({
  where: { id: scanId, status: "RUNNING" },
  data: {
    status: rollup.compositeGrade !== null ? "COMPLETE" : "FAILED",
    completedAt,
    compositeGrade: rollup.compositeGrade,
    averageContractScore: rollup.averageContractScore,
    worstContractScore: rollup.worstContractScore,
    isPartialGrade: rollup.isPartialGrade,
    isPartialCoverage: rollup.isPartialCoverage,
  },
});
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(rollup): markComplete persists per-Contract + protocol composite"
```

### Task F.3 — Status marker

- [ ] **Step 1: Status marker commit**

```bash
git commit --allow-empty -m "chore: Phase F status marker"
```

**Deliverables (Phase F):** Protocol composite computed + persisted across edge cases.
**Exit (Phase F):** Rollup unit tests green; `markComplete` integration test (4-Contract scan) green. Test count = 691 + ~25 + ~10 rollup unit + integration.

(No Codex review at this boundary — see §1.3 cadence. F's surface is small and logic-heavy but well-specified; covered by holistic review #5.)

---

## §12 Phase G — Response shape + UI rewrite (5 commits)

**Goal:** Response shape carries the new fields; UI renders multi-Contract scans correctly; proxy detect-and-warn affordance + ProtocolGraphDisclaimer rewrite per spec §5.3 + §7.4.

**Risk:** UI changes are mostly cosmetic but the response shape change is breaking. Defensive: graceful-degradation read path (PR 1 era only) synthesizes single-Contract shape for legacy scans with no Contract rows.
**Rollback:** Code-only; the response builder's adapter logic is the seam.

### Task G.1 — Response builder rewrite + graceful-degradation adapter

**Files:**
- Modify: `src/lib/scan-response.ts`

- [ ] **Step 1: Build `ContractResponse[]` from Scan.contracts**

For each Contract on the Scan, project into `ContractResponse` shape (id, address, role, label, isPrimary, compositeScore, compositeGrade, isPartialGrade, crossChainTwins, modules grouped by contractId, findingsCount).

- [ ] **Step 2: Implement proxy detect-and-warn derivation**

```typescript
function deriveProxyImplementationWarning(
  contract: Contract & { governanceSnapshot: GovernanceSnapshot | null },
  allContracts: Contract[],
): { detectedAddress: string } | null {
  const impl = contract.governanceSnapshot?.proxyImplementation;
  if (!impl) return null;
  const alreadyInGraph = allContracts.some(
    (c) => c.address.toLowerCase() === impl.toLowerCase() && c.role === "PROXY_IMPLEMENTATION",
  );
  if (alreadyInGraph) return null;
  return { detectedAddress: impl };
}
```

- [ ] **Step 3: Graceful-degradation adapter for legacy single-Contract scans**

If a Scan has zero Contract rows (historical pre-backfill data), synthesize one `ContractResponse` from `Scan.protocol.primaryContractAddress` + the legacy `(scanId, module)`-keyed ModuleRun rows. Mark the adapter call site clearly: `// PR 1 graceful degradation — removed in PR 2`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(response): multi-Contract response + graceful-degradation adapter"
```

### Task G.2 — `ContractList` + `ContractCard` components

**Files:**
- Create: `src/components/scan/ContractList.tsx`, `src/components/scan/ContractCard.tsx`

- [ ] **Step 1: `ContractCard` shows role + label + address + grade + findings count**

Plus the proxy-implementation warning when present (styled like `ProtocolGraphDisclaimer`: subtle accent border, no icon).

- [ ] **Step 2: `ContractList` orders cards: PRIMARY first, then by role priority**

Role priority: TIMELOCK, DECLARED_MULTISIG, PROXY_IMPLEMENTATION, TOKEN_CONTRACT, DECLARED_BRIDGE, RELATED. Then by address (lowercased) for stable ordering within a role.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(ui): ContractList + ContractCard incl. proxy detect-and-warn"
```

### Task G.3 — `CompositePanel` rewrite

**Files:**
- Modify: `src/components/scan/CompositePanel.tsx`

- [ ] **Step 1: Show three lines per spec §7.4**

```
Protocol grade: F
Worst contract score: 0/100
Average contract score: 50/100 across N contracts
```

If `isPartialGrade` or `isPartialCoverage` is true, append a "Partial" affordance with a tooltip explaining the reason.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(ui): CompositePanel — protocol grade + worst + average score"
```

### Task G.4 — `FindingsList` + `ModuleCard` + `ProtocolGraphDisclaimer`

**Files:**
- Modify: `src/components/scan/FindingsList.tsx`, `src/components/scan/ModuleCard.tsx`, `src/components/scan/ProtocolGraphDisclaimer.tsx`

- [ ] **Step 1: `FindingsList` grouped by contractId**

One section per Contract that has findings. Section header includes contract label + role + truncated address.

- [ ] **Step 2: `ModuleCard` now per-Contract**

Plan 02 rendered one `ModuleCard` per module across the whole scan. Plan 03 renders one `ModuleCard` per `(Contract, module)` pair. Visual polish (collapse layouts, "scanning contract 3 of 7" copy) is local to the component.

- [ ] **Step 3: `ProtocolGraphDisclaimer` two variants**

Multi-Contract scan copy (per spec §7.4):
> "Breakwater scanned `<N>` contract(s) you supplied for this protocol. Automatic discovery of related contracts (bridges, token contracts, cross-chain twins) is on the roadmap."

Single-Contract scan copy (gentle nudge):
> "Breakwater scans the submitted core contract address. Submit related contracts (proxy implementations, multisigs, bridges) to expand the graph."

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): FindingsList grouped, per-Contract ModuleCard, disclaimer variants"
```

### Task G.5 — Status endpoint shape + visual smoke

**Files:**
- Modify: `src/app/api/scan/[id]/status/route.ts`, `src/hooks/useScanPolling.ts`

- [ ] **Step 1: Status endpoint returns the per-Contract shape per spec §7.3**

Cache-Control rules from Plan 02 G.1 carry over (`no-store` for non-terminal, `private, max-age=60` for terminal).

- [ ] **Step 2: `useScanPolling` returns a nested `(contractId, module) → status` map**

ScanShell consumes this for the per-Contract status pulse animations.

- [ ] **Step 3: Visual smoke — submit a 4-Contract scan locally + render**

```bash
pnpm dev
# In another terminal:
pnpm dlx inngest-cli@latest dev
# In a third terminal:
# Submit a scan via the form with 4 contracts. Watch the UI render.
```

A11y score ≥ 90 maintained (Plan 02 baseline). Visual regression: existing single-Contract Plan 02 demos should still render unchanged via the graceful-degradation adapter.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui): status endpoint + useScanPolling per-Contract shape"
```

### Task G.6 — Remove Phase A backward-compat aliases (1 commit)

Phase A kept `modules` at ScanResponse top level + `compositeScore` as an alias for `averageContractScore` to keep Plan 02 UI consumers compiling. Phase G is the cutover: the new UI reads exclusively from `contracts[].modules` and `averageContractScore` / `worstContractScore`. Remove the legacy aliases:

- [ ] Delete `modules` from ScanResponse top level
- [ ] Delete `compositeScore` alias from response builder
- [ ] Update remaining Plan 02 consumer files to read from new locations (most of this work overlaps with G.1–G.4 UI rewrite)
- [ ] Verify all tests green after removal
- [ ] Commit: `refactor(ui): remove Phase A backward-compat aliases at UI cutover`

- [ ] **Status marker**

```bash
git commit --allow-empty -m "chore: Phase G status marker"
```

**Deliverables (Phase G):** Multi-Contract UI working end-to-end on local dev; legacy ScanResponse aliases removed.
**Exit (Phase G):** All UI smoke tests green; visual regression checked against Plan 02 single-Contract demos; A11y ≥ 90. Test count = 691 + ~35 + ~8 UI unit/component.

(No Codex review at this boundary — covered by holistic review #5 after Phase H.)

### Deferred from Phase G — ContractCard click-to-scroll (Codex Review #5 NTH 1)

Spec §7.4 specifies that contract cards should support clicking to scroll to / filter their findings. Phase G implemented contract cards as passive `<article>` elements (the structural data presence is complete — every Contract's findings render in its own `<FindingSection>` below the ContractList, so a user can navigate visually). The click-to-scroll interaction is deferred to Phase I (or a dedicated UI-polish pass) because it's interaction behavior best validated against a running browser, not blind-implemented:

- [ ] Wire `ContractCard` → findings-section anchor (scroll-to on click) OR filter state (show only that contract's findings).
- [ ] Verify keyboard accessibility — the card becomes interactive, so it needs the right semantics (`<button>` wrapping the heading + address chunk, or `<a href="#findings-{contractId}-heading">` for anchor-scroll), focus handling, and Enter/Space activation.
- [ ] Validate in the Phase I preview URL smoke alongside the existing 4-Contract Aave V3 check.

This is a §7.4 structural-behavior gap, tracked here so it isn't silently dropped. Cross-referenced in Phase I's preview-smoke checklist (§14 Task I.1 Step 2).

---

## §13 Phase H — Backfill script + curated demo seed (3 commits)

**Goal:** `scripts/backfill-plan-03-contracts.ts` exists, is idempotent, and tested. Curated demos in `prisma/seed.ts` updated to multi-Contract shape (Aave V3 + Uniswap V3 per spec §8.1).

**Risk:** Backfill running against production data is operationally heavy. Defensive: idempotency test runs the script twice and verifies no-op on second invocation.
**Rollback:** Code-only — backfill produces only inserts and updates; revert via inverse SQL on a per-row basis is documented in `docs/deployment-env.md` Plan 03 addendum.

### Task H.1 — Backfill script

**Files:**
- Create: `scripts/backfill-plan-03-contracts.ts`

- [ ] **Step 1: Idempotent backfill logic per spec §3.5 PR 1 section**

```typescript
async function backfillScan(scanId: string) {
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: { protocol: true, contracts: true, moduleRuns: true,
               governanceSnapshot: true, findings: true },
  });
  if (!scan) return { skipped: true, reason: "scan_not_found" };

  // Idempotency check: if a PRIMARY Contract already exists, skip.
  let primaryContract = scan.contracts.find((c) => c.isPrimary);
  if (!primaryContract) {
    primaryContract = await prisma.contract.create({
      data: {
        scanId,
        address: scan.protocol.primaryContractAddress,
        chain: scan.chain,
        role: "PRIMARY",
        isPrimary: true,
        compositeScore: scan.averageContractScore,  // historical single-contract score
        compositeGrade: scan.compositeGrade,
        isPartialGrade: scan.isPartialGrade,
      },
    });
  }

  // Backfill contractId on legacy rows (idempotent — `WHERE contractId IS NULL`)
  await prisma.moduleRun.updateMany({
    where: { scanId, contractId: null },
    data: { contractId: primaryContract.id },
  });
  await prisma.governanceSnapshot.updateMany({
    where: { scanId, contractId: null },
    data: { contractId: primaryContract.id },
  });
  await prisma.finding.updateMany({
    where: { scanId, contractId: null },
    data: { contractId: primaryContract.id },
  });
  return { skipped: false, contractId: primaryContract.id };
}

async function main() {
  const scans = await prisma.scan.findMany({ select: { id: true } });
  const results = { backfilled: 0, skipped: 0, errors: 0 };
  for (const { id } of scans) {
    try {
      const r = await backfillScan(id);
      r.skipped ? results.skipped++ : results.backfilled++;
    } catch (e) {
      results.errors++;
      console.error(`scan ${id}: ${e}`);
    }
  }
  console.log(`Backfill complete: ${JSON.stringify(results)}`);
  if (results.errors > 0) process.exit(1);
}
```

- [ ] **Step 2: Add `pnpm db:backfill-plan-03-contracts` script in `package.json`**

```json
"db:backfill-plan-03-contracts": "tsx scripts/backfill-plan-03-contracts.ts"
```

- [ ] **Step 3: Idempotency test**

```typescript
it("backfill is idempotent — second run is no-op", async () => {
  await seedLegacyPlan02Scan(/* 1 scan, no Contract rows */);
  await runBackfill();
  const firstState = await snapshotState();
  await runBackfill();
  const secondState = await snapshotState();
  expect(secondState).toEqual(firstState);
});
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(backfill): idempotent Plan 03 Contract backfill script"
```

### Task H.2 — Multi-Contract demo seed

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Aave V3 multi-Contract seed**

Per spec §8.1 table:
- PRIMARY: Aave V3 Pool (`0x87870Bca…`)
- PROXY_IMPLEMENTATION: Pool Implementation
- TIMELOCK: Short Executor
- DECLARED_MULTISIG: Aave Guardian (3-of-5)

- [ ] **Step 2: Uniswap V3 multi-Contract seed**

- PRIMARY: SwapRouter
- RELATED: UniswapV3Factory + Permit2

- [ ] **Step 3 (optional, stretch — spec §15 soft criteria): Compound or MakerDAO multi-Contract seed**

If time permits within Phase H, add Compound v3 USDC OR a MakerDAO Spell/Pause graph as a third demo. Otherwise note in NOTES.md for post-launch.

- [ ] **Step 4: Seed test**

```typescript
it("seed file produces Aave V3 demo with 4 Contracts", async () => {
  await prisma.$executeRaw`TRUNCATE …`;
  await seed();
  const aave = await prisma.protocol.findUnique({
    where: { slug: "aave-v3-ethereum" },
    include: { scans: { include: { contracts: true } } },
  });
  expect(aave?.scans[0]?.contracts).toHaveLength(4);
});
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(demos): Aave V3 + Uniswap V3 multi-Contract seed"
```

### Task H.3 — Status marker

- [ ] **Step 1: Status marker commit**

```bash
git commit --allow-empty -m "chore: Phase H status marker"
```

**Deliverables (Phase H):** Backfill works + idempotent; curated demos render multi-Contract UX.
**Exit (Phase H):** Backfill idempotency test green; seed test green. Test count = 691 + ~43 + ~4 new.

**REVIEW GATE #5 — Codex holistic review of PR 1 (Phases A–H).** This is the load-bearing review. Focus areas:

- Spec fidelity: every spec §3, §4, §5, §6, §7 directive represented in code.
- Idempotency invariant: spec §5.3.1 enforced at every persistence call site.
- BLOCKER fixes verified: §4.3 event-vs-async expression; §5.1.1 role-aware capture; §3.5 migration SQL physical correctness.
- Backfill idempotency: provably safe to re-run; handles partial-failure recovery.
- Graceful-degradation adapter: every read path tolerates a Scan with zero Contract rows.
- Test coverage: detector subtree coverage maintained at ≥85% per spec §14.
- Security: no new RPC URLs leak to client; no PII flows differ; new env vars (none) audited.

Findings → micro-commits before Phase I starts. BLOCKER + IMPORTANT must land; NICE_TO_HAVE may defer to Phase K (post-PR-2 holistic).

---

## §14 Phase I — PR 1 prep + manual smoke + production deploy (2 commits)

**Goal:** PR 1 opened, merged, deployed to production. Backfill script run manually against production DB. Soak window begins.

**Risk:** Production deploy of multi-Contract code with backfill not yet run = the graceful-degradation read path is the only thing keeping legacy scans rendering. If the adapter has a bug, historical scans render broken until backfill completes.
**Rollback:** Vercel one-click rollback to v0.2.0-plan-02 is always available.

### Task I.1 — PR 1 description + final gates

**Files:** none.

- [ ] **Step 1: Rebase onto latest `main`**

```bash
git fetch origin main
git rebase origin/main
```

- [ ] **Step 2: Final gates**

```bash
pnpm build
pnpm test
INTEGRATION_DB=1 pnpm test
LIVE_RPC=1 pnpm test  # optional but recommended — exercises real Aave V3 multi-Contract end-to-end
```

Preview URL smoke: submit a 4-Contract Aave V3 scan against the preview deploy. Verify Inngest dashboard shows the parallel fan-out (4 `scan.module.requested` events; 4 parallel waiters; 4 completion events; one final `scan.completed`).

Phase G deferred §7.4 work — ContractCard click-to-scroll/filter (Codex Review #5 NTH 1; see Phase G "Deferred from Phase G" note above) lands here. Add to the preview smoke:

- [ ] Click each of the 4 ContractCards on the rendered preview page; verify the click scrolls to (or filters) that Contract's `<FindingSection>`.
- [ ] Tab through the cards with keyboard only; verify focus order, visible focus ring, Enter/Space activation, and that screen readers announce the cards as interactive elements (button/link semantics).

- [ ] **Step 3: Open PR 1**

```bash
gh pr create \
  --base main \
  --head plan-03-execution-model \
  --title "Plan 03 PR 1 — Multi-Contract execution model + additive migration" \
  --body "$(cat <<'EOF'
## Summary

Implements Plan 03 PR 1 per spec (commit 0ebe7f8 on main).

- Phase A: Additive migration — Contract model + per-Contract relations + score field rename
- Phase B: Multi-Contract scan submission + validation rules (chain, max 20, primary-in-related)
- Phase C: Role-aware snapshot capture (spec BLOCKER 2 fix)
- Phase D: Inngest fan-out + parallel waitForEvent (spec BLOCKER 1 fix — event vs async)
- Phase E: Per-Contract execution + idempotency invariant (spec §5.3.1 IMPORTANT 3 fix)
- Phase F: Protocol composite — worst-grade-wins + averageContractScore + worstContractScore
- Phase G: Response shape + UI rewrite + proxy detect-and-warn + ProtocolGraphDisclaimer
- Phase H: Backfill script + Aave V3 + Uniswap V3 multi-Contract demos

## Soak window required before PR 2

After this PR merges + deploys:
1. Run `pnpm db:backfill-plan-03-contracts` against production
2. Verify every Scan has ≥1 Contract row
3. Verify at least one production multi-Contract Aave V3 demo scan completes end-to-end
4. THEN open PR 2 (tightening migration + fallback removal)

## Test plan

- [ ] pnpm build green
- [ ] pnpm test green (unit + component)
- [ ] INTEGRATION_DB=1 pnpm test green
- [ ] Vercel preview: submit 4-Contract Aave V3 scan → per-Contract grades + protocol composite
- [ ] Cross-scope isolation test verifies BLOCKER 1 fix
- [ ] Sibling-isolation test verifies IMPORTANT 3 fix
- [ ] Graceful-degradation adapter renders legacy single-Contract scans unchanged
EOF
)"
```

- [ ] **Step 4: Hand PR URL to Robert**

User reviews + merges manually. Do not auto-merge.

- [ ] **Step 5: Status marker**

```bash
git commit --allow-empty -m "chore: Phase I status marker"
```

### Phase I pre-seed — resolve Uniswap V3 slug collision (Phase H drift flag)

**Files:** none (one-time production DB operation, run before the Task I.2 curated-demo seed).

The Plan 03 curated-demo seed reassigns the `uniswap-v3-ethereum` Protocol's PRIMARY from Factory (`0x1F98431c8aD98523631AE4a59f267346ea31F984`) to SwapRouter (`0xe592427a0aece92de3edee1f18e0157c05861564`), keeping the same slug. `Protocol.slug` is `@unique` and the seed upserts on `(chain, primaryContractAddress)`, so against the existing Plan 02 production DB the seed hits a slug collision and fails.

Fresh DBs + dev/preview environments are unaffected (no pre-existing Factory row). This step is REQUIRED only for the production DB.

Before running the Plan 03 curated-demo seed in production (Task I.2):

- [ ] Dry-run the seed against a production DB snapshot (or staging clone) to confirm the collision reproduces
- [ ] Choose the remediation: EITHER delete the old Factory-keyed `uniswap-v3-ethereum` Protocol row, OR re-key its slug to a distinct value (e.g. `uniswap-v3-factory-ethereum`) so the new SwapRouter-primary Protocol can take the canonical slug
- [ ] Apply the chosen remediation as a documented one-time production step (script or manual SQL with a recorded rollback)
- [ ] Run the Plan 03 seed; confirm the `uniswap-v3-ethereum` slug now resolves to the SwapRouter primary
- [ ] Verify no orphaned Scan/Contract rows reference the deleted/re-keyed Protocol (if delete was chosen)

Tracked from the Phase H H.2 commit body (curated-demos drift flag) so the deploy doesn't hit this cold.

### Task I.2 — Production deploy + backfill + smoke

**Files:** none.

- [ ] **Step 1 (post-merge, on main): Confirm Vercel main build is green**

```bash
gh run list --branch main --limit 3
```

- [ ] **Step 2: Run backfill against production DB**

```bash
DATABASE_URL=$PRODUCTION_DATABASE_URL pnpm db:backfill-plan-03-contracts
```

Verify the log output: `Backfill complete: { backfilled: N, skipped: 0, errors: 0 }`. If any errors, **stop and investigate** — do not proceed to PR 2.

- [ ] **Step 3: Production multi-Contract Aave V3 smoke**

Submit the Aave V3 curated demo against production. Confirm:
- Scan completes COMPLETE.
- UI renders 4 ContractCards.
- Protocol composite A; worstContractScore + averageContractScore both populated.
- Inngest dashboard shows clean parallel fan-out.

- [ ] **Step 4: Begin soak window**

The soak window is open-ended — Robert decides when to proceed to PR 2 based on observed production behavior. Recommended minimum: 24 hours + one production multi-Contract scan.

**Deliverables (Phase I):** PR 1 merged + deployed; backfill complete; soak window open.
**Exit (Phase I):** Production multi-Contract scan green; soak window begins.

(No Codex review at I — review #5 was at H. Review #6 is at J after PR 2 is opened.)

---

## §15 Phase J — Soak verification + PR 2 (tightening migration + fallback removal) (3 commits)

**Goal:** After soak window passes, open PR 2 with the tightening migration and the removal of the PR 1 graceful-degradation adapter.

**Risk:** The tightening migration is the irreversible step. Defensive: verify the backfill is 100% complete before opening PR 2 (zero rows with `contractId IS NULL`).
**Rollback:** Manual SQL revert (drop new uniques, restore old `(scanId, module)` unique, set `contractId` columns nullable). Documented in `docs/deployment-env.md`.

### Task J.1 — Soak verification

**Files:** none.

- [ ] **Step 1: Verify zero null contractId rows in production**

```sql
SELECT
  (SELECT COUNT(*) FROM "ModuleRun" WHERE "contractId" IS NULL) AS module_run_nulls,
  (SELECT COUNT(*) FROM "GovernanceSnapshot" WHERE "contractId" IS NULL) AS snapshot_nulls,
  (SELECT COUNT(*) FROM "Finding" WHERE "contractId" IS NULL) AS finding_nulls;
```

All three must be 0. If non-zero, **stop and re-run the backfill** — do not proceed.

- [ ] **Step 2: Confirm soak smoke**

At least one production multi-Contract scan completed end-to-end since PR 1 deploy. Inngest dashboard shows no orphaned waiters or stuck retries.

### Task J.2 — Cut PR 2 worktree + tightening migration

**Files:**
- Create: `prisma/migrations/plan_03_tighten_contract_id_constraints/migration.sql`
- Modify: `src/lib/scan-response.ts` (remove graceful-degradation adapter)

- [ ] **Step 1: Cut worktree**

```bash
cd /Users/robertwils/Breakwater
git fetch origin main
git worktree add /Users/robertwils/breakwater-plan-03-pr2 -b plan-03-tighten-constraints origin/main
cd /Users/robertwils/breakwater-plan-03-pr2
```

- [ ] **Step 2: Author tightening migration per spec §3.5 PR 2 section**

```sql
-- ModuleRun
ALTER TABLE "ModuleRun" ALTER COLUMN "contractId" SET NOT NULL;
ALTER TABLE "ModuleRun" DROP CONSTRAINT "ModuleRun_scanId_module_key";
ALTER TABLE "ModuleRun" ADD CONSTRAINT "ModuleRun_scanId_module_contractId_key"
  UNIQUE ("scanId", "module", "contractId");

-- GovernanceSnapshot
ALTER TABLE "GovernanceSnapshot" ALTER COLUMN "contractId" SET NOT NULL;
ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_contractId_key"
  UNIQUE ("contractId");

-- Finding
ALTER TABLE "Finding" ALTER COLUMN "contractId" SET NOT NULL;
```

- [ ] **Step 3: Update Prisma schema to match (NOT NULL + new uniques)**

```bash
pnpm prisma migrate dev --create-only --name plan_03_tighten_contract_id_constraints
# Verify generated SQL matches the spec block above.
```

- [ ] **Step 4: Remove graceful-degradation adapter**

In `src/lib/scan-response.ts`, delete the legacy single-Contract synthesizer. All reads now go through `Scan.contracts[]` exclusively. Type tighten `contractId: string` (no longer `string | null`) on `ModuleRun`, `Finding`, `GovernanceSnapshot`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(migration): tighten contractId NOT NULL + remove PR 1 fallback adapter"
```

### Task J.3 — PR 2 opened + merged + deployed

**Files:** none.

- [ ] **Step 1: Final gates**

```bash
pnpm build
pnpm test
INTEGRATION_DB=1 pnpm test
```

- [ ] **Step 2: Open PR 2**

```bash
gh pr create \
  --base main \
  --head plan-03-tighten-constraints \
  --title "Plan 03 PR 2 — Tightening migration + fallback removal" \
  --body "$(cat <<'EOF'
## Summary

Plan 03 PR 2 per spec §3.5 PR 2 section.

- Tightening migration: NOT NULL + new unique constraints on ModuleRun / GovernanceSnapshot / Finding contractId
- Removal of PR 1 graceful-degradation adapter (all reads now contractId-keyed)

## Prerequisites verified

- [x] Backfill complete in production (zero null contractId rows in any affected table)
- [x] Soak window passed — at least one production multi-Contract scan completed end-to-end

## Test plan

- [ ] pnpm build green
- [ ] pnpm test green
- [ ] Tightening migration applies cleanly against a copy of production
- [ ] Post-deploy production smoke (multi-Contract Aave V3 demo)
EOF
)"
```

- [ ] **Step 3: Hand PR URL to Robert**

- [ ] **Step 4 (post-merge, on main): Post-deploy production smoke**

Submit a 4-Contract Aave V3 scan against production. Confirm everything still renders + grades correctly.

- [ ] **Step 5: Status marker**

```bash
git commit --allow-empty -m "chore: Phase J status marker"
```

**Deliverables (Phase J):** PR 2 merged + deployed; all reads contractId-keyed.
**Exit (Phase J):** Tightening migration applied in production cleanly; post-deploy smoke green.

**REVIEW GATE #6 — Codex review of tightening migration + adapter removal.** Small surface; the goal is to catch any stray `contractId: null` tolerance in code paths that should now be tightened. Findings → micro-commits before close.

---

## §16 Phase K — Holistic A–K review + close + tag (3 commits)

**Goal:** Final holistic Codex review on the full Plan 03 surface. NOTES.md updated. v0.3.0-plan-03 tagged. Both worktrees cleaned up.

### Task K.1 — Codex holistic review #7

**Files:** determined by review findings.

- [ ] **Step 1: Request Codex final review against `main`**

Focus areas:
- Spec fidelity at the holistic level: every spec §3 + §4 + §5 + §6 + §7 directive landed.
- Plan 03 spec §14 hard exit criteria all met.
- No remaining `// PR 1 graceful degradation` markers in the code (PR 2 should have removed them all).
- No `contractId: string | null` in places that should be `contractId: string`.
- Test count: from 691 baseline to ~750+.
- Detector subtree coverage maintained at ≥85%.

- [ ] **Step 2: Remediation commits**

Each finding → one micro-commit on `main` (or via a small follow-up PR if surface is non-trivial).

### Task K.2 — Docs update + NOTES.md handoff

**Files:**
- Modify: `NOTES.md`, `README.md`

- [ ] **Step 1: Update NOTES.md**

Close "Plan 03 — In progress" with a "Plan 03 — Completed" section mirroring Plan 02's format:

```markdown
## Plan 03 — Completed

Plan 03 shipped the multi-Contract chassis on <date>. See
docs/superpowers/plans/2026-05-19-breakwater-plan-03-implementation.md
for phase breakdown.

Scope:
- User-supplied multi-Contract scanning (≤20 Contracts per scan)
- Role-aware snapshot capture (DECLARED_MULTISIG, TIMELOCK, PROXY_IMPLEMENTATION)
- Parallel Inngest fan-out via Promise.all over per-Contract waitForEvent
- Per-Contract grades + protocol composite (worst-grade-wins + average + worst score)
- Proxy detect-and-warn UI affordance
- isPartialGrade (detector-error) + isPartialCoverage (graph) confidence signals
- Aave V3 + Uniswap V3 multi-Contract curated demos

Migration strategy: two PRs / two deploys (additive + backfill in PR 1, tightening in PR 2).

New deferrals: see "Plan 04 — Deferred items" below.
```

Plan 04 backlog items handed off:
- Automatic graph discovery (DeFiLlama, Etherscan related-addresses, on-chain heuristics)
- GOV-007 (bridge security) + GOV-008 (cross-chain admin consistency) graph-aware detectors
- PROXY_IMPLEMENTATION auto-promotion
- Multi-chain scanning (Arbitrum, Optimism, Base, Polygon)
- Compound v3 / MakerDAO third curated demo (if not shipped in Phase H stretch)

### Task K.3 — Tag + worktree cleanup

- [ ] **Step 1: Tag v0.3.0-plan-03**

```bash
git checkout main
git pull
git tag -a v0.3.0-plan-03 -m "Plan 03 — Protocol Graph (user-supplied)"
git push origin v0.3.0-plan-03
```

- [ ] **Step 2: Remove worktrees + local branches**

```bash
git worktree remove /Users/robertwils/breakwater-plan-03
git worktree remove /Users/robertwils/breakwater-plan-03-pr2
git branch -d plan-03-execution-model
git branch -d plan-03-tighten-constraints
```

- [ ] **Step 3: Commit (docs only — no code change)**

```bash
git add NOTES.md README.md
git commit -m "docs: Plan 03 completion notes + Plan 04 backlog handoff"
git push origin main
```

- [ ] **Step 4: Status marker**

```bash
git commit --allow-empty -m "chore: Plan 03 — Completed"
git push origin main
```

**Deliverables (Phase K):** v0.3.0-plan-03 tagged, NOTES.md updated, worktrees clean.
**Exit (Plan 03):** Spec §14 hard criteria all met; v0.3.0 on main; Plan 04 backlog handed off.

---

## §17 Exit criteria (spec §14 hard)

- [ ] Multi-Contract scan submission validates per spec §4.1 (chain, max 20, primary-in-related rule) — Phase B.
- [ ] Role-aware snapshot capture covers all 7 ContractRole branches per spec §5.1.1 — Phase C.
- [ ] Inngest parallel fan-out via Promise.all + compound `event` vs `async` waitForEvent expression — Phase D.
- [ ] Cross-scope isolation integration test: sibling scan / different module / different contractId do NOT cross-resume waiters — Phase D.4.
- [ ] Per-Contract idempotency invariant: retrying one Contract does NOT delete sibling findings — Phase E.3.
- [ ] Protocol composite computed per spec §6.2 (worst-grade-wins + averageContractScore + worstContractScore with tie-breaking) — Phase F.
- [ ] `isPartialGrade` + `isPartialCoverage` predicates per spec §6.3 — Phase F.
- [ ] Aave V3 multi-Contract curated demo scan completes COMPLETE with composite A — Phase I.2.
- [ ] Two-PR migration strategy executed (PR 1 additive + backfill, PR 2 tightening) — Phases A/H/I/J.
- [ ] Backfill script idempotent + tested — Phase H.
- [ ] All 691 Plan 02 tests still green; test count grows to ~750+ — every phase.
- [ ] Detector subtree coverage ≥ 85% — maintained from Plan 02.
- [ ] ProtocolGraphDisclaimer rewrite shipped (multi + single variants) — Phase G.4.
- [ ] Proxy detect-and-warn affordance shipped (UI on ContractCard) — Phase G.2.
- [ ] Codex Phase A–I + J review touchpoints all addressed — review gates #1–#7.

## §18 Exit criteria (spec §15 soft)

- [ ] Average 5-Contract scan execution time < 60 s end-to-end.
- [ ] Five real Ethereum protocols backfilled as curated multi-contract demos (Plan 03 ships 2 — Aave V3 + Uniswap V3; stretch adds Compound or MakerDAO + Lido).
- [ ] UI A11y score ≥ 90 on /scan/[id] maintained.
- [ ] No regression in Railway integration-test flake rate vs. Plan 02 baseline.

---

## §19 RPC budget + Inngest concurrency policy (resolves spec §17.1)

### §19.1 Per-Contract RPC math

A `captureGovernanceSnapshot` call against one Contract (with role-aware routing per Phase C) makes the following RPC primitives, mostly batched via multicall:

| Step | RPC calls | Notes |
|---|---|---|
| `getBlockNumber` | 1 | Pin for consistent reads |
| `checkIsContract` (eth_getCode) | 1 | H.8 gate |
| `detectGovernor` (multicall) | 1 | Batched probe for Bravo + OZ + Compound variants |
| `detectTimelock` (multicall) | 1 | Batched probe for getMinDelay + delay + admin |
| `detectSafe` (Safe API HTTP) | 0 RPC + 1 HTTP | External — not on the viem rate-limit budget |
| `detectProxy` (storage reads + getCode) | 2–3 | EIP-1967 slot read + admin read + admin getCode |
| `timelockAdminIsContract` / `proxyAdminIsContract` (eth_getCode) | 2 | One per admin |
| `fetchContractAbi` (Etherscan HTTP) | 0 RPC + 1 HTTP | External |

**Per-Contract total: ~8 RPC calls + 2 HTTP calls.** Conservative upper bound: 12 RPC.

### §19.2 20-Contract worst-case

A 20-Contract scan with full role-applicable fan-out: **~160–240 RPC calls** total. Distributed across the parallel fan-out window:

- If all 20 Contracts run concurrently: the burst is ~160 RPC in <2 seconds → 80+ req/s peak.
- The public RPC endpoints Plan 02 uses (Ankr free tier + Cloudflare ETH RPC) tolerate ~30 req/s sustained per endpoint; the viem `fallback` transport (Ankr → Cloudflare) effectively doubles that to ~60 req/s + retry-with-backoff for transient 429s.
- A 20-Contract scan at ~80 req/s peak will trigger some rate-limit refusals; viem's fallback transport retries with exponential backoff. Expected wall-time penalty: 10–30 seconds added to a naive 60 second baseline → **90 seconds worst-case for 20 Contracts**.

This puts a 20-Contract scan outside the spec §15 soft target (60 s for a 5-Contract scan; 20-Contract is unspecified). The 5-Contract target is comfortably met (~30 s wall-time).

### §19.3 Inngest concurrency cap

To bound the RPC burst, `execute-governance-module` gets a **function-level concurrency limit of 10**:

```typescript
export const executeGovernanceModule = inngest.createFunction(
  {
    id: "execute-governance-module",
    name: "Execute Governance Module",
    retries: 2,
    concurrency: { limit: 10 },   // NEW (Plan 03)
  },
  // …
);
```

This caps the simultaneous in-flight `execute-governance-module` invocations across the entire Inngest workspace (all scans combined) to 10. Effects:

- A single 20-Contract scan executes at most 10 Contracts in parallel; the remaining 10 queue behind. Wall-time becomes ~2× the 10-Contract baseline ≈ 60 seconds (plus rate-limit drag) ≈ 75–90 seconds.
- Two concurrent 20-Contract scans share the 10 cap: each sees roughly half the throughput. Acceptable for MVP scale; revisit when scan volume warrants per-scan concurrency limits (Inngest 3.x supports `concurrency.key` to scope the limit to e.g. `event.data.scanId`).
- A 5-Contract scan never hits the cap and completes in ~30 s wall-time, comfortably meeting the spec §15 soft target.

### §19.4 Recommendation for spec §17.1 close-out

The MAX_RELATED_CONTRACTS = 20 cap holds for MVP. Two things to watch in production:

1. **Wall-time on 20-Contract scans.** If 90 s feels too slow in real submissions, drop the cap to 10 in `src/lib/config.ts` (one-line change) and revisit when auto-discovery (Plan 04) surfaces typical graph sizes.
2. **Free-tier Alchemy / Ankr quota.** If observed in production, switching to a paid RPC provider (Alchemy growth tier) lifts the 30 req/s ceiling well past Plan 03's worst case. Plan 04 may want this anyway for cross-chain support.

Neither change is required to ship Plan 03 against the spec.

---

## §20 `isPartialGrade` reason codes — implementation choice (resolves spec §14 implementation deferral)

The spec §6.3 names two clauses for the partial-grade signal:
1. **Detector-error degradation** (Plan 02 I.1 FIX 3 carryover) — some detectors crashed inside a COMPLETE module.
2. **Partial graph coverage** (Plan 03 extension) — ≥1 graded Contract coexists with ≥1 FAILED Contract.

The implementation question deferred from the spec: surface this as (a) one `isPartialGrade` flag + a `Scan.partialReasons[]` enum array, or (b) split into two booleans (`isPartialGrade` + `isPartialCoverage`).

**Choice: option (b) — two booleans on the Scan model.**

```prisma
model Scan {
  // existing fields…
  isPartialGrade    Boolean @default(false)   // detector-error clause (Plan 02 carryover)
  isPartialCoverage Boolean @default(false)   // graph-coverage clause (Plan 03 extension)
}
```

### Rationale

- **Backward compatibility.** `isPartialGrade` already exists on the Plan 02 schema (`Scan.isPartialGrade` Boolean column, written by I.1 FIX 3). Preserving its semantic (detector-error only) and adding a separate `isPartialCoverage` field avoids re-encoding the meaning of an existing column — no data migration of historical Plan 02 scans needed.
- **UI affordance simplicity.** Two booleans render straightforwardly: one "Partial detector coverage" tooltip + one "Partial graph coverage" tooltip. The user sees at most two affordances; the copy explains each.
- **No enum migration.** Option (a) would require introducing a `PartialReason` Postgres enum and a JSON-array column, plus migration logic to translate the Plan 02 `isPartialGrade: true` into `partialReasons: ["detector_error"]`. Higher migration risk; no clear UX benefit.
- **Extensibility.** Future plans that want a third clause (e.g., Plan 04 graph-aware detector partial run) can add a third boolean (`isPartialDiscovery`?) without re-engineering the schema. Three booleans is still scrutable; a six-element enum array would be less so.

### Schema delta

Phase A's migration includes:
```sql
ALTER TABLE "Scan" ADD COLUMN "isPartialCoverage" BOOLEAN NOT NULL DEFAULT false;
```

### Persistence

`markComplete` (Phase F.2) writes both fields per the `rollupProtocolComposite` output (§11 Phase F task F.1). Plan 02 historical scans land with `isPartialCoverage: false` (no graph coverage signal applies to single-Contract scans).

### Response shape

`ScanResponse` carries both fields (per Phase A.3 stub). UI renders both tooltips when each is true.

---

## §21 Self-review checklist (complete before starting Phase A)

- [x] Every spec section has at least one task: §3 (A + H), §4 (B + D), §5 (C + E), §6 (F), §7 (G), §8 (H), §9 (none — no new external deps), §10 (testing distributed across all phases), §11 (none new), §12 (I + J), §13 (handled by Phase I PR description), §14 (§17 below), §15 (§18 below), §16 (NOTES.md handoff in K), §17.x (§19 + §20 here).
- [x] Two-PR strategy explicit: PR 1 in Phase I, PR 2 in Phase J.
- [x] BLOCKER fixes each have a dedicated phase: §4.3 expression syntax → Phase D; §5.1.1 role-aware capture → Phase C; §3.5 migration SQL → Phase A; two-PR strategy → Phases I + J.
- [x] IMPORTANT 3 (per-Contract idempotency) has a dedicated test (E.3) per spec §14.
- [x] BLOCKER 1 (waitForEvent expression) has a dedicated cross-scope isolation test (D.4) per spec §14.
- [x] Codex review cadence: 7 reviews (A, C, D, E, H, J, K), denser than Plan 02's single holistic — justified by the BLOCKER count in the spec history.
- [x] Every phase ends in a green state (`pnpm build && pnpm test` pass).
- [x] Every phase has a risk callout + rollback.
- [x] No spec items became unworkable during plan authoring — see Plan-spec deltas section below.

### §21.1 Plan-spec deltas (any spec items unworkable mid-plan)

**None identified during plan authoring.** Every spec directive is realizable as specified. The two close-call areas:

- **§5.1.1 role-aware capture sibling-multisig hint.** The spec §5.1.1 table row for `PRIMARY` says "only if `declaredMultisigCandidate` supplied" — the plan source for that candidate is the sibling Contract list (read by `executeGovernanceModule` from the scan's Contract rows where `role === DECLARED_MULTISIG`). This adds a small DB read at the start of each PRIMARY's capture call. Not a spec issue but documented in Phase E.1 step 2.
- **§7.3 status endpoint nested shape.** Plan 02's `useScanPolling` returned a flat `polledModules` array; Plan 03's status endpoint shape is per-Contract nested. The hook signature changes are mechanical but worth highlighting in code review (Phase G.5). Not a spec issue; the spec §7.3 example shape is authoritative.

If anything surfaces during execution that *was* unworkable, raise it with Robert via a separate commit on `main` (spec patch) and rebase the worktree onto it.

---

## §22 Revision log

Execution-time changes to this plan. The spec on `main` is frozen at commit `0ebe7f8`; if the spec needs to change mid-implementation, open a separate commit against `main` and run it through Codex review first.

(empty — populated during execution)
