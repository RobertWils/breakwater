// @vitest-environment node
/**
 * Plan 03 Phase D.5 (strengthened in Phase E.4) — live-infrastructure
 * runtime test for BLOCKER 1 routing semantics. Complements the
 * source-level regex tests in execute-scan-fanout.test.ts by EXECUTING
 * the real Inngest dev server against the real Prisma persistence
 * layer, observing actual cross-scope event routing + per-Contract
 * timeout isolation.
 *
 * Phase E.2 made `executeGovernanceModule` per-Contract — its
 * markRunning, persist, and markComplete steps all scope by
 * (scanId, module, contractId). That removed the scan-wide updateMany
 * that previously masked per-Contract routing failures (Plan 02
 * carryover): every invocation now transitions ONLY its own ModuleRun
 * row, every invocation emits ONLY its own scan.module.completed event,
 * and the load-bearing claims below are genuinely verified end-to-end.
 *
 * Verified by deliberate regression (see Phase E.4 commit body): an
 * `event.data.contractId` revert in the wait expression makes Test 1
 * + Test 3 fail with rows stuck at module_timeout.
 *
 * Two layers of assertion (Codex Review #4 IMPORTANT 2):
 *   - ModuleRun.status / completedAt / findingsCount: the EXECUTOR
 *     proof. Each row was finalized by its OWN executeGovernanceModule
 *     invocation (Phase E.2 per-Contract scoping).
 *   - Scan.status === "COMPLETE": the SCAN-LEVEL FINALIZATION proof.
 *     executeScan only reaches mark-complete after every waitForEvent
 *     settles AND every ModuleRun is terminal — a `stuck-wait`
 *     regression (predicate that never matches) leaves
 *     `step.waitForEvent` waiting until its per-wait timeout fires;
 *     a `racing-wait` regression where mark-complete fires before
 *     executors finish would return `deferred` and leave Scan.status
 *     at RUNNING. Test 3's strict slow-row assertion catches the
 *     complementary `eager-wait` regressions (predicates that match
 *     the wrong event) — the two assertions together waterproof the
 *     routing claim end-to-end.
 *
 * Infrastructure spun up per file (beforeAll/afterAll):
 *   - Docker Postgres on localhost:5433 (db: breakwater_test)
 *   - Inngest dev server (`npx inngest-cli@latest dev`) on localhost:8288
 *   - Node HTTP server on localhost:3010 hosting the inngest/node serve
 *     handler with the real executeScan + executeGovernanceModule
 *
 * The serve handler runs IN-PROCESS, so vi.mock declarations in this
 * file affect the function bodies (specifically the
 * capture-detect-persist step, mocked to skip real RPC and return a
 * deterministic snapshot).
 *
 * Skip when SKIP_INNGEST_INTEGRATION=true OR Docker isn't reachable —
 * the helper's integrationEnvAvailable() guards both. CI should set
 * SKIP_INNGEST_INTEGRATION=true unless the runner has Docker + can
 * spawn npx subprocesses.
 *
 * Wall-time budget: tests 1+2 each take ~5-8s (Inngest dispatch +
 * step execution latency); test 3 takes ~10-15s (it has to wait for
 * the per-Contract timeout to fire — overridden to 5s via
 * TIMEOUT_PER_MODULE_RUN_MS). beforeAll setup is ~10-15s
 * (postgres + migrations + Inngest dev start).
 */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ── Hoisted env-var setup ────────────────────────────────────────────────
// These must land before any prisma / inngest import so module-load-time
// captures pick up the test values.
vi.hoisted(() => {
  process.env.DATABASE_URL =
    "postgresql://postgres:test@localhost:5433/breakwater_test";
  process.env.INNGEST_DEV = "http://127.0.0.1:8288";
  process.env.INNGEST_EVENT_KEY = "test-event-key";
  process.env.INNGEST_APP_ID = "breakwater-d5-test";
  process.env.SCAN_IP_SALT = "d5-ip-salt";
  process.env.SCAN_EMAIL_SALT = "d5-email-salt";
  // 5 second per-Contract wait timeout for test 3.
  process.env.TIMEOUT_PER_MODULE_RUN_MS = "5000";
});

