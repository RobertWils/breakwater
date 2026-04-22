# Breakwater Plan 02 — Dispatcher + Governance Module

**Status:** Draft for review
**Supersedes:** Plan 01 scaffold (merged v0.1.0-plan-01)
**Targets:** Ethereum mainnet governance detection, end-to-end working pipeline

---

## §1 Plan overview

### §1.1 Goals

Plan 02 ships the first working end-to-end scan pipeline. Users submit scans through the Plan 01 form, and for Ethereum-mainnet protocols the Governance module executes against live on-chain state. Findings render in the `/scan/[id]` UI via the tier-aware rendering already built in Plan 01.

The product assertion this validates: "Breakwater can detect the governance patterns behind real DeFi hacks." Five documented incidents (Drift, Beanstalk, Compound 62, Ronin, Audius) anchor the detector inventory.

### §1.2 Non-goals

The following are explicitly out of scope for Plan 02:

- Oracle/Signer/Frontend detector modules (Plans 03–06)
- Solana governance detection (SPL Governance, Realms — Plan 03+)
- L2-specific governance primitives (Arbitrum Security Council, Optimism Upgrade Keys — Plan 03+)
- MakerDAO DSPauseProxy / spell pattern (bespoke, deferred)
- Snapshot → on-chain executor (safeSnap) patterns
- Real-time scan monitoring / scheduled re-scans (Plan 07+)
- Email notifications on scan completion
- Paid tier gating for findings
- Public scan sharing UI
- Browser extension for signers
- Proposal simulation / execution trace analysis

### §1.3 Carry-over from Plan 01 backlog

These items are resolved within Plan 02 scope:

- **Slug collision fix:** `generateSlug` uses 8-character hex prefix, causing test isolation issues. Fix: use full address hash or add random suffix.
- **FindingResponse discriminated union refactor:** current type uses optional fields; convert to proper discriminated union with `tier` discriminator.
- **config.test.ts production coverage:** add test cases that actually exercise `assertProductionHashSalts` and `assertProductionConfig` paths.
- **ScanAttempt.reason nullability:** current schema allows null; tighten to required for failure paths.

Items explicitly deferred to Plan 03+:
- Quota-vs-dedupe ordering (§17.4 edge case)
- Custom teal prose theme for @tailwindcss/typography

---

## §2 Background research summary

Research doc: `docs/research/2026-04-22-governance-incidents.md` (commit c1d9642).

Five incidents studied:

1. **Drift Protocol** (April 2026, $285M, Solana) — Security Council with 2-of-5 threshold, zero timelock, direct admin whitelist write via durable nonce pre-signing.
2. **Beanstalk** (April 2022, $182M, Ethereum) — Diamond contract with custom governance; flash-loaned Stalk voting; `emergencyCommit()` bypassed 24h delay.
3. **Compound Proposal 62** (October 2021, $80M at risk, Ethereum) — Governor Bravo upgrade with `>` vs `>=` bug; no emergency pause.
4. **Ronin Bridge** (March 2022, $625M, Ronin chain) — Custom 5-of-9 bridge multisig; 4+1 single-entity concentration; unrevoked 2021 delegation.
5. **Audius** (July 2022, $6M, Ethereum) — Non-standard proxy admin at storage slot 0, colliding with OpenZeppelin `Initializable` boolean.

Common patterns across incidents:
- Timelock misconfiguration (missing, too short, or bypassed) — 3 of 5 incidents
- Multisig concentration or weakness — 2 of 5 incidents
- Governance-bypass paths — 3 of 5 incidents
- Upgrade paths without safeguards — 2 of 5 incidents

---

## §3 Data model changes

### §3.1 New models

```prisma
model GovernanceSnapshot {
  id                  String   @id @default(cuid())
  scanId              String   @unique
  scan                Scan     @relation(fields: [scanId], references: [id], onDelete: Cascade)

  blockNumber         BigInt
  capturedAt          DateTime @default(now())

  // Governance frameworks detected
  hasGovernor         Boolean  @default(false)
  governorAddress     String?
  governorType        GovernorType?  // OZ_GOVERNOR | COMPOUND_BRAVO | CUSTOM
  governorVersion     String?  // "v4.9" for OZ, etc.

  hasTimelock         Boolean  @default(false)
  timelockAddress     String?
  timelockMinDelay    Int?     // seconds
  timelockAdmin       String?

  hasMultisig         Boolean  @default(false)
  multisigAddress     String?
  multisigThreshold   Int?
  multisigOwnerCount  Int?
  multisigOwners      String[] // full owner list for concentration analysis

  proxyType           ProxyType?  // EIP_1967_TRANSPARENT | EIP_1822_UUPS | CUSTOM | NONE
  proxyAdminAddress   String?
  proxyImplementation String?
  proxyVerified       Boolean  @default(false)

  // Voting token (if applicable)
  votingTokenAddress  String?
  votingSnapshotType  VotingSnapshotType?  // BLOCK_BASED | CURRENT_BALANCE | NONE

  rawState            Json     // full multicall response for debugging + Plan 03+ analysis

  @@index([scanId])
}

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

### §3.2 Schema additions to existing models

```prisma
model Scan {
  // ... existing fields
  dispatchedAt        DateTime?  // when Inngest event was emitted
  executionStartedAt  DateTime?  // when first module began
  governanceSnapshot  GovernanceSnapshot?
}

