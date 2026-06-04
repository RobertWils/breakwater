// @vitest-environment node
/**
 * Plan 03 Phase H.1 — backfill integration tests.
 *
 * DB-backed. Skipped when DATABASE_URL is unset. Mirrors the convention
 * established by phase-f.integration.test.ts and idempotency.integration
 * .test.ts: seed legacy Plan-02-shaped rows directly, run the public
 * `runBackfill()` entrypoint, assert on the resulting DB state.
 *
 * Covers spec §3.5 PR 1 invariants and the four guarantees in the
 * script's header:
 *   - Creation: a fresh legacy scan gets a PRIMARY Contract + linked
 *     ModuleRun / Finding / GovernanceSnapshot.
 *   - Idempotency: a second run is a no-op (no duplicate Contract, no
 *     row-state drift).
 *   - Dry-run safety: --dry-run flag reports counts without writing.
 *   - Edge case (zero ModuleRuns): Contract still created per plan §13.
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

import { runBackfill } from "../backfill-plan-03-contracts";

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
  return `h1-${randomBytes(6).toString("hex")}`;
}
function uniqueAddr(): string {
  return `0x${randomBytes(20).toString("hex")}`.toLowerCase();
}
function uniqueIp(): string {
  return `h1-${randomBytes(8).toString("hex")}`;
}

/**
 * Seed a Plan-02-shaped scan: Protocol + Scan + GOVERNANCE ModuleRun
 * + a finding + a governance snapshot, all with `contractId IS NULL`.
 * Returns the created scan id for assertions.
 */