// Mock the snapshot capture so the test doesn't make real RPC calls.
// Test 3 overrides this per-address via hangFor() to make ONE Contract
// hang past its per-wait timeout while siblings complete normally.
vi.mock("@/lib/detectors/governance/capture-snapshot", () => ({
  captureGovernanceSnapshot: vi
    .fn()
    .mockImplementation(async ({ contractAddress }: { contractAddress: string }) => {
      // Phase E.2 made executeGovernanceModule per-Contract, so every
      // invocation reaches this mock (one per Contract per scan).
      // Per-Contract hangs are therefore observable: test 3 hangs the
      // slow Contract for 15s, the others complete within ms — only
      // the slow row hits module_timeout.
      const hangMs = HANG_OVERRIDES.get(contractAddress.toLowerCase());
      if (hangMs && hangMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, hangMs));
      }
      return {
        blockNumber: BigInt(20_000_000),
        capturedAt: new Date(),
        hasGovernor: false,
        governorAddress: null,
        governorType: null,
        governorVersion: null,
        hasTimelock: false,
        timelockAddress: null,
        timelockMinDelay: null,
        timelockAdmin: null,
        timelockAdminIsContract: null,
        hasMultisig: false,
        multisigAddress: null,
        multisigThreshold: null,
        multisigOwnerCount: null,
        multisigOwners: [],
        proxyType: "NONE",
        proxyAdminAddress: null,
        proxyImplementation: null,
        proxyVerified: false,
        proxyAdminIsContract: null,
        implementationAbi: null,
        protocolAbi: null,
        votingTokenAddress: null,
        votingSnapshotType: null,
        rawState: { role: "PRIMARY" },
      };
    }),
}));

const HANG_OVERRIDES = new Map<string, number>();
function hangFor(address: string, ms: number): void {
  HANG_OVERRIDES.set(address.toLowerCase(), ms);
}
function clearHangs(): void {
  HANG_OVERRIDES.clear();
}

// ── Imports (after the hoisted env + mocks above) ────────────────────────
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { executeGovernanceModule } from "@/lib/inngest/functions/execute-governance-module";
import { executeScan } from "@/lib/inngest/functions/execute-scan";
import { submitScan } from "@/lib/scan-submission";

import {
  integrationEnvAvailable,
  setupIntegrationEnv,
  teardownIntegrationEnv,
} from "./helpers/integration-setup";

const SHOULD_RUN = integrationEnvAvailable();

// ── Test fixtures ────────────────────────────────────────────────────────

function uniqueAddress(seed: number): string {
  // Deterministic 0x-prefixed 40-char hex from a seed. Seed at the
  // FRONT (not padStart) so the slug derivation in generateSlug —
  // which takes the first 14 chars — doesn't collide across seeds.
  // generateSlug: `chain-${first-14-chars-of-address}` →
  //   0x + 12 hex of seed = 14 chars unique per seed.
  return "0x" + seed.toString(16).padEnd(40, "0");
}

function uniqueIpHash(): string {
  return "d5-" + Math.random().toString(36).slice(2, 14);
}

// ── Wait helper: poll the DB for a ModuleRun terminal state ──────────────

async function waitForModuleRunsTerminal(
  scanId: string,
  expected: number,
  timeoutMs = 30_000,
): Promise<
  Array<{ contractId: string | null; status: string; errorMessage: string | null }>
> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await prisma.moduleRun.findMany({
      where: { scanId },
      select: { contractId: true, status: true, errorMessage: true },
    });
    if (rows.length === expected) {
      const allTerminal = rows.every((r) =>
        ["COMPLETE", "FAILED", "SKIPPED"].includes(r.status),
      );
      if (allTerminal) return rows;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `[d5] Timed out waiting for ${expected} terminal ModuleRuns on scan ${scanId}`,
  );
}

// Codex Review #4 IMPORTANT 2 — Scan-level completion is the
// wait-expression routing proof. executeScan only reaches mark-complete
// after every waitForEvent settles; a stuck wait keeps Scan.status at
// RUNNING (markRunning's write) because mark-complete returns
// `deferred` when not all ModuleRuns are terminal. Use a generous
// window (15s) — under correct routing, scan transitions to COMPLETE
// within ~1s of the last ModuleRun reaching terminal; under broken
// routing the scan never transitions, and we want a clean error
// message instead of vitest's own per-test timeout.
async function waitForScanStatus(
  scanId: string,
  expected: "COMPLETE" | "FAILED",
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const scan = await prisma.scan.findUnique({
      where: { id: scanId },
      select: { status: true },
    });
    if (scan?.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const finalScan = await prisma.scan.findUnique({
    where: { id: scanId },
    select: { status: true },
  });
  throw new Error(
    `[d5] Timed out waiting for Scan ${scanId} to reach ${expected}, current status: ${finalScan?.status ?? "missing"}`,
  );
}

// ── Setup ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!SHOULD_RUN) return;
  await setupIntegrationEnv({
    client: inngest,
    functions: [executeScan, executeGovernanceModule],
  });
}, 120_000);