model ModuleRun {
  // ... existing fields
  inngestEventId      String?    // for correlating with Inngest dashboard
  inngestRunId        String?    // specific run instance
}

model Finding {
  // ... existing fields
  detectorVersion     String     @default("1.0.0")  // for reproducibility if logic changes
  snapshotBlockNumber BigInt?    // block height at which finding was produced
}
```

### §3.3 Migrations

Single Prisma migration: `add_governance_snapshot_and_dispatcher_fields`.

Forward-only (no down migrations in production). Existing Plan 01 scans get `dispatchedAt = NULL` — treated as "never dispatched" by Inngest filter.

---

## §4 Inngest integration

### §4.1 Setup

Install: `pnpm add -E inngest @inngest/vercel`

Environment variables added:
- `INNGEST_EVENT_KEY` — for event emission from Next.js
- `INNGEST_SIGNING_KEY` — for webhook signature verification
- `INNGEST_APP_ID` — "breakwater" (or similar identifier)

Serve handler at `src/app/api/inngest/route.ts`:

```typescript
import { serve } from "inngest/next"
import { inngest } from "@/lib/inngest/client"
import { executeScan } from "@/lib/inngest/functions/execute-scan"
import { executeGovernanceModule } from "@/lib/inngest/functions/execute-governance"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [executeScan, executeGovernanceModule],
})
```

Vercel config: Inngest handler route does NOT have the default Vercel timeout — Inngest's own runtime handles execution. Long-running steps use Inngest's `step.run` primitive which yields back to the serverless function between steps.

### §4.2 Events

Three events emitted:

```typescript
// Emitted by POST /api/scan after persistence
"scan.queued": {
  data: {
    scanId: string,
    protocolId: string,
    chain: "ETHEREUM",
    primaryContractAddress: string,
    modulesEnabled: Module[],  // ["GOVERNANCE"] in Plan 02
  }
}

// Emitted by executeGovernanceModule after completion
"scan.module.completed": {
  data: {
    scanId: string,
    module: "GOVERNANCE",
    status: "COMPLETE" | "FAILED" | "SKIPPED",
    findingsCount: number,
    grade: Grade | null,
    executionMs: number,
  }
}

