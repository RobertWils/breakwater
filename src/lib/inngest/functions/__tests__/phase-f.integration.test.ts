// @vitest-environment node
/**
 * Phase F end-to-end DB-backed smoke test (Plan 02 F.4.2 + F.5 I2).
 *
 * Walks the Phase F persistence + grade contract against a real Prisma
 * DB. Bypasses the Inngest executor — calls helpers directly in
 * lifecycle order to verify the side effects on Scan + ModuleRun +
 * Finding rows.
 *
 * Coverage:
 *   - markRunning + markModuleRunning lifecycle transitions
 *   - markComplete + markModuleComplete grade + score persistence
 *   - persistSnapshotAndFindings (snapshot upsert + finding createMany
 *     in a single transaction) — F.5 I2 scenario
 *
 * Bypassed (covered elsewhere):
 *   - Inngest event dispatch / step-driven retries (deferred to plan
 *     §H.3 Inngest integration test harness)
 *   - captureGovernanceSnapshot on-chain calls (covered by detect-*
 *     unit tests; live RPC behind LIVE_RPC=1 opt-in)
 *   - Detector logic (covered by GOV-XXX unit tests)
 *
 * Gating: DATABASE_URL must be set (F.5 N2: matches existing
 * scan-submission-integration.test.ts:69 convention). Plan §H.3
 * introduces a dedicated INTEGRATION_TEST gate if needed; tracked in
 * NOTES.md backlog.
 */

import { randomBytes } from "node:crypto";

