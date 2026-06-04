// @vitest-environment node
/**
 * Plan 03 §3.5 PR 2 — constraint-tightening integration tests.
 *
 * DB-backed; skipped cleanly when DATABASE_URL is unset. Verifies the
 * three guarantees added by `plan_03_tighten_contract_id_constraints`:
 *
 *   1. ModuleRun composite unique (scanId, module, contractId): one
 *      ModuleRun per (scan, module, contract); a duplicate triple is
 *      rejected, but the same (scan, module) under a DIFFERENT contract
 *      is allowed (the whole point of dropping the legacy
 *      (scanId, module) unique in PR 1).
 *   2. contractId NOT NULL on ModuleRun / Finding / GovernanceSnapshot —
 *      the DB rejects a null contractId on each child table.
 *   3. GovernanceSnapshot.contractId @unique — at most one snapshot per
 *      Contract.
 *
 * Follows the seed + cleanup convention of scan-get-integration.test.ts.
 */

import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { randomBytes } from "node:crypto";

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
import {
  Chain,
  ContractRole,
  ModuleName,
  OwnershipStatus,
  Severity,
} from "@prisma/client";

const hasDb = !!process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 30000 });

const createdProtocolIds: string[] = [];

function uniqueAddr(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}
function uniqueSlug(): string {
  return `pr2-${randomBytes(6).toString("hex")}`;
}
function uniqueKey(): string {
  return `pr2-${randomBytes(8).toString("hex")}`;
}

async function cleanup() {
  if (!createdProtocolIds.length) return;
  const scans = await prisma.scan.findMany({
    where: { protocolId: { in: createdProtocolIds } },
    select: { id: true },
  });
  const scanIds = scans.map((s) => s.id);
  if (scanIds.length) {
    // Finding / ModuleRun / GovernanceSnapshot reference Contract via
    // NoAction — delete them before the Contract rows.
    await prisma.finding.deleteMany({ where: { scanId: { in: scanIds } } });
    await prisma.governanceSnapshot.deleteMany({
      where: { scanId: { in: scanIds } },
    });
    await prisma.moduleRun.deleteMany({ where: { scanId: { in: scanIds } } });
    await prisma.contract.deleteMany({ where: { scanId: { in: scanIds } } });
    await prisma.scan.deleteMany({ where: { id: { in: scanIds } } });
  }
  await prisma.protocol.deleteMany({ where: { id: { in: createdProtocolIds } } });
}