// Emitted by executeScan orchestrator when all modules done
"scan.completed": {
  data: {
    scanId: string,
    finalStatus: ScanStatus,
    compositeGrade: Grade | null,
    executionMs: number,
  }
}
```

### §4.3 Functions

**Function 1: `executeScan` orchestrator**

Triggered by `scan.queued`. Fans out to per-module functions, waits for all to complete, computes composite grade.

```typescript
export const executeScan = inngest.createFunction(
  { id: "execute-scan", name: "Execute scan" },
  { event: "scan.queued" },
  async ({ event, step }) => {
    const { scanId, modulesEnabled } = event.data

    // Step 1: Mark execution started
    await step.run("mark-started", async () => {
      await prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "RUNNING",
          executionStartedAt: new Date(),
        },
      })
    })

    // Step 2: Trigger module functions in parallel
    const moduleRuns = await Promise.all(
      modulesEnabled.map((module) =>
        step.sendEvent(`trigger-${module}`, {
          name: "scan.module.requested",
          data: { scanId, module },
        })
      )
    )

    // Step 3: Wait for all modules to signal completion
    const results = await Promise.all(
      modulesEnabled.map((module) =>
        step.waitForEvent(`wait-${module}`, {
          event: "scan.module.completed",
          timeout: "5m",
          if: `event.data.scanId == "${scanId}" && event.data.module == "${module}"`,
        })
      )
    )

    // Step 4: Compute composite grade + mark scan complete
    await step.run("finalize", async () => {
      await recomputeScanStatus(scanId)
    })

    // Step 5: Emit scan.completed
    const finalScan = await step.run("fetch-final", () =>
      prisma.scan.findUnique({ where: { id: scanId } })
    )

    await step.sendEvent("emit-completed", {
      name: "scan.completed",
      data: {
        scanId,
        finalStatus: finalScan.status,
        compositeGrade: finalScan.compositeGrade,
        executionMs: Date.now() - new Date(finalScan.executionStartedAt).getTime(),
      },
    })
  }
)
```

**Function 2: `executeGovernanceModule`**

Triggered by `scan.module.requested` filtered to `module == "GOVERNANCE"`. Performs state snapshot + runs 6 detectors + persists findings.

```typescript
export const executeGovernanceModule = inngest.createFunction(
  { id: "execute-governance", name: "Execute Governance module" },
  { event: "scan.module.requested", if: "event.data.module == 'GOVERNANCE'" },
  async ({ event, step }) => {
    const { scanId } = event.data

    // Step 1: Mark module running
    await step.run("mark-running", async () => {
      await prisma.moduleRun.update({
        where: { scanId_module: { scanId, module: "GOVERNANCE" } },
        data: { status: "RUNNING", startedAt: new Date() },
      })
    })

    // Step 2: Capture on-chain governance snapshot
    const snapshot = await step.run("capture-snapshot", async () => {
      return await captureGovernanceSnapshot(scanId)
    })

    // Step 3: Run 6 detectors against snapshot
    const findings = await step.run("run-detectors", async () => {
      return await runGovernanceDetectors(snapshot)
    })

    // Step 4: Persist findings + compute module grade
    const moduleResult = await step.run("persist-findings", async () => {
      return await persistFindingsAndGrade(scanId, findings)
    })

    // Step 5: Emit module completed event
    await step.sendEvent("emit-completed", {
      name: "scan.module.completed",
      data: {
        scanId,
        module: "GOVERNANCE",
        status: moduleResult.status,
        findingsCount: findings.length,
        grade: moduleResult.grade,
        executionMs: Date.now() - new Date(moduleResult.startedAt).getTime(),
      },
    })
  }
)
```

### §4.4 Retry strategy

Per-step retries via Inngest primitives:
- `captureGovernanceSnapshot`: 3 retries with exponential backoff (RPC errors common)
- `runGovernanceDetectors`: 1 retry (deterministic, shouldn't need retries)
- `persistFindings`: 3 retries (DB transient failures)

Overall function timeout: 5 minutes. If governance module exceeds this, `ModuleRun.status = FAILED` with `errorMessage = "Execution timeout"`.

### §4.5 Observability

Inngest dashboard provides:
- Function run history (success/failure/retry patterns)
- Step-level latency breakdown
- Error stack traces with correlation IDs

Additional app-level logging:
- Structured JSON logs to Railway (scan lifecycle events)
- Key metrics: scan submission rate, completion rate, avg execution time, detector hit rates

### §4.6 Critical scan lifecycle question — idempotency

If Inngest retries `executeScan`, we must not double-persist findings or double-dispatch module events. Mitigation:

- `captureGovernanceSnapshot` uses `upsert` on `GovernanceSnapshot.scanId` (unique constraint)
- `persistFindingsAndGrade` uses transaction: delete existing findings for scan+module, then insert new ones
- Step IDs are deterministic per scan (Inngest deduplicates steps automatically)

---

## §5 Governance module detector logic

### §5.1 Detector inventory

Six detectors, each anchored to at least one researched incident:

| ID | Title (internal) | publicTitle (unauth tier) | Severity | Anchored incidents |
|----|------------------|---------------------------|----------|-------------------|
| GOV-001 | Timelock missing or insufficient delay | Governance delay protection weakness | CRITICAL | Drift, Beanstalk |
| GOV-002 | Emergency execute or governance bypass function | Governance bypass path detected | CRITICAL | Beanstalk, Drift |
| GOV-003 | Multisig signer concentration | Multisig control concentration | HIGH | Drift, Ronin |
| GOV-004 | Current-balance voting without snapshot | Governance vote weighting risk | HIGH | Beanstalk |
| GOV-005 | Proxy admin misconfiguration | Proxy upgrade control weakness | HIGH | Audius |
| GOV-006 | Upgradeable without emergency pause | Upgrade risk without safeguards | MEDIUM | Compound 62, Audius |

Detailed per-detector spec follows.

### §5.2 Per-detector specification

#### GOV-001: Timelock missing or insufficient delay

**Trigger conditions** (any):
- Contract has admin role but no Timelock in call path
- Timelock present but `getMinDelay() < 172800` (48 hours)
- Timelock admin is an EOA (not another governance contract)
- Timelock admin is the Governor itself (bypass path — Governor can change its own delay)

**Data sources:**
- Contract ownership storage slots via multicall
- Timelock `getMinDelay()`, `admin()` via viem readContract

**Severity:** CRITICAL
**publicTitle:** "Governance delay protection weakness"
**remediationHint:** "Ensure a Timelock contract with 48h+ minimum delay guards all admin operations. Timelock admin should be the Governor contract, not an EOA or the Governor itself."

#### GOV-002: Emergency execute or governance bypass function

**Trigger conditions** (any):
- Contract ABI contains function matching pattern: `emergency*`, `force*`, `bypass*`, `execute` with admin-only modifier
- Function exists that allows admin to execute arbitrary calldata without timelock
- `emergencyCommit()`, `emergencyExecute()`, or equivalent pattern detected

**Data sources:**
- Etherscan ABI API (verified contracts)
- Function selector matching against known bypass patterns

**Severity:** CRITICAL
**publicTitle:** "Governance bypass path detected"
**remediationHint:** "Review all admin-only functions that allow arbitrary execution. Emergency functions should require multi-sig approval and be limited to pause/unpause — not arbitrary calls."

#### GOV-003: Multisig signer concentration

**Trigger conditions** (any):
- Threshold < 3 (regardless of owner count)
- Threshold-to-owners ratio < 50% (e.g., 2-of-5, 3-of-7)
- Owner count <= 3 (insufficient for meaningful distribution)
- **Deferred to Plan 03+:** Owner clustering analysis (multiple owners controlled by same entity)

**Data sources:**
- Safe API: `/v1/safes/{address}/` returns threshold + owners
- Fallback: direct contract calls `getThreshold()`, `getOwners()` via viem multicall

**Severity:** HIGH
**publicTitle:** "Multisig control concentration"
**remediationHint:** "Increase signer count to 5+ with threshold of 3-of-5 or higher. Ensure signers are independent parties (different organizations, geographies, or roles)."

#### GOV-004: Current-balance voting without snapshot

**Trigger conditions** (all):
- Governor contract detected (OZ or Compound Bravo)
- Voting uses `balanceOf()` instead of `getPastVotes()` / `getPriorVotes()`
- OR Governor ABI lacks snapshot-based voting functions

**Data sources:**
- Contract ABI inspection (static analysis)
- Runtime check: call `getVotes(address, blockNumber)` — should not revert

**Severity:** HIGH
**publicTitle:** "Governance vote weighting risk"
**remediationHint:** "Use snapshot-based voting (Governor + ERC20Votes / ERC721Votes) instead of current-balance. Snapshot prevents flash-loan vote manipulation."

#### GOV-005: Proxy admin misconfiguration

**Trigger conditions** (any, depending on proxy type):

For EIP-1967 Transparent Proxy:
- Admin slot contains EOA (not contract)
- Admin is the same as implementation owner (bypass)
- ProxyAdmin contract owner is EOA

For EIP-1822 UUPS:
- `_authorizeUpgrade` function in implementation has weak access control
- Upgrade authorization bypasses governance

For non-standard proxies (Audius-style):
- Storage slot 0 contains non-zero value that could collide with implementation variables
- Admin storage location not at EIP-1967 standard slot

**Data sources:**
- viem `getStorageAt` for EIP-1967 slots (0x360894..., 0xb53127...)
- Contract bytecode analysis for proxy pattern detection
- Etherscan verification check for implementation

**Severity:** HIGH
**publicTitle:** "Proxy upgrade control weakness"
**remediationHint:** "Proxy admin should be a Timelock-guarded contract, not an EOA. For UUPS, ensure `_authorizeUpgrade` requires governance approval. For non-standard proxies, migrate to EIP-1967 standard slots to prevent storage collisions."

#### GOV-006: Upgradeable without emergency pause

**Trigger conditions** (all):
- Contract is upgradeable (proxy detected)
- No pause mechanism detected in implementation (no `pause()`, `_pause()`, or `Pausable` inheritance)
- No emergency controller role

**Data sources:**
- Implementation ABI inspection
- Role check against common pause patterns

**Severity:** MEDIUM
**publicTitle:** "Upgrade risk without safeguards"
**remediationHint:** "Add a pause mechanism to upgradeable contracts. During emergencies, pausing prevents ongoing exploitation while upgrade governance processes. OpenZeppelin's Pausable pattern is recommended."

### §5.3 Scoring algorithm

Module score calculation:

```
baseScore = 100
severityPenalty = { CRITICAL: 35, HIGH: 20, MEDIUM: 10, LOW: 5, INFO: 0 }