async function seedLegacyScan(opts: {
  withModuleRun?: boolean;
  withFinding?: boolean;
  withSnapshot?: boolean;
  compositeGrade?: "A" | "B" | "C" | "D" | "F" | null;
  averageContractScore?: number | null;
  isPartialGrade?: boolean;
} = {}): Promise<{ scanId: string; primaryAddress: string }> {
  const primaryAddress = uniqueAddr();
  const protocol = await prisma.protocol.create({
    data: {
      slug: uniqueSlug(),
      displayName: "H.1 legacy backfill fixture",
      chain: "ETHEREUM",
      primaryContractAddress: primaryAddress,
      ownershipStatus: "UNCLAIMED",
    },
  });
  createdProtocolIds.push(protocol.id);

  const scan = await prisma.scan.create({
    data: {
      protocolId: protocol.id,
      status: opts.compositeGrade ? "COMPLETE" : "QUEUED",
      compositeGrade: opts.compositeGrade ?? null,
      averageContractScore: opts.averageContractScore ?? null,
      isPartialGrade: opts.isPartialGrade ?? false,
      ipHash: uniqueIp(),
      userAgent: "h1-backfill-test/1.0",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  let moduleRunId: string | null = null;
  if (opts.withModuleRun !== false) {
    const mr = await prisma.moduleRun.create({
      data: {
        scanId: scan.id,
        // contractId intentionally null — legacy Plan 02 shape.
        contractId: null as unknown as string, // legacy null shape; suite skipped post-PR-2 (NOT NULL)
        module: "GOVERNANCE",
        status: "COMPLETE",
        detectorVersions: {},
        inputSnapshot: {},
        idempotencyKey: `h1-${scan.id}`,
      },
    });
    moduleRunId = mr.id;
  }

  if (opts.withFinding && moduleRunId) {
    await prisma.finding.create({
      data: {
        scanId: scan.id,
        contractId: null as unknown as string, // legacy null shape; suite skipped post-PR-2 (NOT NULL)
        moduleRunId,
        module: "GOVERNANCE",
        severity: "MEDIUM",
        publicTitle: "Legacy finding",
        title: "Legacy finding",
        description: "Pre-Plan-03 finding without contractId",
        evidence: {},
        affectedComponent: "",
        references: [],
        remediationHint: "",
        remediationDetailed: "",
        publicRank: 1,
        detectorId: "LEGACY-1",
        detectorVersion: 1,
      },
    });
  }

  if (opts.withSnapshot) {
    await prisma.governanceSnapshot.create({
      data: {
        scanId: scan.id,
        contractId: null as unknown as string, // legacy null shape; suite skipped post-PR-2 (NOT NULL)
        blockNumber: BigInt(20_000_000),
        capturedAt: new Date(),
        hasGovernor: false,
        hasTimelock: false,
        hasMultisig: false,
        multisigOwners: [],
        proxyVerified: false,
        rawState: {},
      },
    });
  }

  return { scanId: scan.id, primaryAddress };
}

// Plan 03 §3.5 PR 2: this suite is now SKIPPED unconditionally. It seeds
// "legacy" rows with `contractId IS NULL` to verify the backfill links
// them — but PR 2 tightened contractId to NOT NULL on ModuleRun / Finding
// / GovernanceSnapshot, so the fixture rows can no longer be inserted
// (the DB rejects them) and the scenario the suite covers is structurally
// unreachable. The backfill tool itself is retained as a one-time
// prerequisite that ran against production before PR 2's migration.
// Kept (skipped, not deleted) as a record of how the backfill was
// validated; a future cleanup can retire the tool + this suite together.
describe.skip(
  "Plan 03 Phase H.1 — Contract backfill (spec §3.5 PR 1) [disabled post-PR-2: NOT NULL contractId makes the legacy-null fixtures uninsertable]",
  () => {
    it("creates exactly ONE PRIMARY Contract per legacy scan + links ModuleRun / Finding / Snapshot", async () => {
      const { scanId, primaryAddress } = await seedLegacyScan({
        withModuleRun: true,
        withFinding: true,
        withSnapshot: true,
        compositeGrade: "C",
        averageContractScore: 60,
        isPartialGrade: false,
      });

      const summary = await runBackfill();

      expect(summary.errors).toBe(0);
      expect(summary.backfilled).toBeGreaterThanOrEqual(1);
      expect(summary.contractsCreated).toBeGreaterThanOrEqual(1);

      const contracts = await prisma.contract.findMany({
        where: { scanId },
      });
      expect(contracts).toHaveLength(1);
      const primary = contracts[0]!;
      expect(primary.role).toBe("PRIMARY");
      expect(primary.isPrimary).toBe(true);
      expect(primary.address).toBe(primaryAddress);
      expect(primary.chain).toBe("ETHEREUM");
      // Phase G remediation #1 alignment: synthetic Contract carries
      // the scan-level grade so the new UI surfaces it on a ContractCard.
      expect(primary.compositeGrade).toBe("C");
      expect(primary.compositeScore).toBe(60);
      expect(primary.isPartialGrade).toBe(false);

      // Orphan rows linked.
      const moduleRuns = await prisma.moduleRun.findMany({
        where: { scanId },
      });
      expect(moduleRuns).toHaveLength(1);
      expect(moduleRuns[0]!.contractId).toBe(primary.id);

      const findings = await prisma.finding.findMany({ where: { scanId } });
      expect(findings).toHaveLength(1);
      expect(findings[0]!.contractId).toBe(primary.id);

      const snapshots = await prisma.governanceSnapshot.findMany({
        where: { scanId },
      });
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.contractId).toBe(primary.id);
    });

    it("idempotent — running the backfill twice produces no duplicate Contract rows and no row-state drift", async () => {
      const { scanId } = await seedLegacyScan({
        withModuleRun: true,
        withFinding: true,
        withSnapshot: true,
      });

      const firstSummary = await runBackfill();
      expect(firstSummary.errors).toBe(0);
      expect(firstSummary.backfilled).toBeGreaterThanOrEqual(1);

      // Capture state after first run.
      const firstContracts = await prisma.contract.findMany({
        where: { scanId },
        orderBy: { id: "asc" },
      });
      const firstModuleRuns = await prisma.moduleRun.findMany({
        where: { scanId },
        orderBy: { id: "asc" },
      });
      const firstFindings = await prisma.finding.findMany({
        where: { scanId },
        orderBy: { id: "asc" },
      });
      const firstSnapshots = await prisma.governanceSnapshot.findMany({
        where: { scanId },
        orderBy: { id: "asc" },
      });

      const secondSummary = await runBackfill();
      expect(secondSummary.errors).toBe(0);
      // The second run finds the PRIMARY contract already exists and
      // skips entirely. There may be other historical scans the
      // backfill processes; the assertion here is specifically that
      // THIS scan was skipped (no second backfilled+1 increment for
      // this id) — surfaced via the row-equality assertions below.
      const secondContracts = await prisma.contract.findMany({
        where: { scanId },
        orderBy: { id: "asc" },
      });
      const secondModuleRuns = await prisma.moduleRun.findMany({
        where: { scanId },
        orderBy: { id: "asc" },
      });
      const secondFindings = await prisma.finding.findMany({
        where: { scanId },
        orderBy: { id: "asc" },
      });
      const secondSnapshots = await prisma.governanceSnapshot.findMany({
        where: { scanId },
        orderBy: { id: "asc" },
      });

      // No new Contract rows + same Contract ids.
      expect(secondContracts).toHaveLength(1);
      expect(secondContracts[0]!.id).toBe(firstContracts[0]!.id);
      // Linked rows unchanged.
      expect(secondModuleRuns.map((m) => m.contractId)).toEqual(
        firstModuleRuns.map((m) => m.contractId),
      );
      expect(secondFindings.map((f) => f.contractId)).toEqual(
        firstFindings.map((f) => f.contractId),
      );
      expect(secondSnapshots.map((s) => s.contractId)).toEqual(
        firstSnapshots.map((s) => s.contractId),
      );
    });

    it("--dry-run reports counts without writing — DB state unchanged after dry-run", async () => {
      const { scanId } = await seedLegacyScan({
        withModuleRun: true,
        withFinding: true,
        withSnapshot: true,
      });

      // Snapshot the pre-dry-run state.
      const beforeContracts = await prisma.contract.findMany({
        where: { scanId },
      });
      const beforeModuleRunContractIds = (
        await prisma.moduleRun.findMany({
          where: { scanId },
          select: { contractId: true },
        })
      ).map((m) => m.contractId);

      const summary = await runBackfill({ dryRun: true });

      expect(summary.errors).toBe(0);
      // Dry-run reports what WOULD have been done — at least 1 scan
      // would have been backfilled (this one), with row counts > 0.
      expect(summary.backfilled).toBeGreaterThanOrEqual(1);
      expect(summary.moduleRunsLinked).toBeGreaterThanOrEqual(1);
      expect(summary.findingsLinked).toBeGreaterThanOrEqual(1);
      expect(summary.governanceSnapshotsLinked).toBeGreaterThanOrEqual(1);

      // Post-dry-run state: no Contract created, no contractId set.
      const afterContracts = await prisma.contract.findMany({
        where: { scanId },
      });
      expect(afterContracts).toEqual(beforeContracts);

      const afterModuleRunContractIds = (
        await prisma.moduleRun.findMany({
          where: { scanId },
          select: { contractId: true },
        })
      ).map((m) => m.contractId);
      expect(afterModuleRunContractIds).toEqual(beforeModuleRunContractIds);
    });

    it("edge case: scan with NO ModuleRuns still gets a PRIMARY Contract row (UI consistency)", async () => {
      const { scanId } = await seedLegacyScan({
        withModuleRun: false,
        withFinding: false,
        withSnapshot: false,
      });

      const summary = await runBackfill();
      expect(summary.errors).toBe(0);

      const contracts = await prisma.contract.findMany({
        where: { scanId },
      });
      expect(contracts).toHaveLength(1);
      expect(contracts[0]!.role).toBe("PRIMARY");
      // No orphan rows existed to link — the Contract create still
      // succeeded; the three updateMany calls were no-ops with count=0.
    });
  },
);