afterEach(async () => {
  await cleanup();
  createdProtocolIds.length = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Seed Protocol + Scan + two PRIMARY/RELATED Contract rows. */
async function seedScanWithContracts(): Promise<{
  scanId: string;
  contractId: string;
  otherContractId: string;
}> {
  const protocol = await prisma.protocol.create({
    data: {
      slug: uniqueSlug(),
      displayName: "PR2 constraint fixture",
      chain: Chain.ETHEREUM,
      primaryContractAddress: uniqueAddr(),
      ownershipStatus: OwnershipStatus.UNCLAIMED,
    },
  });
  createdProtocolIds.push(protocol.id);

  const scan = await prisma.scan.create({
    data: {
      protocolId: protocol.id,
      ipHash: uniqueKey(),
      userAgent: "pr2-constraint-test/1.0",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  const contract = await prisma.contract.create({
    data: {
      scanId: scan.id,
      address: uniqueAddr(),
      chain: Chain.ETHEREUM,
      role: ContractRole.PRIMARY,
      isPrimary: true,
    },
  });
  const otherContract = await prisma.contract.create({
    data: {
      scanId: scan.id,
      address: uniqueAddr(),
      chain: Chain.ETHEREUM,
      role: ContractRole.RELATED,
      isPrimary: false,
    },
  });

  return {
    scanId: scan.id,
    contractId: contract.id,
    otherContractId: otherContract.id,
  };
}

function moduleRunData(scanId: string, contractId: string, module: ModuleName) {
  return {
    scanId,
    contractId,
    module,
    detectorVersions: {},
    inputSnapshot: {},
    idempotencyKey: uniqueKey(),
  };
}

describe.skipIf(!hasDb)("Plan 03 §3.5 PR 2 — constraint tightening", () => {
  it("composite unique: a duplicate (scanId, module, contractId) ModuleRun is rejected", async () => {
    const { scanId, contractId } = await seedScanWithContracts();

    await prisma.moduleRun.create({
      data: moduleRunData(scanId, contractId, ModuleName.GOVERNANCE),
    });

    await expect(
      prisma.moduleRun.create({
        data: moduleRunData(scanId, contractId, ModuleName.GOVERNANCE),
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("composite unique: same (scanId, module) under a DIFFERENT contractId is allowed", async () => {
    const { scanId, contractId, otherContractId } =
      await seedScanWithContracts();

    const a = await prisma.moduleRun.create({
      data: moduleRunData(scanId, contractId, ModuleName.GOVERNANCE),
    });
    const b = await prisma.moduleRun.create({
      data: moduleRunData(scanId, otherContractId, ModuleName.GOVERNANCE),
    });

    expect(a.id).not.toBe(b.id);
    expect(a.contractId).not.toBe(b.contractId);
    const count = await prisma.moduleRun.count({
      where: { scanId, module: ModuleName.GOVERNANCE },
    });
    expect(count).toBe(2);
  });

  // For NOT NULL we create a valid row, then attempt to NULL its
  // contractId via raw SQL. This exercises the DB constraint directly
  // (Postgres 23502) rather than Prisma's client-side required-field
  // validation, which would reject a typed `create` before reaching the
  // database.

  it("NOT NULL: setting ModuleRun.contractId to NULL is rejected by the DB", async () => {
    const { scanId, contractId } = await seedScanWithContracts();
    const mr = await prisma.moduleRun.create({
      data: moduleRunData(scanId, contractId, ModuleName.GOVERNANCE),
    });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "ModuleRun" SET "contractId" = NULL WHERE id = $1`,
        mr.id,
      ),
    ).rejects.toThrow();
  });

  it("NOT NULL: setting Finding.contractId to NULL is rejected by the DB", async () => {
    const { scanId, contractId } = await seedScanWithContracts();
    const mr = await prisma.moduleRun.create({
      data: moduleRunData(scanId, contractId, ModuleName.GOVERNANCE),
    });
    const finding = await prisma.finding.create({
      data: {
        scanId,
        contractId,
        moduleRunId: mr.id,
        module: ModuleName.GOVERNANCE,
        severity: Severity.MEDIUM,
        publicTitle: "t",
        title: "t",
        description: "d",
        evidence: {},
        affectedComponent: "",
        references: [],
        remediationHint: "",
        remediationDetailed: "",
        publicRank: 1,
        detectorId: "PR2-1",
        detectorVersion: 1,
      },
    });
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "Finding" SET "contractId" = NULL WHERE id = $1`,
        finding.id,
      ),
    ).rejects.toThrow();
  });

  it("NOT NULL: setting GovernanceSnapshot.contractId to NULL is rejected by the DB", async () => {
    const { scanId, contractId } = await seedScanWithContracts();
    const snapshot = await prisma.governanceSnapshot.create({
      data: {
        scanId,
        contractId,
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
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "GovernanceSnapshot" SET "contractId" = NULL WHERE id = $1`,
        snapshot.id,
      ),
    ).rejects.toThrow();
  });

  it("GovernanceSnapshot.contractId is unique: a second snapshot for the same Contract is rejected", async () => {
    const { scanId, contractId } = await seedScanWithContracts();
    const snapshotData = {
      scanId,
      contractId,
      blockNumber: BigInt(20_000_000),
      capturedAt: new Date(),
      hasGovernor: false,
      hasTimelock: false,
      hasMultisig: false,
      multisigOwners: [],
      proxyVerified: false,
      rawState: {},
    };
    await prisma.governanceSnapshot.create({ data: snapshotData });
    await expect(
      prisma.governanceSnapshot.create({
        data: { ...snapshotData, blockNumber: BigInt(20_000_001) },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