for each finding:
  baseScore -= severityPenalty[finding.severity]

moduleScore = max(0, baseScore)
```

Module grade derivation:

```
if findings contain 3+ CRITICAL: grade = F  (floor override)
else if findings contain 2+ CRITICAL: grade = D  (floor override)
else:
  grade = A if score >= 90
        = B if score >= 75
        = C if score >= 60
        = D if score >= 40
        = F otherwise
```

Rationale for floor override: compound effects (Drift scenario: missing timelock + signer concentration + bypass path) should not average out to "B" just because penalties are additive.

### §5.4 Supported chains

Ethereum mainnet only for Plan 02.

Out of scope (deferred to Plan 03+):
- L2s (Arbitrum, Optimism, Base) — require adapting to L2-specific governance primitives
- Solana — requires entirely different detector set for SPL Governance + Realms

Code should be structured to make chain-specific extension straightforward: detector logic lives under `src/lib/detectors/governance/` with clean interfaces for on-chain data providers that can be swapped per chain.

---

## §6 API changes

### §6.1 POST /api/scan updates

Add Inngest event emission after successful persistence:

```typescript
// After existing scan persistence logic
await inngest.send({
  name: "scan.queued",
  data: {
    scanId: scan.id,
    protocolId: scan.protocolId,
    chain: scan.chain,
    primaryContractAddress: scan.primaryContractAddress,
    modulesEnabled: scan.modulesEnabled,
  },
})

