// @vitest-environment node
/**
 * Plan 03 Phase E.3 — Sibling-isolation idempotency test (spec §5.3.1
 * IMPORTANT 3 exit criterion).
 *
 * The load-bearing assertion: when one Contract's persist transaction
 * is replayed (Inngest retry, manual re-run, etc.), sibling Contracts'
 * Finding rows MUST NOT be erased. Plan 02 used
 * deleteMany({ scanId, module: "GOVERNANCE" }) — scan-wide — which
 * was safe under the Plan 02 single-GOVERNANCE-row-per-scan
 * @@unique. Plan 03 has N GOVERNANCE rows per scan (one per Contract);
 * Phase E.2 narrowed the deleteMany scope to include contractId so a
 * retry of contract A's run only clears contract A's findings.
 *
 * Without the contractId narrow, this test would observe contracts B
 * + C's findings disappear after persistSnapshotAndFindings is called
 * again with contract A's contractId.
 *
 * Skipped without DATABASE_URL (matches the existing phase-f
 * integration convention).
 */

import { randomBytes } from "node:crypto";

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

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

import { baseSnapshot } from "@/lib/detectors/governance/__tests__/fixtures";
import type { GovernanceFindingInput } from "@/lib/detectors/governance/types";

import { persistSnapshotAndFindings } from "../execute-governance-module";

const hasDb = !!process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30000 });

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
    await prisma.contract.deleteMany({ where: { scanId: { in: scanIds } } });
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

