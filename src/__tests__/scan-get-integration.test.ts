// @vitest-environment node
/**
 * Integration tests for GET /api/scan/[id] — tier-gated scan read.
 * Uses the real Prisma client against DATABASE_URL.
 * Skipped cleanly when DATABASE_URL is unset.
 *
 * Follows the seeding + cleanup pattern from scan-submission-integration.test.ts.
 */

import { describe, it, expect, afterEach, afterAll } from "vitest";
import { vi } from "vitest";
import { randomBytes } from "node:crypto";

// ── Stub transitive imports that aren't needed here ──────────────────────────

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
  assertProductionHashSalts: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { getScan } from "@/lib/scan-response";
import {
  Chain,
  OwnershipStatus,
  ScanStatus,
  ModuleStatus,
  Severity,
  ModuleName,
  Grade,
} from "@prisma/client";

const hasDb = !!process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 30000 });

// ── Cleanup tracking ─────────────────────────────────────────────────────────

const createdProtocolIds: string[] = [];

async function cleanup() {
  if (!createdProtocolIds.length) return;

  const scans = await prisma.scan.findMany({
    where: { protocolId: { in: createdProtocolIds } },
    select: { id: true },
  });
  const scanIds = scans.map((s) => s.id);

  if (scanIds.length) {
    await prisma.finding.deleteMany({ where: { scanId: { in: scanIds } } });
    await prisma.moduleRun.deleteMany({ where: { scanId: { in: scanIds } } });
    await prisma.scan.deleteMany({ where: { id: { in: scanIds } } });
  }

  await prisma.protocol.deleteMany({
    where: {
      id: { in: createdProtocolIds },
      ownershipStatus: { not: OwnershipStatus.CURATED },
    },
  });
}