import {
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Stub transitive next-auth deps so importing the Inngest function modules
// (which transitively touch nothing auth-related, but the lib/prisma module
// import path is shared with the auth-using flows) is safe. Matches
// scan-submission-integration.test.ts.
vi.mock("next-auth/providers/email", () => ({
  default: vi.fn(() => ({ id: "email", type: "email" })),
}));
vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn(() => ({})),
}));
vi.mock("@/lib/resend", () => ({
  resend: null,
  fromEmail: "test@example.com",
  isDevMode: vi.fn(() => true),
  assertProductionConfig: vi.fn(),
  shouldUseSignupUnlockTemplate: vi.fn(() => false),
}));
vi.mock("@/lib/email", () => ({
  renderSigninEmail: vi.fn(),
  renderSignupUnlockEmail: vi.fn(),
}));
vi.mock("@/lib/config", () => ({
  assertProductionConfig: vi.fn(),
  assertProductionHashSalts: vi.fn(),
  assertProductionInngestConfig: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { calculateCompositeGrade } from "@/lib/scoring/composite-grade";

import { baseSnapshot } from "@/lib/detectors/governance/__tests__/fixtures";
import type { GovernanceFindingInput } from "@/lib/detectors/governance/types";

import { markComplete, markRunning } from "../execute-scan";
import {
  markModuleComplete,
  markModuleRunning,
  persistSnapshotAndFindings,
} from "../execute-governance-module";

const hasDb = !!process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 30000 });

// ── fixture helpers ───────────────────────────────────────────────────────

function uniqueEthAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

function uniqueSlug(): string {
  return `pf-${randomBytes(6).toString("hex")}`;
}

function uniqueIpHash(): string {
  return `pf-ip-${randomBytes(8).toString("hex")}`;
}

const createdProtocolIds: string[] = [];

async function cleanup() {
  if (createdProtocolIds.length === 0) return;
  const scans = await prisma.scan.findMany({
    where: { protocolId: { in: createdProtocolIds } },
    select: { id: true },
  });
  const scanIds = scans.map((s) => s.id);
  if (scanIds.length) {
    await prisma.finding.deleteMany({ where: { scanId: { in: scanIds } } });
    await prisma.governanceSnapshot.deleteMany({
      where: { scanId: { in: scanIds } },
    });
    await prisma.scanAttempt.deleteMany({
      where: { scanId: { in: scanIds } },
    });
    await prisma.moduleRun.deleteMany({ where: { scanId: { in: scanIds } } });
    await prisma.scan.deleteMany({ where: { id: { in: scanIds } } });
  }
  await prisma.protocol.deleteMany({
    where: { id: { in: createdProtocolIds } },
  });
}

afterEach(async () => {
  await cleanup();
  createdProtocolIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function seedProtocolAndScan() {
  const address = uniqueEthAddress();
  const protocol = await prisma.protocol.create({
    data: {
      slug: uniqueSlug(),
      displayName: "Phase F Smoke Protocol",
      chain: "ETHEREUM",
      primaryContractAddress: address.toLowerCase(),
      ownershipStatus: "UNCLAIMED",
    },
  });
  createdProtocolIds.push(protocol.id);

  const scan = await prisma.scan.create({
    data: {
      protocolId: protocol.id,
      status: "QUEUED",
      ipHash: uniqueIpHash(),
      userAgent: "phase-f-integration/1.0",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const moduleRun = await prisma.moduleRun.create({
    data: {
      scanId: scan.id,
      module: "GOVERNANCE",
      status: "QUEUED",
      detectorVersions: {},
      inputSnapshot: {},
      idempotencyKey: `pf-${scan.id}`,
    },
  });

  return { protocol, scan, moduleRun };
}

async function seedFindings(
  scanId: string,
  moduleRunId: string,
  severities: Array<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO">,
) {
  await prisma.finding.createMany({
    data: severities.map((severity, idx) => ({
      scanId,
      moduleRunId,
      module: "GOVERNANCE" as const,
      severity,
      publicTitle: `Smoke finding ${idx}`,
      title: `Smoke finding ${idx}`,
      description: `Phase F smoke fixture finding #${idx}`,
      evidence: {},
      affectedComponent: "",
      references: [],
      remediationHint: "",
      remediationDetailed: "",
      publicRank: idx + 1,
      detectorId: `SMOKE-${idx}`,
      detectorVersion: 1,
      snapshotBlockNumber: BigInt(20_000_000),
    })),
  });
}

// ── tests ─────────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)(
  "Phase F integration smoke (DB-backed: ModuleRun + Scan grade persistence)",
  () => {
    it("COMPLETE path: ModuleRun.grade + score AND Scan.compositeScore + compositeGrade persisted", async () => {
      const { scan, moduleRun } = await seedProtocolAndScan();

      // Lifecycle step 1: executeScan.markRunning → Scan QUEUED → RUNNING.
      const runResult = await markRunning(prisma, scan.id);
      expect(runResult.skipped).toBe(false);

      // Lifecycle step 2: module-side markModuleRunning → ModuleRun QUEUED → RUNNING.
      const modRun = await markModuleRunning(prisma, scan.id, "evt-smoke-1");
      expect(modRun.skipped).toBe(false);

      // Seed findings the way persistSnapshotAndFindings would —
      // 1 HIGH + 2 MEDIUM = -40 penalty → score 60, grade C (spec §5.3).
      await seedFindings(scan.id, moduleRun.id, [
        "HIGH",
        "MEDIUM",
        "MEDIUM",
      ]);

      const computed = calculateCompositeGrade([
        { severity: "HIGH" },
        { severity: "MEDIUM" },
        { severity: "MEDIUM" },
      ]);
      expect(computed.score).toBe(60);
      expect(computed.grade).toBe("C");

      // Lifecycle step 3: module-side markModuleComplete with computed grade + score.
      const modCompleted = await markModuleComplete(
        prisma,
        scan.id,
        "COMPLETE",
        null,
        computed.grade,
        computed.score,
      );
      expect(modCompleted.finalized).toBe(true);

      // Lifecycle step 4: executeScan.markComplete recomputes composite from
      // the persisted findings and finalises the Scan row.
      const scanCompleted = await markComplete(prisma, scan.id);
      if (scanCompleted.finalStatus === null) {
        throw new Error(
          `expected finalised result, got ${JSON.stringify(scanCompleted)}`,
        );
      }
      expect(scanCompleted.finalStatus).toBe("COMPLETE");
      expect(scanCompleted.compositeScore).toBe(60);
      expect(scanCompleted.compositeGrade).toBe("C");
      expect(scanCompleted.findingsCount).toBe(3);

      // ── Assertions on persisted DB state ────────────────────────────────

      const persistedScan = await prisma.scan.findUniqueOrThrow({
        where: { id: scan.id },
      });
      expect(persistedScan.status).toBe("COMPLETE");
      expect(persistedScan.compositeScore).toBe(60);
      expect(persistedScan.compositeGrade).toBe("C");
      expect(persistedScan.completedAt).not.toBeNull();

      const persistedModule = await prisma.moduleRun.findUniqueOrThrow({
        where: { id: moduleRun.id },
      });
      expect(persistedModule.status).toBe("COMPLETE");
      expect(persistedModule.grade).toBe("C");
      expect(persistedModule.score).toBe(60);

      const persistedFindings = await prisma.finding.findMany({
        where: { scanId: scan.id },
      });
      expect(persistedFindings).toHaveLength(3);
    });

    it("FAILED path: ModuleRun.grade + score null AND Scan.compositeScore + compositeGrade null", async () => {
      const { scan, moduleRun } = await seedProtocolAndScan();

      await markRunning(prisma, scan.id);
      await markModuleRunning(prisma, scan.id, "evt-smoke-2");

      // Even though findings exist, FAILED skips grade computation
      // (F.4.2 Option 1: partial findings on a failed module run don't
      // represent a meaningful assessment).
      await seedFindings(scan.id, moduleRun.id, ["CRITICAL"]);

      const modCompleted = await markModuleComplete(
        prisma,
        scan.id,
        "FAILED",
        "smoke_test_failure",
        null,
        null,
      );
      expect(modCompleted.finalized).toBe(true);

      const scanCompleted = await markComplete(prisma, scan.id);
      if (scanCompleted.finalStatus === null) {
        throw new Error(
          `expected finalised result, got ${JSON.stringify(scanCompleted)}`,
        );
      }
      expect(scanCompleted.finalStatus).toBe("FAILED");
      expect(scanCompleted.compositeScore).toBeNull();
      expect(scanCompleted.compositeGrade).toBeNull();
      expect(scanCompleted.findingsCount).toBe(0);

      const persistedScan = await prisma.scan.findUniqueOrThrow({
        where: { id: scan.id },
      });
      expect(persistedScan.status).toBe("FAILED");
      expect(persistedScan.compositeScore).toBeNull();
      expect(persistedScan.compositeGrade).toBeNull();

      const persistedModule = await prisma.moduleRun.findUniqueOrThrow({
        where: { id: moduleRun.id },
      });
      expect(persistedModule.status).toBe("FAILED");
      expect(persistedModule.grade).toBeNull();
      expect(persistedModule.score).toBeNull();
      expect(persistedModule.errorMessage).toBe("smoke_test_failure");
    });

    it("persistSnapshotAndFindings (real helper) writes snapshot + findings atomically (F.5 I2)", async () => {
      // Exercises the production persistence path instead of the
      // test-only seedFindings shortcut used in the scenarios above.
      // Closes the F.5 review IMPORTANT that the smoke test was
      // bypassing the actual code that runs in the Inngest function
      // body's capture-detect-persist step.
      const { scan, moduleRun } = await seedProtocolAndScan();
      await markRunning(prisma, scan.id);
      await markModuleRunning(prisma, scan.id, "evt-smoke-i2");

      const snapshot = baseSnapshot({
        blockNumber: BigInt(20_000_001),
      });
      const findings: GovernanceFindingInput[] = [
        {
          detectorId: "GOV-001",
          detectorVersion: 1,
          severity: "CRITICAL",
          publicTitle: "Smoke: missing timelock",
          title: "Smoke: missing timelock",
          description: "I2 smoke fixture for GOV-001",
          evidence: { ruleId: "rule-1" },
          affectedComponent: "timelock",
          references: [],
          remediationHint: "Add a timelock",
          remediationDetailed: "Detailed remediation",
          publicRank: 1,
        },
        {
          detectorId: "GOV-003",
          detectorVersion: 1,
          severity: "HIGH",
          publicTitle: "Smoke: multisig concentration",
          title: "Smoke: multisig concentration",
          description: "I2 smoke fixture for GOV-003",
          evidence: { ownerCount: 3, threshold: 1 },
          affectedComponent: "multisig",
          references: [],
          remediationHint: "Increase threshold",
          remediationDetailed: "Detailed remediation",
          publicRank: 2,
        },
      ];

      const result = await prisma.$transaction((tx) =>
        persistSnapshotAndFindings(tx, scan.id, snapshot, findings),
      );
      expect(result.findingCount).toBe(2);
      expect(result.snapshot.scanId).toBe(scan.id);

      const persistedSnapshot = await prisma.governanceSnapshot.findUnique({
        where: { scanId: scan.id },
      });
      expect(persistedSnapshot).not.toBeNull();
      expect(persistedSnapshot!.blockNumber).toBe(BigInt(20_000_001));

      const persistedFindings = await prisma.finding.findMany({
        where: { scanId: scan.id },
        orderBy: { detectorId: "asc" },
      });
      expect(persistedFindings).toHaveLength(2);
      expect(persistedFindings[0]!.detectorId).toBe("GOV-001");
      expect(persistedFindings[0]!.severity).toBe("CRITICAL");
      expect(persistedFindings[0]!.snapshotBlockNumber).toBe(
        BigInt(20_000_001),
      );
      expect(persistedFindings[0]!.moduleRunId).toBe(moduleRun.id);
      expect(persistedFindings[1]!.detectorId).toBe("GOV-003");
      expect(persistedFindings[1]!.severity).toBe("HIGH");

      // I.1 FIX 2: ModuleRun.findingsCount is now populated by the
      // persist transaction (was always null pre-I.1).
      const persistedModule = await prisma.moduleRun.findUniqueOrThrow({
        where: { id: moduleRun.id },
      });
      expect(persistedModule.findingsCount).toBe(2);
    });

    it("persistSnapshotAndFindings is idempotent — re-running yields N findings, not 2N (I.1 FIX 1)", async () => {
      // The Inngest step.run replay contract requires this. Without
      // delete-then-insert in persistSnapshotAndFindings, a retry
      // after a partial commit doubles the Finding row count.
      const { scan, moduleRun } = await seedProtocolAndScan();
      await markRunning(prisma, scan.id);
      await markModuleRunning(prisma, scan.id, "evt-smoke-idem");

      const snapshot = baseSnapshot({ blockNumber: BigInt(20_000_002) });
      const findings: GovernanceFindingInput[] = [
        {
          detectorId: "GOV-001",
          detectorVersion: 1,
          severity: "CRITICAL",
          publicTitle: "Idem fixture",
          title: "Idem fixture",
          description: "Replay-test fixture",
          evidence: {},
          affectedComponent: "",
          references: [],
          remediationHint: "",
          remediationDetailed: "",
          publicRank: 1,
        },
      ];

      // First call: 1 row.
      await prisma.$transaction((tx) =>
        persistSnapshotAndFindings(tx, scan.id, snapshot, findings),
      );
      // Second call (simulates Inngest replay): must still be 1 row.
      await prisma.$transaction((tx) =>
        persistSnapshotAndFindings(tx, scan.id, snapshot, findings),
      );
      // Third call for safety: still 1 row.
      await prisma.$transaction((tx) =>
        persistSnapshotAndFindings(tx, scan.id, snapshot, findings),
      );

      const rows = await prisma.finding.findMany({
        where: { scanId: scan.id },
      });
      expect(rows).toHaveLength(1);

      // findingsCount stays consistent with the actual row count.
      const persistedModule = await prisma.moduleRun.findUniqueOrThrow({
        where: { id: moduleRun.id },
      });
      expect(persistedModule.findingsCount).toBe(1);
    });

    it("I.1 FIX 3: errorDetectorCount persisted → Scan.isPartialGrade = true", async () => {
      // Simulates the "detector threw" path end-to-end against real DB:
      // 1. Seed Scan + GOVERNANCE ModuleRun
      // 2. Call persistSnapshotAndFindings with errorDetectorCount=2
      //    (the runDetectors signal that 2 detectors threw)
      // 3. Mark the module COMPLETE
      // 4. Run scan-level markComplete → reads ModuleRun.errorDetectorCount
      //    and flips Scan.isPartialGrade
      const { scan, moduleRun } = await seedProtocolAndScan();
      await markRunning(prisma, scan.id);
      await markModuleRunning(prisma, scan.id, "evt-i1-fix3");

      const snapshot = baseSnapshot({ blockNumber: BigInt(20_000_003) });
      const findings: GovernanceFindingInput[] = [
        {
          detectorId: "GOV-001",
          detectorVersion: 1,
          severity: "MEDIUM",
          publicTitle: "I.1 FIX 3 fixture finding",
          title: "I.1 FIX 3 fixture finding",
          description: "Used to verify isPartialGrade end-to-end.",
          evidence: {},
          affectedComponent: "",
          references: [],
          remediationHint: "",
          remediationDetailed: "",
          publicRank: 1,
        },
      ];

      await prisma.$transaction((tx) =>
        persistSnapshotAndFindings(tx, scan.id, snapshot, findings, 2),
      );

      // ModuleRun.errorDetectorCount is now 2 on disk.
      const persistedModule = await prisma.moduleRun.findUniqueOrThrow({
        where: { id: moduleRun.id },
      });
      expect(persistedModule.errorDetectorCount).toBe(2);

      // Flip module COMPLETE so scan-level markComplete sees a terminal
      // module to read errorDetectorCount from.
      await markModuleComplete(prisma, scan.id, "COMPLETE", null, "C", 70);

      const scanResult = await markComplete(prisma, scan.id);
      if (scanResult.finalStatus === null) {
        throw new Error(
          `expected finalised result, got ${JSON.stringify(scanResult)}`,
        );
      }
      expect(scanResult.finalStatus).toBe("COMPLETE");
      expect(scanResult.isPartialGrade).toBe(true);

      const persistedScan = await prisma.scan.findUniqueOrThrow({
        where: { id: scan.id },
      });
      expect(persistedScan.isPartialGrade).toBe(true);
    });
  },
);