await prisma.scan.update({
  where: { id: scan.id },
  data: { dispatchedAt: new Date() },
})
```

Response shape unchanged. Client backward compatible with Plan 01.

Chain validation: if `chain !== "ETHEREUM"`, persist scan with `status = SKIPPED` and return 202 with `message: "Scan queued (Solana detection available in a future release)"`.

### §6.2 GET /api/scan/[id] updates

Response shape adds findings array when modules have completed. Tier gating applies per §5.3 of Plan 01 spec (unchanged).

Cache headers:
- `Cache-Control: no-store` for non-terminal states (QUEUED, RUNNING, PARTIAL_COMPLETE)
- `Cache-Control: private, max-age=60` for terminal states (COMPLETE, FAILED, EXPIRED)

### §6.3 New: GET /api/scan/[id]/status

Lightweight polling endpoint. Returns only status-level data without full findings payload.

```typescript
// Response shape
{
  id: string,
  status: ScanStatus,
  updatedAt: string,  // ISO timestamp
  modules: Array<{
    module: Module,
    status: ModuleStatus,
    grade: Grade | null,
  }>,
}
```

Rate limit: same as Plan 01 GET endpoint (tier-based).
Response size: ~200 bytes (vs ~2KB for full scan payload).

---

## §7 UI changes

### §7.1 /scan/[id] polling

Add client-side polling to `src/components/scan/ScanShell.tsx`:

```typescript
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

const POLL_INTERVAL_MS = 3000
const MAX_POLL_DURATION_MS = 15 * 60 * 1000  // 15 minutes
const TERMINAL_STATES = ["COMPLETE", "FAILED", "EXPIRED"]

export function useScanPolling(scanId: string, initialStatus: ScanStatus) {
  const router = useRouter()
  const [currentStatus, setCurrentStatus] = useState(initialStatus)
  const [errorCount, setErrorCount] = useState(0)

  useEffect(() => {
    if (TERMINAL_STATES.includes(currentStatus)) return

    const startTime = Date.now()
    let timeoutId: NodeJS.Timeout

    const poll = async () => {
      if (Date.now() - startTime > MAX_POLL_DURATION_MS) return

      try {
        const res = await fetch(`/api/scan/${scanId}/status`)
        if (!res.ok) throw new Error(`Status ${res.status}`)

        const data = await res.json()
        setCurrentStatus(data.status)
        setErrorCount(0)

        if (TERMINAL_STATES.includes(data.status)) {
          // Full page refresh to re-fetch findings with fresh server data
          router.refresh()
          return
        }

        timeoutId = setTimeout(poll, POLL_INTERVAL_MS)
      } catch (err) {
        const nextErrorCount = errorCount + 1
        setErrorCount(nextErrorCount)

        if (nextErrorCount >= 5) return  // stop after 5 consecutive errors

        // Exponential backoff on errors
        const backoffMs = POLL_INTERVAL_MS * Math.pow(2, nextErrorCount)
        timeoutId = setTimeout(poll, backoffMs)
      }
    }

    timeoutId = setTimeout(poll, POLL_INTERVAL_MS)
    return () => clearTimeout(timeoutId)
  }, [scanId, currentStatus, errorCount, router])

  return { currentStatus, errorCount }
}
```

Integration in ScanShell:

```typescript
export function ScanShell({ scan, tier }: ScanShellProps) {
  const { currentStatus } = useScanPolling(scan.id, scan.status)
  // ... rest uses currentStatus for animated status indicators
}
```

### §7.2 FindingsList real rendering

Plan 01 created the component skeleton. Plan 02 activates it with real data now that findings array is populated.

Component already exists at `src/components/scan/FindingsList.tsx`. No changes needed — it handles both empty state (Plan 01 reality) and populated state (Plan 02 reality).

### §7.3 Status indicators

Add subtle CSS animations for in-progress modules:

```typescript
// ModuleCard.tsx addition for RUNNING status
{module.status === "RUNNING" && (
  <div 
    className="flex items-center gap-2"
    role="status"
    aria-live="polite"
  >
    <span className="w-2 h-2 rounded-full bg-accent-sky animate-pulse" />
    <span className="text-sm text-muted">Analyzing...</span>
  </div>
)}
```

Respects `prefers-reduced-motion` via existing Framer Motion patterns from Plan 01.

---

## §8 External dependencies

### §8.1 RPC providers

**Primary:** Ankr public Ethereum RPC
- Endpoint: `https://rpc.ankr.com/eth`
- Public endpoint, no API key required
- Supports `eth_call`, `eth_getStorageAt`, multicall batching
- Environment variable: `PRIMARY_ETH_RPC_URL`