afterAll(async () => {
  if (!SHOULD_RUN) return;
  await prisma.$disconnect();
  await teardownIntegrationEnv();
}, 60_000);

// ── Tests ────────────────────────────────────────────────────────────────

describe.skipIf(!SHOULD_RUN)(
  "executeScan fan-out — Plan 03 §4.3 routing (live Inngest)",
  () => {
    it(
      "test 1 — per-Contract routing: each Contract's waitForEvent resolves with its OWN completion event (3 Contracts)",
      async () => {
        clearHangs();
        const ipHash = uniqueIpHash();
        const primary = uniqueAddress(0x111);
        const impl = uniqueAddress(0x222);
        const timelock = uniqueAddress(0x333);

        const result = await submitScan({
          input: {
            chain: "ETHEREUM",
            primaryContractAddress: primary,
            extraContractAddresses: [],
            relatedContracts: [
              { address: impl, role: "PROXY_IMPLEMENTATION", crossChainTwins: [] },
              { address: timelock, role: "TIMELOCK", crossChainTwins: [] },
            ],
            multisigs: [],
            modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
          },
          userId: null,
          userEmail: null,
          ip: "1.2.3.4",
          ipHash,
          userAgent: "d5-test/1.0",
        });
        expect(result.statusCode).toBe(202);

        // 3 Contracts × 4 ModuleNames = 12 ModuleRun rows total.
        // GOVERNANCE rows for the 3 governance-applicable roles should
        // run end-to-end; ORACLE/SIGNER/FRONTEND seeded SKIPPED already.
        const rows = await waitForModuleRunsTerminal(result.scanId, 12, 30_000);

        // Pull only the GOVERNANCE rows — those are the ones that
        // actually round-tripped through the Inngest router.
        const govRows = await prisma.moduleRun.findMany({
          where: { scanId: result.scanId, module: "GOVERNANCE" },
          include: { contract: { select: { id: true, address: true, role: true } } },
        });
        expect(govRows).toHaveLength(3);

        // Every governance ModuleRun reached COMPLETE — and the
        // contractId on each row matches its Contract's id. If the
        // if-expression routing was broken (cross-scope match, wrong
        // contractId), some of these would still be QUEUED / RUNNING
        // or FAILED with module_timeout.
        for (const row of govRows) {
          expect(row.status).toBe("COMPLETE");
          expect(row.errorMessage).toBeNull();
          expect(row.contractId).toBe(row.contract!.id);
          // Phase E.4 strengthening: each row was finalized by its OWN
          // executeGovernanceModule invocation, so completedAt /
          // findingsCount must be set per-row (no scan-wide updateMany
          // batched these — that would have left findingsCount null
          // for siblings under Plan 02's carryover).
          expect(row.completedAt).not.toBeNull();
          expect(row.findingsCount).not.toBeNull();
          expect(row.startedAt).not.toBeNull();
        }

        // Phase E.4 strengthening: prove the rows were updated by
        // separate executions (not one scan-wide updateMany). Under
        // Plan 02's scan-wide markComplete, all 3 rows shared a single
        // updateMany call — completedAt would be identical to the ms
        // for all three. Per-Contract execution means three distinct
        // invocations write three distinct timestamps; the set of
        // distinct completedAt millis is > 1.
        const completedAtMs = new Set(
          govRows.map((r) => r.completedAt!.getTime()),
        );
        expect(completedAtMs.size).toBeGreaterThan(1);

        // Spot-check ORACLE/SIGNER/FRONTEND landed SKIPPED at
        // submission time as expected — sanity that the count of 12
        // wasn't lying.
        const skippedRows = rows.filter((r) => r.status === "SKIPPED");
        expect(skippedRows.length).toBeGreaterThanOrEqual(9);

        // Codex Review #4 IMPORTANT 2 — wait-expression routing proof.
        // executeScan only reaches mark-complete after every
        // waitForEvent settles. A regression to the wait predicate
        // that left a wait stuck would keep Scan.status at RUNNING
        // (markRunning's write) because mark-complete returns
        // `deferred` when ModuleRuns are not all terminal.
        await waitForScanStatus(result.scanId, "COMPLETE");
      },
      120_000,
    );

    it(
      "test 2 — cross-scope isolation: completion events from scan A do NOT resume scan B's waiters (2 scans × 2 Contracts)",
      async () => {
        clearHangs();

        const scanAEvents = {
          input: {
            chain: "ETHEREUM" as const,
            primaryContractAddress: uniqueAddress(0xa01),
            extraContractAddresses: [],
            relatedContracts: [
              { address: uniqueAddress(0xa02), role: "RELATED" as const, crossChainTwins: [] },
            ],
            multisigs: [],
            modulesEnabled: [
              "GOVERNANCE" as const,
              "ORACLE" as const,
              "SIGNER" as const,
              "FRONTEND" as const,
            ],
          },
          userId: null,
          userEmail: null,
          ip: "2.0.0.1",
          ipHash: uniqueIpHash(),
          userAgent: "d5-test/1.0",
        };
        const scanBEvents = {
          input: {
            chain: "ETHEREUM" as const,
            primaryContractAddress: uniqueAddress(0xb01),
            extraContractAddresses: [],
            relatedContracts: [
              { address: uniqueAddress(0xb02), role: "RELATED" as const, crossChainTwins: [] },
            ],
            multisigs: [],
            modulesEnabled: [
              "GOVERNANCE" as const,
              "ORACLE" as const,
              "SIGNER" as const,
              "FRONTEND" as const,
            ],
          },
          userId: null,
          userEmail: null,
          ip: "2.0.0.2",
          ipHash: uniqueIpHash(),
          userAgent: "d5-test/1.0",
        };

        // Submit concurrently so both scans' dispatch + wait happen in
        // overlapping time windows — the only thing that prevents
        // cross-scope event resumption is the if-expression's
        // event.data.scanId == async.data.scanId equality.
        const [resA, resB] = await Promise.all([
          submitScan(scanAEvents),
          submitScan(scanBEvents),
        ]);
        expect(resA.statusCode).toBe(202);
        expect(resB.statusCode).toBe(202);

        // Wait for both scans' (2 Contracts × 4 modules =) 8 ModuleRun
        // rows each to terminate.
        await Promise.all([
          waitForModuleRunsTerminal(resA.scanId, 8, 30_000),
          waitForModuleRunsTerminal(resB.scanId, 8, 30_000),
        ]);

        // Both scans' GOVERNANCE rows COMPLETE — neither got starved
        // because of cross-scope event consumption.
        const govA = await prisma.moduleRun.findMany({
          where: { scanId: resA.scanId, module: "GOVERNANCE" },
          include: { contract: { select: { address: true } } },
        });
        const govB = await prisma.moduleRun.findMany({
          where: { scanId: resB.scanId, module: "GOVERNANCE" },
          include: { contract: { select: { address: true } } },
        });
        expect(govA).toHaveLength(2);
        expect(govB).toHaveLength(2);
        for (const row of [...govA, ...govB]) {
          expect(row.status).toBe("COMPLETE");
          expect(row.errorMessage).toBeNull();
          // Phase E.4 strengthening: each row was finalized by its own
          // executeGovernanceModule invocation. Under Plan 02's
          // scan-wide markComplete, sibling rows shared one updateMany
          // call — findingsCount was set ONLY on the first invocation
          // and remained null on siblings. Per-Contract execution
          // means every row has its own findingsCount + completedAt.
          expect(row.completedAt).not.toBeNull();
          expect(row.findingsCount).not.toBeNull();
        }

        // Stronger: every GOVERNANCE ModuleRun belongs to its OWN scan's
        // Contract list. Cross-contamination would mean scan A's
        // ModuleRun.contractId pointed at one of scan B's Contracts.
        const aContractIds = new Set(govA.map((r) => r.contractId));
        const bContractIds = new Set(govB.map((r) => r.contractId));
        const intersection = Array.from(aContractIds).filter((id) =>
          bContractIds.has(id),
        );
        expect(intersection).toEqual([]);

        // Codex Review #4 IMPORTANT 2 — wait-expression routing proof
        // for BOTH scans. A cross-scope regression (e.g., dropping
        // `event.data.scanId == async.data.scanId`) would let scan A's
        // waits consume scan B's events and vice versa — one scan's
        // mark-complete fires early on the other's events while its
        // OWN ModuleRuns are still RUNNING → mark-complete returns
        // `deferred` → Scan.status stays RUNNING. Asserting both
        // scans reach COMPLETE within the same poll window rules out
        // that failure mode.
        await Promise.all([
          waitForScanStatus(resA.scanId, "COMPLETE"),
          waitForScanStatus(resB.scanId, "COMPLETE"),
        ]);
      },
      120_000,
    );

    it(
      "test 3 — per-wait timeout fires independently per Contract (slow Contract → FAILED/module_timeout, fast Contract → COMPLETE, parallel-wait wall-time bound)",
      async () => {
        // Phase E.4 strengthening: with executeGovernanceModule
        // per-Contract (Phase E.2), the slow Contract's row stays
        // RUNNING until its OWN per-wait timeout fires + writes
        // module_timeout. The scan-wide markComplete shortcut that
        // previously masked this is gone, so we can assert STRICTLY:
        //   - fast Contract → COMPLETE, errorMessage null
        //   - slow Contract → FAILED, errorMessage "module_timeout"
        //   - scan wall-time bounded by max(per-wait) + setup, NOT
        //     N × per-wait (proves parallel-wait pattern actually runs
        //     N waits concurrently per spec §4.3).
        clearHangs();
        const ipHash = uniqueIpHash();
        const fastAddr = uniqueAddress(0xf01); // PRIMARY — completes normally
        const slowAddr = uniqueAddress(0xf02); // RELATED — hangs past per-wait timeout

        // Hang 15s; per-wait timeout is 5s. The hang must exceed the
        // timeout by enough that any clock skew doesn't accidentally
        // let the row sneak to COMPLETE.
        hangFor(slowAddr, 15_000);

        const startMs = Date.now();
        const result = await submitScan({
          input: {
            chain: "ETHEREUM",
            primaryContractAddress: fastAddr,
            extraContractAddresses: [],
            relatedContracts: [
              { address: slowAddr, role: "RELATED", crossChainTwins: [] },
            ],
            multisigs: [],
            modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
          },
          userId: null,
          userEmail: null,
          ip: "3.0.0.1",
          ipHash,
          userAgent: "d5-test/1.0",
        });
        expect(result.statusCode).toBe(202);

        await waitForModuleRunsTerminal(result.scanId, 8, 30_000);
        const elapsedMs = Date.now() - startMs;

        const govRows = await prisma.moduleRun.findMany({
          where: { scanId: result.scanId, module: "GOVERNANCE" },
          include: { contract: { select: { address: true } } },
        });
        expect(govRows).toHaveLength(2);

        const fastRow = govRows.find(
          (r) => r.contract!.address.toLowerCase() === fastAddr.toLowerCase(),
        );
        const slowRow = govRows.find(
          (r) => r.contract!.address.toLowerCase() === slowAddr.toLowerCase(),
        );
        expect(fastRow).toBeDefined();
        expect(slowRow).toBeDefined();

        // 1. Fast Contract completes normally. Its wait resolved on the
        //    scan.module.completed event emitted by ITS OWN
        //    executeGovernanceModule invocation.
        expect(fastRow!.status).toBe("COMPLETE");
        expect(fastRow!.errorMessage).toBeNull();

        // 2. Slow Contract reaches FAILED via mark-module-timeout. The
        //    per-Contract markComplete never fired for this row because
        //    its execution is still inside the 15s hang when its
        //    per-wait timer expires at ~5s; mark-module-timeout's
        //    updateMany (status RUNNING → FAILED, errorMessage
        //    "module_timeout") wins the compare-and-set.
        expect(slowRow!.status).toBe("FAILED");
        expect(slowRow!.errorMessage).toBe("module_timeout");

        // 3. Parallel-wait pattern verified: the entire scan settles
        //    bounded by max(individual wait), NOT sum(waits). With
        //    TIMEOUT_PER_MODULE_RUN_MS=5000 and 2 Contracts, a SERIAL
        //    wait pattern would take ≥10s for the slow tier alone
        //    (5s timeout × 2 Contracts); the parallel-wait pattern
        //    settles at ~5s + dispatch/teardown overhead. We allow a
        //    generous 12s ceiling to account for Inngest dispatch
        //    latency + finalize step time without flaking on CI clock
        //    noise — a serial regression would blow past this.
        expect(elapsedMs).toBeLessThan(12_000);
      },
      120_000,
    );
  },
);