function uniqueSlug(): string {
  return `e3-${randomBytes(6).toString("hex")}`;
}
function uniqueIp(): string {
  return `e3-ip-${randomBytes(8).toString("hex")}`;
}
function uniqueAddr(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

function findingInput(detectorId: string): GovernanceFindingInput {
  return {
    detectorId,
    detectorVersion: 1,
    severity: "MEDIUM",
    publicTitle: `e3 ${detectorId}`,
    title: `e3 ${detectorId}`,
    description: "Phase E.3 idempotency fixture",
    evidence: {},
    affectedComponent: null,
    references: [],
    remediationHint: "",
    remediationDetailed: "",
    publicRank: 1,
  };
}

async function seedThreeContractScan() {
  const protocol = await prisma.protocol.create({
    data: {
      slug: uniqueSlug(),
      displayName: "Phase E.3 Protocol",
      chain: "ETHEREUM",
      primaryContractAddress: uniqueAddr().toLowerCase(),
      ownershipStatus: "UNCLAIMED",
    },
  });
  createdProtocolIds.push(protocol.id);

  const scan = await prisma.scan.create({
    data: {
      protocolId: protocol.id,
      status: "QUEUED",
      ipHash: uniqueIp(),
      userAgent: "e3-test/1.0",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const contracts = await Promise.all(
    ["PRIMARY", "PROXY_IMPLEMENTATION", "TIMELOCK"].map((role, idx) =>
      prisma.contract.create({
        data: {
          scanId: scan.id,
          address: uniqueAddr().toLowerCase(),
          chain: "ETHEREUM",
          role: role as "PRIMARY" | "PROXY_IMPLEMENTATION" | "TIMELOCK",
          isPrimary: idx === 0,
        },
      }),
    ),
  );

  // One QUEUED GOVERNANCE ModuleRun per Contract.
  const moduleRuns = await Promise.all(
    contracts.map((c, idx) =>
      prisma.moduleRun.create({
        data: {
          scanId: scan.id,
          contractId: c.id,
          module: "GOVERNANCE",
          status: "RUNNING",
          startedAt: new Date(),
          detectorVersions: {},
          inputSnapshot: {},
          idempotencyKey: `e3-${scan.id}-${idx}`,
        },
      }),
    ),
  );

  return { scan, contracts, moduleRuns };
}

describe.skipIf(!hasDb)(
  "Plan 03 Phase E.3 — persistSnapshotAndFindings sibling isolation (spec §5.3.1)",
  () => {
    it(
      "retrying ONE Contract's persistSnapshotAndFindings does NOT erase sibling Contracts' findings",
      async () => {
        const { scan, contracts } = await seedThreeContractScan();
        const [contractA, contractB, contractC] = contracts;

        // Phase 1: each Contract gets 2 findings persisted independently.
        const snap = baseSnapshot();
        for (const c of contracts) {
          await prisma.$transaction((tx) =>
            persistSnapshotAndFindings(tx, scan.id, c!.id, snap, [
              findingInput(`A-${c!.id}-1`),
              findingInput(`A-${c!.id}-2`),
            ]),
          );
        }
        const totalAfterSeed = await prisma.finding.count({
          where: { scanId: scan.id },
        });
        expect(totalAfterSeed).toBe(6);

        // Phase 2: retry contract A's persist (simulates Inngest replay).
        // Per spec §5.3.1, this MUST scope its deleteMany by contractId
        // — otherwise contracts B + C would lose their findings.
        await prisma.$transaction((tx) =>
          persistSnapshotAndFindings(tx, scan.id, contractA!.id, snap, [
            findingInput(`A-retry-1`),
            findingInput(`A-retry-2`),
          ]),
        );

        // Assertion 1: total finding count is still 6 (A's 2 replaced
        // with 2 new; B + C untouched).
        const totalAfterRetry = await prisma.finding.count({
          where: { scanId: scan.id },
        });
        expect(totalAfterRetry).toBe(6);

        // Assertion 2: per-Contract counts are intact.
        const aFindings = await prisma.finding.count({
          where: { scanId: scan.id, contractId: contractA!.id },
        });
        const bFindings = await prisma.finding.count({
          where: { scanId: scan.id, contractId: contractB!.id },
        });
        const cFindings = await prisma.finding.count({
          where: { scanId: scan.id, contractId: contractC!.id },
        });
        expect(aFindings).toBe(2);
        expect(bFindings).toBe(2);
        expect(cFindings).toBe(2);

        // Assertion 3: contract A's findings are the NEW ones, not the
        // pre-retry ones (delete-then-insert idempotency, I.1 FIX 1
        // semantics preserved per-Contract).
        const aDetectorIds = await prisma.finding.findMany({
          where: { scanId: scan.id, contractId: contractA!.id },
          select: { detectorId: true },
        });
        expect(aDetectorIds.map((f) => f.detectorId).sort()).toEqual([
          "A-retry-1",
          "A-retry-2",
        ]);

        // Assertion 4: sibling B + C still have their ORIGINAL detector
        // ids — they weren't touched by A's retry. If the deleteMany
        // scope were scan-wide (Plan 02 carryover), these would be
        // gone.
        const bDetectorIds = await prisma.finding.findMany({
          where: { scanId: scan.id, contractId: contractB!.id },
          select: { detectorId: true },
        });
        expect(bDetectorIds.map((f) => f.detectorId).sort()).toEqual([
          `A-${contractB!.id}-1`,
          `A-${contractB!.id}-2`,
        ]);
        const cDetectorIds = await prisma.finding.findMany({
          where: { scanId: scan.id, contractId: contractC!.id },
          select: { detectorId: true },
        });
        expect(cDetectorIds.map((f) => f.detectorId).sort()).toEqual([
          `A-${contractC!.id}-1`,
          `A-${contractC!.id}-2`,
        ]);
      },
      30_000,
    );

    it(
      "retrying with an EMPTY findings array correctly clears only THIS contract's findings (sibling Contracts untouched)",
      async () => {
        const { scan, contracts } = await seedThreeContractScan();
        const [contractA, contractB] = contracts;

        const snap = baseSnapshot();
        for (const c of contracts) {
          await prisma.$transaction((tx) =>
            persistSnapshotAndFindings(tx, scan.id, c!.id, snap, [
              findingInput(`E-${c!.id}-1`),
            ]),
          );
        }
        expect(
          await prisma.finding.count({ where: { scanId: scan.id } }),
        ).toBe(3);

        // Retry A with EMPTY findings — A's row should go to 0
        // findings, B + C unchanged.
        await prisma.$transaction((tx) =>
          persistSnapshotAndFindings(tx, scan.id, contractA!.id, snap, []),
        );

        expect(
          await prisma.finding.count({
            where: { scanId: scan.id, contractId: contractA!.id },
          }),
        ).toBe(0);
        expect(
          await prisma.finding.count({
            where: { scanId: scan.id, contractId: contractB!.id },
          }),
        ).toBe(1);
      },
      30_000,
    );
  },
);
