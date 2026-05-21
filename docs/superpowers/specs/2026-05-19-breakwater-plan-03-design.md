# Breakwater Plan 03 — Protocol Graph (user-supplied)

**Status:** Draft for review
**Supersedes:** Plan 02 dispatcher + Governance module (merged v0.2.0-plan-02)
**Targets:** Multi-contract scanning chassis on Ethereum mainnet; user supplies the graph

---

## §1 Plan overview

### §1.1 Goals

Plan 03 broadens the scan object from "one core contract" to "a user-supplied set of related contracts" — a protocol's primary contract plus its proxy implementations, declared multisigs, declared bridge endpoints, related token contracts, and so on. The existing six governance detectors run against each contract individually; per-contract grades roll up into a protocol-level composite. The UI surfaces both: which contracts were scanned, what each one's grade is, and how they aggregate.

The product assertion this validates: *"Breakwater can express a protocol as a graph of related contracts and grade each one against the existing governance heuristics."* Plan 03 ships the multi-contract chassis. The auto-discovery work (DeFiLlama lookups, Etherscan related-addresses, on-chain heuristic walking) is deferred to Plan 04 once the chassis is proven.

This is deliberately the *user-supplied* version of the Protocol Graph idea. The user types the related addresses; we don't infer them. That is a real product limitation — but it gates auto-discovery on a foundation that's already been validated end-to-end, rather than landing two unknowns in one plan.

### §1.2 Non-goals

The following are explicitly out of scope for Plan 03 and deferred to Plan 04+:

- **Automatic graph discovery.** No DeFiLlama registry lookup, no Etherscan related-addresses scraping, no on-chain storage-slot scanning for related addresses, no bytecode-pattern matching for bridge/OFT/token-contract classification. Plan 04 builds these on top of the chassis Plan 03 ships.
- **New graph-aware detectors.** GOV-007 (bridge security) and GOV-008 (cross-chain admin consistency) referenced in the Plan 02 NOTES.md backlog are graph-aware (they compare across contracts) and depend on the Plan 03 chassis. They land in Plan 04.
- **Multi-chain scanning.** Plan 03 stays Ethereum-only. Cross-chain deployment references can be *recorded* (the user names a cross-chain twin in a JSON metadata field), but the scanner does not connect to other chains. Multi-chain RPC infrastructure + per-chain detector configuration is a future plan.
- **Solana governance detection.** Same exclusion as Plan 02.
- **Real-time graph monitoring** (re-scan on related-contract changes, alerts when a new admin appears on a related contract). Plan 07+.
- **Public sharing of multi-contract scan results.** Plan 07+.

### §1.3 Carry-over from Plan 02 backlog

These items resolve within Plan 03 scope:

- **`waitForEvent` multi-module match** (Plan 02 NOTES.md L67, Codex Phase C NICE_TO_HAVE). Plan 02's `executeScan.step.waitForEvent` matches on `data.scanId` only — tolerable for the single-module skeleton. Plan 03's fan-out (one event per `(module, contractAddress)`) forces tightening to a compound match. See §4.3.
- **`Protocol.extraContractAddresses` dead-data activation** (observed during Plan 03 recon). The schema field has accepted user input since Plan 01 and is persisted by `submitScan`, but no module or detector reads it. Plan 03 either activates it end-to-end or supersedes it with the new Contract model; see §3.

Items explicitly deferred to Plan 04+:

- Auto-discovery, GOV-007/008, multi-chain — see §1.2 above.
- The Plan 02 `IMPLEMENTED_MODULES` set still contains only `GOVERNANCE`; ORACLE / SIGNER / FRONTEND remain SKIPPED placeholders. Plan 03 does not implement these modules — it builds the graph chassis that future-module work can lean on.

---

## §2 Background motivation

Plan 02 manual smoke surfaced the framing question: a clean `A` grade on a Uniswap V3 SwapRouter scan describes *that one router contract's* governance posture. It does not describe Uniswap as a protocol. Real-world DeFi protocols expose surface area across many contracts:

- A **proxy** points at an implementation. Plan 02 already detects this for the submitted contract (EIP-1967 transparent + EIP-1822 UUPS + custom). But the implementation contract itself has its own governance surface — and Plan 02 doesn't grade it.
- A protocol's **declared multisig** is read by Plan 02 D.3c (Safe Transaction Service). Plan 02 treats it as an attribute of the core contract, not as its own scannable subject. A 1-of-2 multisig with admin authority over the core contract is the same risk shape as a 1-of-2 multisig that *is* the core contract.
- A **bridge endpoint** (LayerZero OFT, Wormhole adapter) lives at a separate address with its own admin keys. Plan 02 doesn't see bridges at all.
- An **upgrade authority contract** (timelock, governor proxy, ProxyAdmin) is often a separate address with its own multisig owner — and its own admin EOA.
- **Cross-chain twins** of the core contract exist on L2s. Their admin structure can diverge from the L1 contract's. Plan 03 does not scan them but does record their existence.

The simplest defensible chassis: let the user submit the set of contracts that make up the protocol; scan each independently with the existing detectors; surface per-contract findings and per-contract grades; aggregate into a protocol composite. Auto-discovery is a separate, harder problem; Plan 04 owns it.

---

## §3 Data model changes

### §3.1 New `Contract` model

Plan 03 introduces a first-class `Contract` model representing one scannable address within a scan. Every Scan has at least one Contract row (the primary); Scans with user-supplied related addresses have additional Contract rows.

```prisma
enum ContractRole {
  PRIMARY              // The user-submitted core contract.
  PROXY_IMPLEMENTATION // Detected impl of a proxy in the graph.
  DECLARED_MULTISIG    // User-supplied multisig with admin authority.
  DECLARED_BRIDGE      // User-supplied bridge endpoint.
  TOKEN_CONTRACT       // User-supplied related ERC-20 / token.
  TIMELOCK             // User-supplied or detected timelock.
  RELATED              // User-supplied with no specific role tag.
}

model Contract {
  id              String        @id @default(cuid())
  scanId          String
  scan            Scan          @relation(fields: [scanId], references: [id], onDelete: Cascade)
  address         String        // Lowercased, normalized per chain.
  chain           Chain         // Plan 03 = ETHEREUM only; field exists for Plan 04+ cross-chain.
  role            ContractRole
  /**
   * User-supplied notes / role hint. Free-form; not detector input.
   * Useful for "Aave V3 Pool" / "AaveGovernanceV2" UX labelling.
   */
  label           String?
  /**
   * Optional cross-chain twin reference (recorded, not scanned in Plan 03).
   * Shape: { chain: string, address: string }[]. Descriptive only.
   */
  crossChainTwins Json          @default("[]")
  isPrimary       Boolean       @default(false)
  createdAt       DateTime      @default(now())

  /**
   * Per-Contract composite. Computed by `markComplete` (§4.5) using the
   * Plan 02 spec §5.3 composite algorithm applied to this Contract's
   * findings only. Null until the Contract's ModuleRuns finalise.
   */
  compositeScore  Int?
  compositeGrade  Grade?
  /**
   * True when at least one of this Contract's COMPLETE ModuleRuns had
   * `errorDetectorCount > 0` — i.e., a detector that should have run
   * crashed. Same semantics as Plan 02 I.1 FIX 3, scoped per-Contract.
   */
  isPartialGrade  Boolean       @default(false)

  governanceSnapshot GovernanceSnapshot?
  moduleRuns         ModuleRun[]
  findings           Finding[]

  @@unique([scanId, address])
  @@index([scanId])
}
```