**Fallback:** Cloudflare Ethereum gateway
- Endpoint: `https://cloudflare-eth.com`
- Public endpoint, no API key required
- Used only if Ankr primary fails (connection error, rate limit, timeout)
- Environment variable: `FALLBACK_ETH_RPC_URL`

Both endpoints are public with best-effort availability — no SLA. This is acceptable for Plan 02 dev + early users. Paid provider evaluation (Alchemy, Infura, QuickNode) deferred to Plan 07+ if scan volume or reliability needs warrant.

Failover handled by viem's built-in `fallback` transport in `src/lib/rpc-client.ts`:

```typescript
import { createPublicClient, fallback, http } from "viem"
import { mainnet } from "viem/chains"

export const ethClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http(process.env.PRIMARY_ETH_RPC_URL),
    http(process.env.FALLBACK_ETH_RPC_URL),
  ], {
    rank: false,          // try primary first, fall back on error
    retryCount: 2,
    retryDelay: 150,
  }),
})
```

**Migration path:** If paid provider is adopted in Plan 07+, swap the first `http(...)` to the paid endpoint — no detector-layer code changes required. Detectors consume `ethClient` as an abstract viem `PublicClient`.

### §8.2 Safe API (multisig data)

Safe transaction service endpoints:
- Ethereum mainnet: `https://safe-transaction-mainnet.safe.global/api/v1/`
- Used for: `/safes/{address}/` (owners + threshold), `/safes/{address}/modules/` (enabled modules)
- Rate limit: 100 req/min per IP (unofficial)
- No API key required

Environment variable: `SAFE_API_BASE_URL` (allows pointing at different chain endpoints later)

### §8.3 Etherscan API

For contract ABI + verification status:
- Endpoint: `https://api.etherscan.io/api`
- Used for: `?module=contract&action=getabi&address={address}`
- Free tier: 5 calls/second, 100K calls/day
- Environment variable: `ETHERSCAN_API_KEY`

Fallback if Etherscan unavailable: skip ABI-dependent detectors (GOV-002) with `ModuleRun.errorMessage`.

### §8.4 Rate limits and caching

Per-scan external call budget:
- viem multicall via RPC: 1 batched RPC call (50-100 reads in one HTTP request)
- Safe API: 1-2 calls (if multisig detected)
- Etherscan: 1-3 calls (ABI fetches)

Total per scan: ~5 external HTTP calls. Ankr/Cloudflare public endpoints are best-effort; viem `fallback` transport handles transient failures.

Caching strategy in Plan 02: **none**. Every scan fetches fresh on-chain state. Plan 07+ introduces protocol-level caching for continuous monitoring.

---

## §9 Environment variables

New for Plan 02:

```bash
# Inngest
INNGEST_EVENT_KEY=xxx
INNGEST_SIGNING_KEY=xxx
INNGEST_APP_ID=breakwater

# RPC + APIs
PRIMARY_ETH_RPC_URL=https://rpc.ankr.com/eth
FALLBACK_ETH_RPC_URL=https://cloudflare-eth.com
ETHERSCAN_API_KEY=xxx
SAFE_API_BASE_URL=https://safe-transaction-mainnet.safe.global/api/v1
```

All must be set on both Preview and Production Vercel scopes before merge.

Carry-over from Plan 01 (unchanged):
`DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `SCAN_IP_SALT`, `SCAN_EMAIL_SALT`, `NEXT_PUBLIC_SITE_URL`.

---

## §10 Testing strategy

### §10.1 Unit tests

Per-detector logic with mocked on-chain data:
- Happy path: detector does not fire on clean protocol
- Detection path: detector fires on known vulnerable fixture
- Edge cases: missing contract, reverted call, malformed data

Fixture protocols in `src/lib/detectors/governance/__tests__/fixtures.ts`:
- `cleanUniswapV3Fixture` — should trigger 0 detectors
- `driftLikeFixture` — should trigger GOV-001, GOV-002, GOV-003
- `beanstalkLikeFixture` — should trigger GOV-001, GOV-002, GOV-004
- `audiusLikeFixture` — should trigger GOV-005, GOV-006

Target: ≥85% coverage per detector.

### §10.2 Integration tests

End-to-end scan flow with Inngest dev server + test DB:
- Submit scan via POST /api/scan
- Verify `scan.queued` event emitted
- Verify `executeScan` orchestrator runs
- Verify `executeGovernanceModule` runs
- Verify findings persisted
- Verify GET /api/scan/[id] returns findings
- Verify status transitions QUEUED → RUNNING → COMPLETE

Uses Inngest dev server (`npx inngest-cli dev`) for local event bus.

### §10.3 Fixture-based regression tests

Critical test: "Breakwater would detect Drift":
- Load Drift-like governance state into test DB
- Run governance module against fixture
- Assert GOV-001, GOV-002, GOV-003 all fire
- Assert module grade = F (3+ CRITICAL floor override)

Similar tests for Beanstalk, Audius fixtures.

### §10.4 Testing Inngest functions

Use Inngest's built-in testing helpers:

```typescript
import { executeGovernanceModule } from "@/lib/inngest/functions/execute-governance"

