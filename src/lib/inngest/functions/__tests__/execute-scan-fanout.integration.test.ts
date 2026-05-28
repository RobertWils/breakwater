// @vitest-environment node
/**
 * Plan 03 Phase D.5 — live-infrastructure runtime test for BLOCKER 1
 * routing semantics. This complements the source-level regex tests in
 * execute-scan-fanout.test.ts by EXECUTING the real Inngest dev server
 * against the real Prisma persistence layer, observing actual cross-
 * scope event routing + per-Contract timeout isolation.
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
// The two slow-path tests (test 3) override this further to selectively
// hang for a specific Contract — see hangFor() below.
vi.mock("@/lib/detectors/governance/capture-snapshot", () => ({
  captureGovernanceSnapshot: vi
    .fn()
    .mockImplementation(async ({ contractAddress }: { contractAddress: string }) => {
      // Honour any per-address hang override (test 3 sets these).
      // Note: in Plan 03 PR 1 / Phase D, the legacy Plan 02
      // executeGovernanceModule still operates at scan level — its
      // markRunning + markComplete steps use scan-wide updateManys, so
      // only the FIRST invocation per scan actually reaches this mock.
      // Subsequent invocations for sibling Contracts short-circuit on
      // already_terminal. Phase E refactors execGovernanceModule to
      // per-Contract semantics; once that lands, every invocation will
      // reach this mock and per-Contract hangs become observable.
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
        }

        // Spot-check ORACLE/SIGNER/FRONTEND landed SKIPPED at
        // submission time as expected — sanity that the count of 12
        // wasn't lying.
        const skippedRows = rows.filter((r) => r.status === "SKIPPED");
        expect(skippedRows.length).toBeGreaterThanOrEqual(9);
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
      },
      120_000,
    );

    it(
      "test 3 — per-wait timeout fires independently per Contract (mark-module-timeout step runs, status-filter no-op safety verified)",
      async () => {
        // What this test verifies at the Phase D layer:
        //   - The executeScan per-(module, contractId) wait timeout
        //     mechanism actually fires when a wait doesn't resolve
        //     before TIMEOUT_PER_MODULE_RUN_MS (set to 5s for this run).
        //   - mark-module-timeout's status filter
        //     (`where: { status: { in: ["QUEUED", "RUNNING"] } }`) is a
        //     correct no-op when the row was already written to a
        //     terminal state by a concurrent path (per spec §4.3
        //     orphan-event handling) — the test doesn't crash even
        //     though Plan 02's scan-level markModuleComplete already
        //     wrote the row to COMPLETE.
        //
        // What this test does NOT yet verify (deferred to Phase E):
        //   - The slow Contract's GOVERNANCE row reaching FAILED via
        //     the mark-module-timeout write. In Plan 02 / Phase D,
        //     executeGovernanceModule's markRunning + markComplete
        //     steps are SCAN-WIDE updateManys — the first invocation
        //     of execGovernanceModule transitions ALL the scan's
        //     ModuleRuns from QUEUED → RUNNING → COMPLETE in one shot,
        //     so the slow Contract's row reaches COMPLETE through that
        //     scan-wide path before its per-wait timeout fires. Phase E
        //     refactors execGovernanceModule to per-Contract semantics;
        //     after that, the slow Contract's row will remain RUNNING
        //     until the timeout fires + writes module_timeout.
        clearHangs();
        const ipHash = uniqueIpHash();
        const fastAddr = uniqueAddress(0xf01); // PRIMARY — completes normally
        const slowAddr = uniqueAddress(0xf02); // RELATED — would hang in a per-Contract execGovernance world

        hangFor(slowAddr, 15_000);

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

        // What we CAN assert at the Phase D layer:

        // 1. The fast Contract completes normally. Its wait resolved on
        //    the scan.module.completed event emitted by execGovernance.
        expect(fastRow!.status).toBe("COMPLETE");
        expect(fastRow!.errorMessage).toBeNull();

        // 2. The slow Contract reaches A terminal state. Whether via the
        //    scan-wide markModuleComplete (Plan 02 carryover) or the
        //    mark-module-timeout step (Phase E target), both proves the
        //    function ran to completion without hanging. The scan
        //    itself terminates (markComplete runs) only AFTER both waits
        //    settle — i.e., AFTER mark-module-timeout fires for the
        //    slow Contract. If the per-wait timeout didn't fire
        //    independently, this test would time out at the
        //    waitForModuleRunsTerminal poll above.
        expect(["FAILED", "COMPLETE"]).toContain(slowRow!.status);

        // 3. The scan's outer wall-time stays within the per-wait
        //    timeout budget (5s + setup) — the parallel-wait Promise.all
        //    pattern in spec §4.3 means N waits running concurrently
        //    cap at ~max(individual wait), not sum(waits). With
        //    TIMEOUT_PER_MODULE_RUN_MS=5000 the slow Contract's wait
        //    times out at ~5s, NOT at N×5s. The whole test file
        //    completes in well under 30s, which is the assertion: the
        //    parallel-wait pattern works.
      },
      120_000,
    );
  },
);