Each Contract row is the unit of scanning. `governanceSnapshot`, `moduleRuns`, and `findings` relations move *from Scan to Contract* — a Scan now aggregates Contracts, which aggregate ModuleRuns + findings.

### §3.2 ModuleRun + GovernanceSnapshot + Finding — composite-key changes

The Plan 02 schema constraints `ModuleRun @@unique([scanId, module])` and `GovernanceSnapshot.scanId @unique` lock to one row per `(scan, module)` and one snapshot per scan. Plan 03 lifts both.

`ModuleRun` gains `contractId` and the unique constraint widens:

```prisma
model ModuleRun {
  id               String       @id @default(cuid())
  scanId           String
  scan             Scan         @relation(fields: [scanId], references: [id])
  contractId       String                                    // NEW (Plan 03)
  contract         Contract     @relation(fields: [contractId], references: [id])
  module           ModuleName
  // … other fields unchanged from Plan 02 …
  @@unique([scanId, module, contractId])                     // CHANGED
  @@index([scanId, module])
}
```

`GovernanceSnapshot` rebases from Scan to Contract:

```prisma
model GovernanceSnapshot {
  id          String   @id @default(cuid())
  contractId  String   @unique                               // CHANGED (was scanId)
  contract    Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  // … other fields unchanged from Plan 02 …
}
```

`Finding` gains a `contractId` so each finding knows which contract it applies to:

```prisma
model Finding {
  id          String     @id @default(cuid())
  scanId      String                                         // kept for scan-scoped queries
  scan        Scan       @relation(fields: [scanId], references: [id])
  contractId  String                                         // NEW (Plan 03)
  contract    Contract   @relation(fields: [contractId], references: [id])
  moduleRunId String
  moduleRun   ModuleRun  @relation(fields: [moduleRunId], references: [id])
  // … rest unchanged …
  @@index([scanId, module])
  @@index([contractId])
}
```

### §3.3 Scan — protocol-composite fields stay; per-Contract grade lives on Contract

`Scan.compositeScore` and `Scan.compositeGrade` remain on the Scan row — they describe the **protocol-level** composite computed by the rollup logic in §6.2. The **per-Contract** equivalents (`compositeScore`, `compositeGrade`, `isPartialGrade`) are declared on the Contract model in §3.1 above and persisted by `markComplete` (§4.5) using the Plan 02 spec §5.3 composite algorithm applied to that Contract's findings.

`Scan.isPartialGrade` retains its Plan 02 I.1 FIX 3 meaning ("a detector that should have run crashed") but now aggregates across all Contracts in the scan, with the extension described in §6.3 (FAILED Contracts in a partially-complete graph also trigger the flag).

### §3.4 `Protocol.extraContractAddresses` — superseded

The Plan 01 `Protocol.extraContractAddresses Json @default("[]")` field was wired through `submitScan` but never read by any detector. Plan 03 supersedes it: the Contract model is now the authoritative representation of per-scan related contracts.

- **For new (Plan 03+) scans:** `submitScan` no longer writes `Protocol.extraContractAddresses`. Related contracts go into Contract rows instead (§4.2). The column is kept on the schema for backward-compat reads from pre-Plan-03 Protocol rows but is dead data going forward.

- **For historical (pre-Plan-03) scans:** the backfill described in §3.5 step 7 creates exactly one Contract row per historical Scan (role `PRIMARY`, derived from `Scan.protocol.primaryContractAddress`), so every Scan in the database ends up with at least one Contract row — including historical scans. "Plan-02-single-contract-shape" therefore means **n=1 in the Contract table**, not bypassing the new model. The new NOT NULL `contractId` constraints on ModuleRun / GovernanceSnapshot / Finding require this.

- **What backfill does NOT do:** historical `Protocol.extraContractAddresses` arrays are NOT auto-promoted into additional Contract rows. If a pre-Plan-03 Protocol row had `["0xAAA", "0xBBB"]` in `extraContractAddresses`, the backfilled scan still gets only one Contract row (the PRIMARY). Auto-promoting historical extras to Contract rows would require role inference (which role does `0xAAA` have?) and is Plan 04 territory.

The net effect: every Scan in the DB has ≥1 Contract row after backfill, but only Plan-03-era scans have >1.

### §3.5 Migrations

One additive Prisma migration, planned name `plan_03_contract_model_and_per_contract_runs`:

1. `CREATE TABLE "Contract"` with the fields from §3.1.
2. `ALTER TABLE "ModuleRun" ADD COLUMN "contractId"` (nullable initially for migration safety, then backfilled, then `NOT NULL` in a follow-up migration if data exists).
3. `ALTER TABLE "GovernanceSnapshot" ADD COLUMN "contractId"` (same pattern).
4. `ALTER TABLE "Finding" ADD COLUMN "contractId"`.
5. Drop the old `@@unique([scanId, module])` on `ModuleRun`; add the new `@@unique([scanId, module, contractId])`.
6. Drop `GovernanceSnapshot.scanId @unique`; add `GovernanceSnapshot.contractId @unique`.
7. Backfill: for every existing pre-Plan-03 Scan row, create exactly one Contract row from `Scan.protocol.primaryContractAddress` (role: `PRIMARY`, `isPrimary: true`), and update the corresponding ModuleRun / GovernanceSnapshot / Finding rows with that `contractId`.

**Backfill is REQUIRED before the new NOT NULL constraints land,** otherwise existing scans break. Plan 03 plans to do this in two migrations: (a) additive with nullable `contractId` + backfill; (b) follow-up that adds the NOT NULL + new unique constraints once the backfill is verified. This matches the Plan 02 B.3 precedent (additive schema land first, constraint tightening later).

