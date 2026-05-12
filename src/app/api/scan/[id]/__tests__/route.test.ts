// @vitest-environment node
/**
 * Cache-Control header tests for GET /api/scan/[id] (Plan 02 G.1 Step 2.5).
 *
 * Spec §6.2 requires the main scan endpoint to branch Cache-Control on
 * terminal vs non-terminal scan status — the Plan 01 route shipped
 * with `private, no-cache, no-store, must-revalidate` for every state.
 *
 * Real Prisma client against DATABASE_URL. Skipped cleanly when
 * DATABASE_URL is unset. Follows the seed + cleanup pattern from
 * scan-get-integration.test.ts.
 *
 * Findings shape + tier gating are already covered by
 * scan-get-integration.test.ts; this file is narrowly scoped to the
 * cache-control branch behavior.
 */

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";

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
// next-auth getServerSession returns null → tier=unauth in the route.
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));

import { prisma } from "@/lib/prisma";
import {
  Chain,
  Grade,
  OwnershipStatus,
  ScanStatus,
} from "@prisma/client";

import { GET } from "../route";

const hasDb = !!process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 30000 });

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

function uniqueAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

function uniqueSlug(): string {
  return `gid-${randomBytes(6).toString("hex")}`;
}

async function seedScan(status: ScanStatus) {
  const protocol = await prisma.protocol.create({
    data: {
      slug: uniqueSlug(),
      displayName: "G.1 cache-control test protocol",
      chain: Chain.ETHEREUM,
      primaryContractAddress: uniqueAddress(),
      extraContractAddresses: [],
      ownershipStatus: OwnershipStatus.UNCLAIMED,
      knownMultisigs: [],
    },
  });
  createdProtocolIds.push(protocol.id);
  return prisma.scan.create({
    data: {
      protocolId: protocol.id,
      ipHash: `test-ip-${randomBytes(8).toString("hex")}`,
      userAgent: "g1-cachectrl-test/1.0",
      status,
      compositeScore: status === "COMPLETE" ? 80 : null,
      compositeGrade: status === "COMPLETE" ? Grade.B : null,
      isPartialGrade: false,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });
}

function buildRequest(scanId: string): NextRequest {
  return new NextRequest(`http://localhost/api/scan/${scanId}`);
}

describe.skipIf(!hasDb)(
  "GET /api/scan/[id] — Cache-Control header (Plan 02 G.1 Step 2.5, spec §6.2)",
  () => {
    it("non-terminal QUEUED scan returns Cache-Control: no-store", async () => {
      const scan = await seedScan("QUEUED");
      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("terminal COMPLETE scan returns Cache-Control: private, max-age=60", async () => {
      const scan = await seedScan("COMPLETE");
      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    });
  },
);