afterEach(async () => {
  await cleanup();
  createdProtocolIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ── Seed helpers ─────────────────────────────────────────────────────────────

function uniqueAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

function uniqueSlug(): string {
  return `test-${randomBytes(6).toString("hex")}`;
}

function uniqueIdempotencyKey(): string {
  return `idem-${randomBytes(8).toString("hex")}`;
}

async function seedProtocol() {
  const protocol = await prisma.protocol.create({
    data: {
      slug: uniqueSlug(),
      displayName: "Test Protocol",
      chain: Chain.ETHEREUM,
      primaryContractAddress: uniqueAddress(),
      extraContractAddresses: [],
      ownershipStatus: OwnershipStatus.UNCLAIMED,
      knownMultisigs: [],
    },
  });
  createdProtocolIds.push(protocol.id);
  return protocol;
}

async function seedScan(
  protocolId: string,
  overrides: {
    status?: ScanStatus;
    compositeScore?: number | null;
    compositeGrade?: Grade | null;
  } = {},
) {
  return prisma.scan.create({
    data: {
      protocolId,
      ipHash: `test-ip-${randomBytes(8).toString("hex")}`,
      userAgent: "integration-test/1.0",
      status: overrides.status ?? ScanStatus.COMPLETE,
      compositeScore: overrides.compositeScore ?? 80,
      compositeGrade: overrides.compositeGrade ?? Grade.B,
      isPartialGrade: false,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });
}

async function seedModuleRun(
  scanId: string,
  module: ModuleName,
  status: ModuleStatus = ModuleStatus.COMPLETE,
  overrides: {
    errorMessage?: string | null;
    errorStack?: string | null;
  } = {},
) {
  return prisma.moduleRun.create({
    data: {
      scanId,
      module,
      status,
      grade: status === ModuleStatus.COMPLETE ? "B" : null,
      score: status === ModuleStatus.COMPLETE ? 75 : null,
      findingsCount: status === ModuleStatus.COMPLETE ? 0 : null,
      detectorVersions: {},
      inputSnapshot: {},
      rpcCallsUsed: 0,
      idempotencyKey: uniqueIdempotencyKey(),
      errorMessage: overrides.errorMessage ?? null,
      errorStack: overrides.errorStack ?? null,
    },
  });
}

async function seedFinding(
  scanId: string,
  moduleRunId: string,
  module: ModuleName,
  publicRank: number,
  overrides: Partial<{
    severity: Severity;
    publicTitle: string;
    title: string;
    description: string;
    remediationHint: string;
    remediationDetailed: string;
    affectedComponent: string;
  }> = {},
) {
  return prisma.finding.create({
    data: {
      scanId,
      moduleRunId,
      module,
      severity: overrides.severity ?? Severity.HIGH,
      publicTitle: overrides.publicTitle ?? `Public finding rank ${publicRank}`,
      title: overrides.title ?? `Full finding rank ${publicRank}`,
      description: overrides.description ?? "Finding description",
      evidence: { raw: "0xdeadbeef" },
      affectedComponent: overrides.affectedComponent ?? "Contract.sol",
      references: ["https://example.com"],
      remediationHint: overrides.remediationHint ?? "Update the contract",
      remediationDetailed:
        overrides.remediationDetailed ?? "Step 1: upgrade the contract",
      publicRank,
      detectorId: `det-${randomBytes(4).toString("hex")}`,
      detectorVersion: 1,
    },
  });
}

// ── Test suites ──────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)("scan-get integration", () => {
  // a) unauth → teaser findings, hiddenFindingsCount per module

  it("(a) unauth: returns only publicRank=1 teaser per module, hiddenFindingsCount correct", async () => {
    const protocol = await seedProtocol();
    const scan = await seedScan(protocol.id);
    const govRun = await seedModuleRun(scan.id, ModuleName.GOVERNANCE);

    // Seed 3 findings: ranks 1, 2, 3 for GOVERNANCE
    await seedFinding(scan.id, govRun.id, ModuleName.GOVERNANCE, 1, {
      publicTitle: "Gov finding rank 1",
    });
    await seedFinding(scan.id, govRun.id, ModuleName.GOVERNANCE, 2, {
      publicTitle: "Gov finding rank 2",
    });
    await seedFinding(scan.id, govRun.id, ModuleName.GOVERNANCE, 3, {
      publicTitle: "Gov finding rank 3",
    });

    const result = await getScan({ scanId: scan.id, tier: "unauth" });

    expect(result).not.toBeNull();
    // Only 1 teaser finding (publicRank=1)
    expect(result!.findings).toHaveLength(1);
    const f = result!.findings[0] as {
      severity: string;
      publicTitle: string;
      remediationHint: string;
    };
    expect(f.publicTitle).toBe("Gov finding rank 1");

    // Teaser has ONLY the 3 keys
    expect(Object.keys(result!.findings[0]).sort()).toEqual(
      ["publicTitle", "remediationHint", "severity"].sort(),
    );

    // Module has hiddenFindingsCount = 2
    const govModule = result!.modules.find((m) => m.module === "GOVERNANCE");
    expect(govModule).toBeDefined();
    expect(govModule!.hiddenFindingsCount).toBe(2);
  });

  // b) email → all findings, no remediationDetailed

  it("(b) email: returns all findings with full shape, no remediationDetailed", async () => {
    const protocol = await seedProtocol();
    const scan = await seedScan(protocol.id);
    const govRun = await seedModuleRun(scan.id, ModuleName.GOVERNANCE);

    await seedFinding(scan.id, govRun.id, ModuleName.GOVERNANCE, 1);
    await seedFinding(scan.id, govRun.id, ModuleName.GOVERNANCE, 2);

    const result = await getScan({ scanId: scan.id, tier: "email" });

    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(2);

    for (const f of result!.findings) {
      const keys = Object.keys(f);
      expect(keys).toContain("title");
      expect(keys).toContain("description");
      expect(keys).toContain("evidence");
      expect(keys).not.toContain("remediationDetailed");
    }

    // No hiddenFindingsCount on modules
    for (const m of result!.modules) {
      expect("hiddenFindingsCount" in m).toBe(false);
    }
  });

  // c) non-existent scanId → null from getScan

  it("(c) non-existent scanId: getScan returns null", async () => {
    const result = await getScan({
      scanId: "00000000-0000-0000-0000-000000000000",
      tier: "email",
    });
    expect(result).toBeNull();
  });

  // e) scan with no findings → empty findings array, no hiddenFindingsCount

  it("(e) scan with no findings: empty arrays, no hiddenFindingsCount", async () => {
    const protocol = await seedProtocol();
    const scan = await seedScan(protocol.id);
    await seedModuleRun(scan.id, ModuleName.GOVERNANCE);

    const result = await getScan({ scanId: scan.id, tier: "unauth" });

    expect(result).not.toBeNull();
    expect(result!.findings).toHaveLength(0);
    for (const m of result!.modules) {
      expect("hiddenFindingsCount" in m).toBe(false);
    }
  });

  // f) scan with status=EXPIRED → 200 + full shape

  it("(f) EXPIRED scan: getScan returns scan with status=EXPIRED and correct shape", async () => {
    const protocol = await seedProtocol();
    const scan = await seedScan(protocol.id, {
      status: ScanStatus.EXPIRED,
    });
    const govRun = await seedModuleRun(scan.id, ModuleName.GOVERNANCE);
    await seedFinding(scan.id, govRun.id, ModuleName.GOVERNANCE, 1);

    const result = await getScan({ scanId: scan.id, tier: "email" });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("EXPIRED");
    expect(result!.findings).toHaveLength(1);
    expect(result!.protocol.slug).toBeTruthy();
  });

  // g) 4 ModuleRuns in varying states → all returned, errorStack null for unauth

  it("(g) 4 modules in varying states: all returned, errorStack null for unauth", async () => {
    const protocol = await seedProtocol();
    const scan = await seedScan(protocol.id);

    const govRun = await seedModuleRun(scan.id, ModuleName.GOVERNANCE, ModuleStatus.COMPLETE);
    await seedModuleRun(scan.id, ModuleName.ORACLE, ModuleStatus.QUEUED);
    await seedModuleRun(scan.id, ModuleName.SIGNER, ModuleStatus.FAILED, {
      errorMessage: "RPC timeout",
      errorStack: "Error: RPC timeout\n  at ...",
    });
    await seedModuleRun(scan.id, ModuleName.FRONTEND, ModuleStatus.SKIPPED);

    await seedFinding(scan.id, govRun.id, ModuleName.GOVERNANCE, 1);

    const result = await getScan({ scanId: scan.id, tier: "unauth" });

    expect(result).not.toBeNull();
    expect(result!.modules).toHaveLength(4);

    const statuses = result!.modules.map((m) => m.status).sort();
    expect(statuses).toEqual(
      ["COMPLETE", "FAILED", "QUEUED", "SKIPPED"].sort(),
    );

    // All errorStacks null for unauth
    for (const m of result!.modules) {
      expect(m.errorStack).toBeNull();
    }

    // Failed module has errorMessage
    const failedModule = result!.modules.find((m) => m.status === "FAILED");
    expect(failedModule!.errorMessage).toBe("RPC timeout");
  });
});