test("executeGovernanceModule happy path", async () => {
  const result = await executeGovernanceModule.run({
    event: {
      name: "scan.module.requested",
      data: { scanId: "test-scan-1", module: "GOVERNANCE" },
    },
  })

  expect(result.status).toBe("COMPLETE")
})
```

---

## §11 Privacy, security

### §11.1 RPC key handling

- `ETHERSCAN_API_KEY` is server-only (no `NEXT_PUBLIC_` prefix)
- `PRIMARY_ETH_RPC_URL` and `FALLBACK_ETH_RPC_URL` are public endpoints but kept server-only as well — never exposed to the client via `NEXT_PUBLIC_`
- Keys rotated per environment (dev/preview/production each have unique keys where keys exist)
- Inngest functions run server-side, so keys never exposed to client
- Assertion in `assertProductionConfig` at module load time

### §11.2 Cache invalidation

Plan 02 does not cache on-chain data. Each scan triggers fresh state reads. This is acceptable for Plan 02 scale but will require revisiting in Plan 07 when scheduled re-scans are introduced.

### §11.3 Finding attribution

Findings include `detectorVersion` for reproducibility. If detector logic changes (false positive fix, severity adjustment), new scans produce `detectorVersion: "1.1.0"` while historical findings remain at `1.0.0`. This allows explaining grade changes over time.

### §11.4 Data retention

Plan 01 spec §11 covered 30-day retention. `GovernanceSnapshot.rawState` is large (5-20KB JSON per scan) — included in 30-day retention policy. Expired scans cascade-delete snapshots.

---

## §12 Deployment

### §12.1 Inngest Cloud setup

Steps:
1. Create Inngest project at inngest.com
2. Link GitHub repo: `RobertWils/breakwater`
3. Generate event key + signing key → add to Vercel env vars
4. Deploy handler route to Vercel
5. Verify Inngest dashboard shows functions registered

### §12.2 Vercel config

Additions to existing Vercel setup:
- Environment variables per §9
- No changes to build config or deployment regions
- Inngest handler route timeout: default (Vercel handles as normal Next.js API route; Inngest manages long-running execution server-side)

### §12.3 Rollout strategy

Phased deployment within Plan 02:
1. Deploy Inngest integration, verify dev server connectivity
2. Deploy GovernanceSnapshot persistence (no detector logic yet)
3. Deploy detectors incrementally (GOV-001, then GOV-002, etc.)
4. Enable frontend polling (requires full path working)
5. Final integration test on preview before merge

---

## §13 Breaking changes from Plan 01

None. Plan 02 is additive:
- New Prisma models (GovernanceSnapshot)
- New Scan/ModuleRun/Finding fields (nullable additions)
- New API endpoint (GET /api/scan/[id]/status) — not replacing existing
- New Inngest handler route
- FindingsList component now renders real data (was empty state in Plan 01)

Existing Plan 01 scans (dispatchedAt: NULL) remain in QUEUED status forever — no retroactive execution. Users who want to re-scan can submit a new scan.

---

## §14 Exit criteria

Hard criteria (must pass for Plan 02 merge):

- [ ] All 6 detectors implemented with unit tests ≥85% coverage
- [ ] End-to-end integration test: submit → Inngest → detect → persist → UI update
- [ ] Drift-like fixture triggers GOV-001, GOV-002, GOV-003 (grade F)
- [ ] Beanstalk-like fixture triggers GOV-001, GOV-002, GOV-004
- [ ] Audius-like fixture triggers GOV-005, GOV-006
- [ ] /scan/[id] polling works without regression on Plan 01 tests
- [ ] Production build green on Vercel with all env vars
- [ ] Inngest dashboard shows successful function runs
- [ ] All 204 Plan 01 tests still pass
- [ ] New test count: 60+ (detector unit + integration + Inngest tests)
- [ ] Codex review passed with findings resolved

Soft criteria (target, not blocking):
- [ ] Average scan execution time <30s end-to-end
- [ ] 5 real Ethereum protocols produce sane results (Aave, Uniswap, Compound, Lido, MakerDAO)
- [ ] Lighthouse A11y ≥90 on /scan/[id] (maintained from Plan 01)
- [ ] Zero RPC rate limit hits during local testing

---

## §15 Rollback strategy

If Plan 02 production deploy fails:

**Immediate rollback:** Vercel dashboard → previous production deployment (Plan 01). Takes ~30 seconds.

**Partial rollback:** If Inngest integration breaks but rest works:
- Feature flag `BREAKWATER_GOVERNANCE_MODULE_ENABLED=false` in env vars
- POST /api/scan checks flag before emitting Inngest event
- Scans persist with QUEUED status (Plan 01 behavior) while module is disabled

Feature flag mechanism should be part of Plan 02 initial implementation.

---

## §16 Observability + analytics

Lightweight metrics via structured logs (Railway log aggregation):

Events to log:
- `scan.submitted` (scanId, chain, module enabled)
- `scan.dispatched` (scanId, Inngest event ID)
- `scan.module.started` (scanId, module)
- `scan.module.completed` (scanId, module, grade, executionMs)
- `scan.completed` (scanId, compositeGrade, totalExecutionMs)
- `scan.failed` (scanId, module, errorCode)
- `detector.fired` (scanId, detectorId, severity)

Metrics derivable from logs (manual or via Inngest dashboard):
- Scans per day
- Detection rate per detector
- Avg execution time per module
- Error rates
- Flask app error rate

Plan 07+ may add formal analytics (PostHog, Mixpanel) for user-facing events.

---

## §17 Known deferrals to Plan 03+

Detector modules:
- Oracle module (Kelp DAO $292M, Drift oracle, Compound oracle)
- Signer module (multisig trace, key rotation detection)
- Frontend module (domain hijack, JS integrity, DNS tampering)

Governance module extensions:
- Solana governance (SPL Governance, Realms)
- L2-specific governance (Arbitrum Security Council, Optimism Upgrade Keys)
- MakerDAO DSPauseProxy / spell pattern
- Snapshot → safeSnap hybrid governance
- Proposal simulation (execute proposal against forked state)
- Token-wash-trading detection in voting weight
- Signer clustering / Sybil detection

Platform features:
- Email notifications on scan completion
- Paid tier with remediation detail + monitoring
- Continuous monitoring with scheduled re-scans
- Public scan sharing UI
- Browser extension for signer alerts
- Slack/Telegram integrations

Infrastructure:
- Dedicated production database (separate from dev)
- Custom domain (breakwater.so or chosen alternative)
- CDN for static assets
- Performance budget tracking (Lighthouse CI)

---

## §18 Open questions for spec review

Items requiring Robert's decision before implementation starts:

1. **Inngest Cloud vs self-hosted:** Inngest Cloud free tier = 50K runs/month. At ~5 Inngest runs per scan, that's 10K scans/month free. Worth noting: if we outgrow free tier, self-hosted Inngest on Railway is an option but adds ops overhead.

2. **Public RPC endpoints (resolved):** Plan 02 uses public RPC endpoints (Ankr primary, Cloudflare fallback). No API keys required. Viem's `fallback` transport handles automatic switching on connection errors. Paid provider evaluation (Alchemy, Infura, QuickNode) deferred to Plan 07+ if scan volume or reliability needs warrant.

3. **Feature flag infrastructure:** Plan 02 uses simple env var for module toggle. Do we adopt a feature flag service (Vercel Flags, LaunchDarkly) now or defer to Plan 07?

4. **Detector versioning policy:** Plan 02 starts with `detectorVersion: "1.0.0"` for all. Semver policy: when do we increment? Proposal: patch for false positive fixes, minor for severity adjustments, major for detection logic changes.

5. **Rate limiting for external APIs:** What's our strategy if Alchemy rate limits hit? Queue scans? Reject with 503? Plan 02 assumes no rate limit hits, but production traffic may force answer.

These answers drive final spec freeze.

---

## Appendix A: Architecture diagram

See the execution flow diagram in the implementation kickoff conversation. Summary: User → POST /api/scan → Prisma persist → Inngest event → executeScan orchestrator → executeGovernanceModule → viem multicall + Safe API + Etherscan → 6 detectors → findings persist → UI polls → status COMPLETE.

## Appendix B: References

Research docs:
- `docs/research/2026-04-22-governance-incidents.md` (commit c1d9642)

Prior art / inspiration:
- OpenZeppelin Defender — production detector reference
- Tenderly — proposal simulation
- DeFiSafety — protocol scoring model

Library docs:
- Inngest: https://inngest.com/docs
- viem: https://viem.sh
- Safe Transaction Service: https://docs.safe.global/core-api/transaction-service-overview

---

**Next steps after spec freeze:**
1. Commit spec to main on SHA X
2. Mark frozen in NOTES.md
3. Generate implementation.md (sub-tasks, phases)
4. Create plan-02-dispatcher worktree
5. Begin Phase A of implementation