Plan 03 confirms no destructive operations beyond the constraint-tightening migration: column drops, table drops, type changes, or RENAME operations are all avoided. Code-only rollback to Plan 02 stays possible because the Plan 02 schema is a strict subset of the post-Plan-03 schema during the additive-only phase. After the NOT NULL tightening, rollback requires migration-down (which Plan 03 ships as a documented manual SQL procedure — not as a Prisma down-migration, since Prisma's migration tooling is forward-only).

---

## §4 Dispatcher & orchestration

### §4.1 Scan submission

The `ScanSubmissionSchema` (`src/lib/schemas/scan.ts`) already accepts `extraContractAddresses` and `multisigs` arrays — Plan 03 activates them end-to-end. The schema is extended to accept optional per-contract metadata:

```typescript
const RelatedContractSchema = z.object({
  address: z.string(),
  role: z.enum([
    "PROXY_IMPLEMENTATION",
    "DECLARED_MULTISIG",
    "DECLARED_BRIDGE",
    "TOKEN_CONTRACT",
    "TIMELOCK",
    "RELATED",
  ]).optional().default("RELATED"),
  label: z.string().max(80).optional(),
  crossChainTwins: z.array(z.object({
    chain: z.string(),
    address: z.string(),
  })).optional().default([]),
});

export const ScanSubmissionSchema = z.object({
  chain: Chain,
  primaryContractAddress: z.string().min(1),
  /**
   * Plan 03: replaces the dead-data `extraContractAddresses` field. The
   * form accepts either the legacy plain-string array OR this richer
   * shape; the submission layer normalises to the new shape.
   */
  relatedContracts: z.array(RelatedContractSchema).optional().default([]),
  /** Legacy shape — kept for backward-compat with Plan 02 API clients. */
  extraContractAddresses: z.array(z.string()).optional().default([]),
  multisigs: z.array(z.string()).optional().default([]),
  modulesEnabled: z.array(ModuleName).min(1).optional().default([…]),
  submittedEmail: z.string().email().optional(),
  domain: z.string().optional(),
});
```

**Validation rules:**

- **Max related contracts per scan: 20.** Exceeds → 400 with `too_many_related_contracts`. The cap is intentionally tight for Plan 03 — a graph of 5–10 contracts covers most real protocols; 20 leaves headroom; 50+ scans would dominate RPC budgets and execution time. Plan 04+ can revisit when auto-discovery surfaces graphs that genuinely exceed 20. The cap is implemented as a named constant (`MAX_RELATED_CONTRACTS` in `src/lib/config.ts` or equivalent module) referenced by the zod schema's `.max()` validator and by any UI affordance that wants to surface the limit, so future plans can revisit the value in one place. The cap is **product policy, not deployment policy** — deliberately NOT a runtime env var: a single canonical value across environments avoids per-deployment drift.
- **Per-address validation:** each address must pass the same `isValidAddress(chain, addr)` check that primary uses today. Invalid → 400 with the specific index + field path (consistent with Plan 02's existing error shape).
- **Deduplication:** if `primaryContractAddress` also appears in `relatedContracts`, drop the duplicate (keep the primary). If two related entries share an address, drop the second; emit no error.
- **Primary cannot appear under a non-PRIMARY role.** If user submits `primary: 0xAAA` and `relatedContracts: [{address: 0xAAA, role: DECLARED_MULTISIG}]`, the submission layer treats this as a misconfiguration → 400 with `primary_address_in_related`.

### §4.2 Scan creation

The `submitScan` function expands inside its existing transaction to create one Contract row per submitted contract:

1. Create Scan row (unchanged).
2. Create Contract row for `primaryContractAddress` (`role: PRIMARY`, `isPrimary: true`).
3. For each entry in `relatedContracts`: create a Contract row with the specified role + label + crossChainTwins.
4. For each `(contract, module)` pair: create one ModuleRun row, status QUEUED if `module` is implemented AND `contract.role` is in the module's applicable-roles set; otherwise SKIPPED with errorMessage following the Plan 02 H.6 priority order (`module_disabled_by_user` → `module_not_implemented` → `role_not_applicable_to_module` → `domain_required`).

**Applicable-roles per module (Plan 03):**

| Module | Applicable Contract roles | Notes |
|---|---|---|
| GOVERNANCE | PRIMARY, PROXY_IMPLEMENTATION, DECLARED_MULTISIG, TIMELOCK, RELATED | Skip TOKEN_CONTRACT (token contracts have ERC-20 surface, not governance surface) and DECLARED_BRIDGE (bridge endpoints get GOV-007 in Plan 04). |
| ORACLE / SIGNER / FRONTEND | (still not implemented; entire module SKIPPED per H.6) | — |

The role-applicability gate keeps detector runs scoped to where they make sense — running the timelock detector against a token contract is wasted RPC budget and produces noise findings.

`Protocol.extraContractAddresses` is no longer written by new scans (§3.4).

### §4.3 Inngest fan-out

**Event payload changes** (`src/lib/inngest/client.ts`):

```typescript
export type ScanModuleRequestedEventData = {
  scanId: string;
  module: ModuleName;
  contractId: string;       // NEW (Plan 03)
  contractAddress: string;  // NEW — denormalised for log readability
};

export type ScanModuleCompletedEventData = {
  scanId: string;
  module: ModuleName;
  contractId: string;       // NEW
  contractAddress: string;  // NEW
  status: ModuleStatus;
  findingsCount: number;
  grade: string | null;
  executionMs: number;
};
```

`ScanCompletedEventData` is unchanged — the scan-level composite remains the public terminal event.

**`executeScan` fan-out:**

1. Load the Scan with its Contract list.
2. For each Contract whose ModuleRun is QUEUED, prepare one `scan.module.requested` event with the `(scanId, module, contractId, contractAddress)` tuple. Emit all of them in a **single `step.sendEvent` call** (Inngest's API accepts an array; this is the idiomatic batch-emit) so the dispatch itself is one durable step, not N.
3. Wait for `N × M` `scan.module.completed` events (N Contracts × M implemented modules) — Plan 03 ships M=1 (GOVERNANCE only), so the fan-out is `N` events. The waits run **in parallel** via `Promise.all` over `step.waitForEvent` calls. Inngest 3.x treats each `step.waitForEvent` as its own durable step; wrapping them in `Promise.all` is the idiomatic concurrent-wait pattern (the same shape used for parallel `step.run` calls). Each wait has its own 5-minute timeout that runs concurrently with the others, so the **scan-level wall-time cap is ~5 minutes**, not N × 5 minutes:

   ```typescript
   // Pseudocode in the spec — actual implementation lives in the plan.
   await Promise.all(
     contractIds.map((contractId) =>
       step.waitForEvent(`wait-${module}-${contractId}`, {
         event: "scan.module.completed",
         if: `event.data.scanId == '${scanId}' && event.data.module == '${module}' && event.data.contractId == '${contractId}'`,
         timeout: "5m",
       }),
     ),
   );
   ```

   The compound `if` filter (Inngest's expression syntax) replaces the Plan 02 `match: "data.scanId"` single-field match — this closes NOTES.md L67. Each waitForEvent step is uniquely named per `(module, contractId)` so retries don't cross-resume across siblings.

4. After all waits resolve (or timeout — handled per-wait in §4.4), call `markComplete` (§4.5).

**Orphan / late events.** Inngest's `step.waitForEvent` matches incoming `scan.module.completed` events against the `if` expression at the time the event arrives. Events that match no active wait are **not queued for later matching** — they're dropped from the perspective of this function instance once no active waiter consumes them. Late completion events (e.g., a `scan.module.completed` that arrives after the per-wait 5-minute timeout has already fired and the `mark-module-timeout` step has written the ModuleRun row to FAILED) therefore do not retroactively affect the finalised scan state. The race between `mark-module-timeout` and a delayed late completion is rendered safe by the existing Plan 02 idempotency machinery:

- `markModuleComplete` uses a compare-and-set on `status: "RUNNING"`. If the timeout step fired first and wrote FAILED, the late completion's `markModuleComplete` call finds no row in RUNNING, updates zero rows, and `finalized` returns `false` — the F.5 I1 emit-gate then skips the secondary `scan.module.completed` re-emission.
- `mark-module-timeout` uses a status filter (`where: { status: { in: ["QUEUED", "RUNNING"] } }`). If a late completion fired first and wrote the ModuleRun to COMPLETE, the timeout step's `updateMany` matches zero rows and is a no-op.

Whichever fires first wins; the second is idempotent against the now-terminal row. This is not a Plan 03 invention — it's the H.5/F.5 machinery applied to the per-contract dimension.

### §4.4 Per-wait timeout handling

Plan 02 §F (mark-governance-timeout step) marks a non-terminal ModuleRun FAILED with `errorMessage: "module_timeout"` after 5 min of `waitForEvent` silence. Plan 03 generalises this across the parallel waits described in §4.3:

- Each `(module, contractId)` wait has its own 5 min timeout that runs **concurrently** with siblings (§4.3's `Promise.all` pattern). The scan-level wall-time worst case is therefore ~5 minutes, regardless of how many Contracts are dispatched — a 20-contract scan with every wait timing out still resolves in ~5 minutes, not 100.
- On timeout for a specific wait, a `mark-module-timeout` step writes the corresponding ModuleRun row (keyed by `scanId + module + contractId`) to FAILED with `errorMessage: "module_timeout"`. Sibling waits continue independently.
- After every wait in the `Promise.all` settles (resolved or timed-out), `markComplete` runs (§4.5).

This isolates failures: a hung detector against one Contract doesn't poison sibling Contracts. Race conditions between a per-wait timeout and a delayed completion event are handled by the idempotency machinery described at the end of §4.3 (compare-and-set on RUNNING + status-filtered updateMany).

### §4.5 `markComplete` across N contracts

Plan 02 `markComplete` did `every`-checks on `scan.modules` for the `allTerminal` and `allTerminalSuccess` predicates. Plan 03 extends across Contracts:

1. Load Scan with all Contracts and all ModuleRuns.
2. `allTerminal` = every ModuleRun across every Contract is in a terminal status.
3. `allTerminalSuccess` = every ModuleRun is COMPLETE or SKIPPED.
4. `hasAnyCompleteModule` = at least one ModuleRun is COMPLETE (Plan 02 H.9 BLOCKER Layer C carries over; protects against all-SKIPPED scans being marked COMPLETE).
5. **Per-Contract composite** (§6.1) is computed for every Contract whose ModuleRuns are all terminal.
6. **Protocol-level composite** (§6.2) is computed across the per-Contract composites.
7. `Scan.isPartialGrade` is set if any COMPLETE ModuleRun has `errorDetectorCount > 0` (Plan 02 I.1 FIX 3 semantics, now aggregated across Contracts — §6.3).

If the scan has zero runnable Contracts × Modules (a defense-in-depth check beyond Plan 02 H.9 BLOCKER Layer A/B), finalize as FAILED.

---

## §5 Detection

### §5.1 Per-contract execution model

The existing six governance detectors are pure functions of one `GovernanceSnapshotData`:

```typescript
export type GovernanceDetector = (snapshot: GovernanceSnapshotData) => GovernanceFindingInput[];
```

**This signature does not change in Plan 03.** Each detector continues to operate on a single contract's snapshot. The orchestration layer (`executeGovernanceModule`) is what changes — it now runs the detector pass *per Contract*:

1. `captureGovernanceSnapshot` runs once per Contract, producing one `GovernanceSnapshotData` per Contract.
2. The detector registry (`GOVERNANCE_DETECTORS`) runs against each Contract's snapshot.
3. Findings collected per detector per Contract; each Finding row carries `contractId`.
4. Per-Contract `Contract.compositeGrade` + `Contract.compositeScore` written in the persist transaction.
5. ModuleRun grade / score / findingsCount / errorDetectorCount semantics unchanged from Plan 02 — but rows are now keyed `(scanId, module, contractId)` per §3.2.

### §5.2 No new detectors in Plan 03

GOV-007 (bridge security) and GOV-008 (cross-chain admin consistency) are graph-aware detectors — they compare across contracts, not within one snapshot. Their function signature would be:

```typescript
// Hypothetical for Plan 04, NOT shipped in Plan 03.
type GraphDetector = (graph: { snapshots: Map<string, GovernanceSnapshotData> }) => GovernanceFindingInput[];
```

Plan 03 builds the chassis (per-Contract snapshots, the graph data structure to feed a future `GraphDetector`) but ships zero graph-aware detectors. Plan 04 adds the new detector type to the registry alongside the existing single-snapshot detectors.

### §5.3 Snapshot cross-contract data

Plan 02's `captureGovernanceSnapshot` already produces, per contract, a snapshot containing: governor address, timelock, multisig (if declared), proxy type + implementation. In Plan 03 each Contract gets its own snapshot — including the proxy implementation contract, if the user explicitly submits it as a related contract with role `PROXY_IMPLEMENTATION`.

**Plan 03 does NOT auto-add proxy implementations to the graph.** If a user submits a TransparentUpgradeableProxy as `PRIMARY` and does not also submit its implementation as a related contract, the implementation is captured *within the primary's snapshot* (existing Plan 02 D.5 behavior — `proxyImplementation` field on `GovernanceSnapshotData`) but is not separately scanned. To scan the implementation as a first-class contract, the user adds it explicitly to `relatedContracts` with `role: PROXY_IMPLEMENTATION`. Auto-promotion of implementations to Contract rows is a Plan 04 enhancement.

**Duplicate findings under user-supplied proxy + implementation.** If the user submits both a proxy contract as `PRIMARY` and its implementation as a separate Contract with role `PROXY_IMPLEMENTATION`, each is scanned independently. The implementation's snapshot data appears in BOTH the primary's snapshot (via the existing Plan 02 D.5 `proxyImplementation` field on the primary's `GovernanceSnapshotData`) AND as a standalone Contract snapshot. Detector findings on the implementation will therefore fire in both contexts. **Plan 03 does NOT deduplicate these.** The user's explicit submission of both is informative: a finding tagged with the proxy's `contractId` says "this issue exists when interacting through the proxy"; the same finding tagged with the implementation's `contractId` says "this issue exists in the implementation logic." Both framings are useful, and the UI groups findings by Contract (§7.4), so users see them as distinct entries rather than redundant duplicates. A user wanting a single scan of just the proxy or just the implementation can submit only one.

---

## §6 Scoring — composite-of-composites

This section extends Plan 02 spec §5.3.

### §6.1 Per-Contract composite

Each Contract's composite is computed exactly as Plan 02's `calculateCompositeGrade`:

```
baseScore = 100
for each finding on this contract: baseScore -= severityPenalty[finding.severity]
contractScore = max(0, baseScore)

// Floor overrides (Plan 02 §5.3):
if criticalCount >= 3: contractGrade = F
else if criticalCount >= 2: contractGrade = D
else: contractGrade = thresholdLookup(contractScore)
```

Per-Contract grades are persisted on `Contract.compositeScore` + `Contract.compositeGrade`.

### §6.2 Protocol-level composite

The Plan 03 product question: how does a protocol with one A-grade contract and one F-grade contract get graded as a *whole*?

**Decision: worst-contract-wins, with score = arithmetic mean of per-Contract scores.**

```
gradedContracts = { c in scan.contracts : c.compositeGrade is not null }
Scan.compositeGrade = min(c.compositeGrade for c in gradedContracts)
Scan.compositeScore = mean(c.compositeScore for c in gradedContracts)
```

Where `min(grade)` follows the natural F → D → C → B → A ordering (F is the minimum).

**Eligibility — only graded Contracts contribute.** The rollup iterates ONLY over Contracts whose `compositeGrade` is non-null — i.e., Contracts whose ModuleRuns all terminated in COMPLETE state and produced a grade:

- **COMPLETE Contracts** (all ModuleRuns COMPLETE, at least one with a grade) — contribute to both `min(grade)` and `mean(score)`.
- **FAILED Contracts** (snapshot capture crashed, or every detector errored out, or every ModuleRun ended FAILED) — do NOT contribute to the protocol grade. They have null `compositeGrade`, so the min/mean computations skip them. Their existence is surfaced separately via `Scan.isPartialGrade` (§6.3) so the UI can flag partial graph coverage.
- **SKIPPED Contracts** (every applicable ModuleRun ended SKIPPED — e.g., a `DECLARED_BRIDGE` Contract for which the only implemented module GOVERNANCE doesn't apply per §4.2's role-applicability table) — do NOT contribute either. They have null `compositeGrade`. The UI lists them but they don't move the protocol grade.

**Extension of Plan 02 H.9 BLOCKER Layer C to the graph layer.** If the rollup finds zero Contracts with a non-null `compositeGrade` (every Contract is FAILED, or every Contract is SKIPPED, or some mix of the two — but none COMPLETE-with-grade), the scan finalises as `FAILED` at the protocol level with null `compositeScore` + `compositeGrade`. This mirrors Plan 02's executor-layer rejection of all-SKIPPED scans (the H.9 BLOCKER Layer C guard) and prevents a misleading "no findings, grade A" outcome for a scan where the graph produced no usable data.

**Rationale for worst-grade-wins:** a protocol is only as safe as its weakest contract. If the user submits a primary contract that scores A but its declared multisig is 1-of-2, the multisig's CRITICAL finding represents a real and present risk to the protocol — the protocol grade must surface that. Averaging grades would dilute the signal; worst-grade-wins matches the same defensive logic Plan 02 §5.3 used for its CRITICAL floor override.

The arithmetic mean for `Scan.compositeScore` is informational — it gives users a sense of "how bad is the overall posture" beyond the worst-grade letter.

**Revisit clause.** This aggregation rule is appropriate for the defensive / due-diligence framing of Plan 02/03 (investor or security-team review of a protocol's worst posture). If design-partner validation in Plan 06+ shows that protocol-team users — who want to know their core contract's grade even when a peripheral related contract scores low — need a different model, the aggregation can be revisited. Plan 03 does not pre-emptively ship a weighted alternative because that requires a defensible weights table that does not yet exist.

**Floor override at the protocol level:** none beyond what each Contract's grade already encodes. A protocol with one Contract at F is at F; this is the same outcome the contract-level floor override would produce. Adding a protocol-level "3+ CRITICAL across all contracts → F" rule was considered and rejected — it would conflate "one contract has 3 CRITICALs" with "three contracts each have 1 CRITICAL," which are different risk shapes.

### §6.3 `isPartialGrade` semantics

Plan 02 I.1 FIX 3 set `Scan.isPartialGrade = true` when any COMPLETE ModuleRun had `errorDetectorCount > 0`. Plan 03 keeps that predicate and extends it: the flag also fires when **the graph is partially covered** — i.e., some Contracts produced a grade and others didn't:

```
Scan.isPartialGrade = (
  // Detector-error degradation (Plan 02 carry-over).
  any ModuleRun in this scan where
    status === COMPLETE AND errorDetectorCount > 0
) OR (
  // Plan 03 extension: partial graph coverage.
  scan has >= 1 Contract with non-null compositeGrade AND
  scan has >= 1 Contract that finalised FAILED
)
```

The two clauses capture different confidence-degradation modes:

- **Detector-error clause (Plan 02 carry-over).** Some detectors crashed inside a COMPLETE module — the grade is real but incomplete. Per-Contract, the same predicate lives on `Contract.isPartialGrade`. The scan-level flag is `true` if *any* Contract's grade is partial.
- **Partial-coverage clause (Plan 03 extension).** Some Contracts finalised FAILED while others COMPLETED with grades. The protocol composite is honestly computed over the COMPLETE Contracts (§6.2) but doesn't see the FAILED ones, so the grade is real but incomplete. The UI surfaces which Contracts FAILED so users can choose to re-scan or interpret the composite accordingly.

Both clauses are confidence signals, not grade modifiers — the worst-grade-wins logic in §6.2 is unaffected by `isPartialGrade`. The flag tells the UI to add a "partial" affordance to whatever grade was computed.

A scan where **all** Contracts FAILED has no graded Contract and is rejected by the §6.2 zero-graded-Contracts guard (the scan itself finalises FAILED with null composite). `isPartialGrade` is therefore only meaningful when the scan ends COMPLETE — it never co-exists with a FAILED scan.

---

## §7 API + presentation

### §7.1 `POST /api/scan` shape

Request body now accepts `relatedContracts` per §4.1. Backward compatibility:

- Existing Plan 02 clients sending only `primaryContractAddress` (plus optional `extraContractAddresses` as plain strings) continue to work; the legacy field is treated as `relatedContracts` with `role: RELATED`.
- New Plan 03 clients use the structured `relatedContracts` shape with explicit roles and labels.

Response body is unchanged (still `{ scanId, status }` per Plan 02 §6.1).

### §7.2 `GET /api/scan/[id]` shape

`scan-response.ts`'s `ScanResponse` shape gains a `contracts` dimension:

```typescript
export interface ScanResponse {
  // … existing top-level scan fields (id, status, compositeScore,
  // compositeGrade, isPartialGrade, createdAt, completedAt, …) …
  protocol: { /* unchanged */ };
  contracts: ContractResponse[];               // NEW (Plan 03)
  findings: FindingResponse[];                 // tier-shaped, NOW grouped by contractId
  // The flat `modules` array is REMOVED from the top level — modules now
  // live under each ContractResponse. This is a breaking change for Plan
  // 02 API consumers; document it in the response shape comments.
}

export interface ContractResponse {
  id: string;
  address: string;
  role: ContractRole;
  label: string | null;
  isPrimary: boolean;
  compositeScore: number | null;
  compositeGrade: string | null;
  isPartialGrade: boolean;
  crossChainTwins: { chain: string; address: string }[];
  modules: ModuleRunResponse[];                // per-contract module runs
  findingsCount: number;                       // count of findings on this contract
}
```

Each `FindingResponse` gains a `contractId` field (in all three tier variants) so the UI can group findings by contract without joining tables.

### §7.3 `GET /api/scan/[id]/status` shape

The lightweight polling endpoint (Plan 02 §6.3) extends similarly:

```typescript
{
  id: string,
  status: ScanStatus,
  contracts: Array<{
    id: string,
    address: string,
    label: string | null,
    role: ContractRole,
    isPrimary: boolean,
    modules: Array<{
      module: ModuleName,
      status: ModuleStatus,
      grade: Grade | null,
    }>,
  }>,
}
```

Cache-Control rules from Plan 02 G.1 carry over: `no-store` for non-terminal, `private, max-age=60` for terminal.

### §7.4 UI presentation

The `ScanShell` component (Plan 02 G.3) renders one `CompositePanel` + four `ModuleCard`s + one `FindingsList`. Plan 03 reshapes this:

- **Protocol composite stays at the top.** `CompositePanel` continues to render *one* big grade — the protocol-level composite (Plan 03 §6.2). Copy updates: "Protocol grade" rather than "Composite grade." Score line: "Score: 75/100 (avg of 4 contracts)."
- **New `ContractList` component below the composite.** One card per Contract showing: contract role + label + address (truncated) + that contract's grade letter + findings count. Cards are ordered: PRIMARY first, then by role priority (TIMELOCK, DECLARED_MULTISIG, PROXY_IMPLEMENTATION, TOKEN_CONTRACT, DECLARED_BRIDGE, RELATED), then by address. Clicking a card scrolls / filters the findings list.
- **`ModuleCard` per contract.** Currently `ModuleCard` displays one module's status across the whole scan. In Plan 03 it shows one module on one contract. Whether to render four `ModuleCard`s per contract (16 cards for a 4-contract scan) or collapse to a denser grid is a visual-polish decision — the spec requires that the data be present in the rendered DOM, not the specific layout.
- **`FindingsList` grouped by contract.** Findings render in sections, one section per contract that has findings. Section header includes contract label + role + address. Contracts with zero findings either render an empty-section ("No findings on `<contract label>`") or are omitted; the spec leaves this to visual polish.
- **`ProtocolGraphDisclaimer` rewrite.** The current banner text reads "Breakwater scans the submitted core contract address. Protocol-wide analysis (bridges, tokens, cross-chain deployments, related multisigs) is coming in a future release." Plan 03 replaces with:

  > "Breakwater scanned `<N>` contract(s) you supplied for this protocol. Automatic discovery of related contracts (bridges, token contracts, cross-chain twins) is on the roadmap."

  The disclaimer stays in `ScanShell` (between Hero and CompositePanel) for scans where `contracts.length > 1`. For single-contract scans, the disclaimer text reverts to a Plan-02-style note: "Breakwater scans the submitted core contract address. Submit related contracts (proxy implementations, multisigs, bridges) to expand the graph."

- **`UnlockCTA` unchanged.** Email tier gating still applies; the per-contract grouping does not change the unauth-tier teaser shape (one teaser per module per contract). Plan 03 UX explicitly accepts that an unauth user submitting a 10-contract scan sees up to 10 teasers — one per contract. This is intended: the value proposition of unlocking grows with graph size.

### §7.5 Status indicators across contracts

Plan 02 G.3 added RUNNING pulse indicators on `ModuleCard`. In Plan 03 each per-contract per-module ModuleRun has its own status — the pulse fires for whichever specific ModuleRun is mid-execution. The `useScanPolling` hook (Plan 02 G.2) needs to handle the per-contract polling shape — the `polledModules` return value becomes a nested map keyed `(contractId, module)`. This is structural; visual polish (whether to show "scanning contract 3 of 7") is out of scope for the spec.

---

## §8 Curated demos

### §8.1 Backfill targets

Plan 03 ships with two curated demo protocols backfilled to multi-contract shape:

**Aave V3** (existing demo slug: `aave-v3-ethereum`, Plan 02 baseline)

| Address | Role | Label |
|---|---|---|
| `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2` | PRIMARY | Aave V3 Pool |
| `0xacFe4511CE883C14c4eA40563F176C3C09b4c47C` | PROXY_IMPLEMENTATION | Pool Implementation V3.x |
| `0xEE56e2B3D491590B5b31738cC34d5232F378a8D5` | TIMELOCK | Short Executor (governance timelock) |
| `0xEC568fffba86c094cf06b22134B23074DFE2252c` | DECLARED_MULTISIG | Aave Guardian (3-of-5) |

**Uniswap V3** (existing demo slug: `uniswap-v3-ethereum`)

| Address | Role | Label |
|---|---|---|
| `0xE592427A0AEce92De3Edee1F18E0157C05861564` | PRIMARY | Uniswap V3 SwapRouter |
| `0x1F98431c8aD98523631AE4a59f267346ea31F984` | RELATED | UniswapV3Factory |
| `0x000000000022D473030F116dDEE9F6B43aC78BA3` | RELATED | Permit2 (allowance manager) |

The exact related-contract addresses + role assignments are the curator's call. The seed file (`prisma/seed.ts`) gains the new shape; existing single-contract Plan 01 + Plan 02 demos in the seed file are migrated to one-Contract-row representations.

### §8.2 Curation convention

Curated demos with `ownershipStatus: CURATED` continue to short-circuit at the `submitScan` cooldown gate (Plan 01 412 path). Plan 03 does NOT change the curated-demo flow — it only changes the shape of what a curated demo looks like in the DB. The `latestDemoScanId` pointer on `Protocol` still works because each curated demo still has exactly one published demo scan; that scan now has N Contract rows.

---

## §9 External dependencies

No new external dependencies. Plan 03 reuses every Plan 02 client + tool:

- viem `publicClient` (RPC fallback transport)
- Etherscan v2 client (`fetchContractAbi`, `fetchProxyImplementation`)
- Safe Transaction Service client (`fetchSafeInfo`)
- Multicall batching (already enabled on `publicClient`)
- `checkIsContract` from `contract-utils.ts`

No new RPC providers, no new API integrations, no new npm packages. Plan 03 is a layer reshape — it adds N-contract iteration over existing single-contract primitives.

---

## §10 Testing strategy

Mirrors Plan 02 §10 with the multi-contract dimension added:

### §10.1 Unit tests

- New unit tests for the per-Contract orchestration in `executeGovernanceModule`: given a Contract row + snapshot, persist findings with the right `contractId`.
- New unit tests for the protocol-composite scoring (§6.2): worst-grade-wins logic + mean-score computation, including edge cases (all SKIPPED, mixed FAILED + COMPLETE, single-contract scan still produces correct protocol composite).
- Existing six detector unit tests stay unchanged — detectors operate on single snapshots and Plan 03 doesn't change their signature.

### §10.2 Integration tests

- Multi-contract submission: `submitScan` with 3 related contracts creates 1 Scan + 4 Contract rows (1 PRIMARY + 3 related) + 4 ModuleRun rows (one per Contract, GOVERNANCE only since it's the only implemented module).
- Cross-contract fan-out: dispatcher emits N events, one per Contract; each event is matched by its corresponding waitForEvent step; orphan events from unrelated scans don't poison the matching.
- Per-contract isolation: a detector throw on Contract A doesn't prevent Contracts B/C/D from completing.
- Plan 02 backward compat: scans created with Plan 02-shape submissions (no `relatedContracts`) produce single-Contract scans (the PRIMARY only) and grade identically to Plan 02.

### §10.3 Multi-contract fixture tests

Plan 02 §10.3 introduced fixture-based regression tests (Drift / Beanstalk / Audius). Plan 03 adds two multi-contract fixtures:

- **Aave V3-like (clean):** 4 Contracts — `PRIMARY` core + `PROXY_IMPLEMENTATION` impl + `TIMELOCK` + `DECLARED_MULTISIG` 3-of-5 guardian. Expected per-Contract outcomes: all four COMPLETE with grade A and zero findings. Protocol composite: A. `isPartialGrade`: false.

- **Bridge-protocol-like (dirty):** 3 Contracts — `PRIMARY` core (clean) + `DECLARED_BRIDGE` endpoint + `DECLARED_MULTISIG` 1-of-2. Per §4.2's role-applicability table, GOVERNANCE does NOT apply to `DECLARED_BRIDGE` (the entire module SKIPs at submission time per the H.6 priority order, with `errorMessage: "role_not_applicable_to_module"`). Expected per-Contract outcomes:
  - `PRIMARY` core: COMPLETE, grade A, zero findings.
  - `DECLARED_BRIDGE`: every applicable ModuleRun SKIPPED. Per §6.2, this Contract has null `compositeGrade` and contributes nothing to the rollup. The Contract still appears in the UI's contract list (with a SKIPPED-style affordance) but is invisible to scoring.
  - `DECLARED_MULTISIG` 1-of-2: COMPLETE, grade F via GOV-003 (multisig concentration CRITICAL).
  - Protocol composite: F (worst-wins over the two graded Contracts — `PRIMARY` A and `DECLARED_MULTISIG` F).
  - `isPartialGrade`: false. No detector errors fired and the SKIPPED `DECLARED_BRIDGE` is not a FAILED Contract — the §6.3 partial-coverage clause only triggers on FAILED Contracts coexisting with COMPLETE ones, not on SKIPPED-by-role-applicability.

  The fixture exercises three properties: (1) `min(grade)` over null-grade-filtered Contracts produces the correct worst grade, (2) role-applicability gates bridges out cleanly without erroring, (3) protocol-level grade computation tolerates a Contract that contributes nothing to the rollup.

### §10.4 Manual preview smoke

Plan 03 manual smoke must include at least one multi-contract submission against a real protocol (Aave V3 backfill is the natural candidate). The smoke verifies: dispatcher fan-out fires N events; UI renders contract list + per-contract grades; `scan.completed` event payload reflects the protocol composite.

---

## §11 Privacy + security

Plan 02 §11 (privacy + security) carries over unchanged. The graph is user-supplied — no new third-party data sources are queried, no new credentials surface, no PII flows differ. The only material change: more RPC calls per scan (N contracts × M modules × per-contract snapshot reads). The viem fallback transport's existing rate-limit + retry behavior handles this; no new infrastructure required.

---

## §12 Deployment + rollout

Plan 03 ships as a single migration set (additive then constraint-tightening, per §3.5). Rollout:

1. Merge Plan 03 PR to main.
2. Vercel deploys `main`; `prisma migrate deploy` (wired in Plan 02 I.3) applies migrations.
3. Backfill script (Plan 03 ships it as `pnpm db:backfill-contracts` or similar — invoked manually after the additive migration before the constraint-tightening migration).
4. Manual preview smoke against multi-contract Aave V3 demo.
5. Production rollout — same as Plan 02 conventions.

Rollback path: code rollback to Plan 02 + DB stays at Plan 03 schema. Because Plan 03 columns are nullable during the additive phase and the new Contract table is unused by Plan 02 code, Plan 02 code reads cleanly. Post-constraint-tightening rollback requires manual SQL revert (documented in `docs/deployment-env.md` Plan 03 addendum).

---

## §13 Breaking changes from Plan 02

Plan 03 introduces one API-shape breaking change:

- `GET /api/scan/[id]` no longer returns a flat `modules` array at the top level. Modules now live under each `ContractResponse`. Plan 02 API clients reading `scan.modules` will see `undefined` post-deploy.

This is acceptable because **Plan 02 had no public API consumers other than the in-app UI** — the API is internal. The in-app UI ships its own update in the same Plan 03 PR. If Plan 03 wanted to preserve the flat shape for backward compat, it would aggregate per-Contract ModuleRuns into a denormalised top-level array; this is deliberately rejected to keep the response shape honest about the new multi-Contract model.

This decision was reviewed and accepted: `GET /api/scan/[id]` is treated as **internal API surface** for the Breakwater in-app UI. No public API contract exists with external consumers. If a future plan needs to expose the scan response to third parties (Plan 06+ public API, API-partner integration, on-chain attestation service), that plan **should design a stable versioned public response shape** as a deliberate product surface — Plan 03's internal shape change is not a public-contract precedent and should not be cited as one when the public API is introduced.

All schema migrations are additive or column-additions during the rollout window (§3.5). The constraint-tightening follow-up migration is non-destructive but does require backfill to have completed first.

---

## §14 Exit criteria (hard)

These must pass before Plan 03 can merge:

- All Plan 02 tests still pass (691 baseline preserved).
- New tests for per-Contract orchestration, protocol-composite scoring, multi-contract fixtures, and submission validation all green.
- Detector subtree coverage ≥85% (Plan 02 spec §14 carryover; Plan 03 should match Plan 02's 96.75%).
- `prisma migrate deploy` applies Plan 03 migrations against the Production DB cleanly.
- Manual preview smoke: Aave V3 backfilled demo → multi-contract scan completes with per-Contract grades + protocol composite A.
- `relatedContracts` validation tests: max-20 cap rejects; per-address validation rejects; primary-in-related rejects; legacy `extraContractAddresses` shape continues to be accepted.
- `waitForEvent` compound match verified: a `scan.module.completed` event from one scan does not cross-resume a waiter on a different scan / different contract / different module.
- ProtocolGraphDisclaimer rewrite shipped (text per §7.4).
- Backfill script ships + runs cleanly against the dev DB; tested for idempotency.
- Codex Phase A–I-style review with all BLOCKER + IMPORTANT findings resolved.

## §15 Exit criteria (soft)

These are stretch goals:

- Average multi-contract scan execution time < 60 s for a 5-contract graph end-to-end (Plan 02's single-contract scan averaged ~15–30 s).
- Five real Ethereum protocols backfilled as curated multi-contract demos (Plan 03 ships 2 — Aave V3 + Uniswap V3 — soft target adds Compound, MakerDAO, Lido).
- UI A11y score on `/scan/[id]` ≥ 90 maintained (Plan 02 baseline).
- No regression in the Railway integration-test flake (NOTES.md L66) — Plan 03 doesn't add Railway dependence beyond Plan 02; flake rate should stay flat.

---

## §16 Glossary

- **Contract** — One scannable Ethereum address within a Scan. Plan 03's new model (§3.1).
- **Graph** — The set of Contract rows belonging to one Scan. Plan 03 = user-supplied; Plan 04 = auto-discovered.
- **Per-Contract composite** — The grade for one Contract, computed from that Contract's findings using Plan 02 §5.3 algorithm.
- **Protocol composite** — The Scan-level grade, computed as worst-grade-wins across per-Contract composites with arithmetic mean for the score (§6.2).
- **Role** — A discriminator on a Contract describing what kind of related thing it is (`PRIMARY`, `PROXY_IMPLEMENTATION`, `DECLARED_MULTISIG`, etc.). Drives module applicability (§4.2).
- **Cross-chain twin** — A descriptive reference to a Contract's counterpart on another chain. Recorded, never scanned in Plan 03.

---

## §17 Open questions for review

Of the original seven open questions, two (2 and 6) resolved during the revision pass per the §6.2 and §13 updates respectively. The remaining five (1, 3, 4, 5, 7) go to Codex for adversarial review before the spec is frozen.

1. **Max related contracts per scan.** Spec proposes 20. Higher = more protocols expressible without splitting; lower = tighter RPC budget. 20 feels balanced; verify.
2. **Worst-grade-wins vs. weighted aggregation.** *Resolved during revision pass.* Plan 03 ships worst-wins; revisit deferred to Plan 06+ per §6.2 above.
3. **PROXY_IMPLEMENTATION auto-promotion.** §5.3 explicitly keeps proxy implementations *inside* the primary's snapshot (not as separate Contract rows) unless the user submits them. Plan 04 would auto-promote. Verify Plan 03 stays user-supplied.
4. **`Protocol.extraContractAddresses` fate.** §3.4 supersedes but keeps the column. Alternative: drop the column outright in Plan 03 (destructive migration). Keeping it is the conservative choice; dropping it sheds dead state. Conservative chosen.
5. **Demo backfill choice.** §8.1 ships Aave V3 + Uniswap V3 (matching the recon's test-protocol recommendations). Compound v3 USDC is a candidate third demo. Time-bound to curate honestly.
6. **API breaking change tolerance.** *Resolved during revision pass.* Plan 03 ships the breaking change; no public API contract exists per §13 above.
7. **Backfill ordering.** §3.5 + §12 require manual invocation of the backfill script between the additive migration and the constraint-tightening migration. The alternative is a single migration with raw SQL backfill embedded; that ties code-deploy and DB-state more tightly. The two-step approach is safer (rollback survives partial deploy) but operationally heavier. Verify operational tolerance.

Reviewer signoff on the five remaining questions (1, 3, 4, 5, 7) freezes the spec.
