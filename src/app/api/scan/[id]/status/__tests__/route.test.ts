// @vitest-environment node
/**
 * Integration tests for GET /api/scan/[id]/status (Plan 02 G.1).
 *
 * Real Prisma client against DATABASE_URL. Skipped cleanly when
 * DATABASE_URL is unset. Follows the seed + cleanup pattern from
 * scan-get-integration.test.ts.
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

import { prisma } from "@/lib/prisma";
import {
  Chain,
  Grade,
  ModuleName,
  ModuleStatus,
  OwnershipStatus,
  ScanStatus,
} from "@prisma/client";

import { GET } from "../route";

const hasDb = !!process.env.DATABASE_URL;

vi.setConfig({ testTimeout: 30000 });

// ── cleanup tracking ──────────────────────────────────────────────────────

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

// ── seed helpers ──────────────────────────────────────────────────────────

function uniqueAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

function uniqueSlug(): string {
  return `gstatus-${randomBytes(6).toString("hex")}`;
}

function uniqueIdempotencyKey(): string {
  return `idem-${randomBytes(8).toString("hex")}`;
}

async function seedProtocol() {
  const protocol = await prisma.protocol.create({
    data: {
      slug: uniqueSlug(),
      displayName: "G.1 Status Test Protocol",
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

async function seedScan(status: ScanStatus) {
  const protocol = await seedProtocol();
  return prisma.scan.create({
    data: {
      protocolId: protocol.id,
      ipHash: `test-ip-${randomBytes(8).toString("hex")}`,
      userAgent: "g1-status-test/1.0",
      status,
      compositeScore: status === "COMPLETE" ? 80 : null,
      compositeGrade: status === "COMPLETE" ? Grade.B : null,
      isPartialGrade: false,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });
}

async function seedModuleRun(scanId: string) {
  return prisma.moduleRun.create({
    data: {
      scanId,
      module: ModuleName.GOVERNANCE,
      status: ModuleStatus.COMPLETE,
      grade: Grade.B,
      score: 80,
      findingsCount: 0,
      detectorVersions: {},
      inputSnapshot: {},
      rpcCallsUsed: 0,
      idempotencyKey: uniqueIdempotencyKey(),
    },
  });
}

function buildRequest(scanId: string): NextRequest {
  return new NextRequest(`http://localhost/api/scan/${scanId}/status`);
}

// ── tests ─────────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)(
  "GET /api/scan/[id]/status (Plan 02 G.1 — lightweight polling endpoint)",
  () => {
    it("returns lightweight status payload for QUEUED scan with Cache-Control: no-store", async () => {
      const scan = await seedScan("QUEUED");
      await seedModuleRun(scan.id);

      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const body = await res.json();
      expect(body.id).toBe(scan.id);
      expect(body.status).toBe("QUEUED");
      expect(Array.isArray(body.modules)).toBe(true);
      expect(body.modules).toHaveLength(1);
      expect(body.modules[0]).toEqual({
        module: "GOVERNANCE",
        status: "COMPLETE",
        grade: "B",
      });

      // No findings, no protocol, no error stacks leak through this endpoint.
      expect(body).not.toHaveProperty("findings");
      expect(body).not.toHaveProperty("protocol");
      expect(body).not.toHaveProperty("compositeGrade");
    });

    it("returns Cache-Control: no-store for RUNNING (non-terminal)", async () => {
      const scan = await seedScan("RUNNING");
      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("returns Cache-Control: no-store for PARTIAL_COMPLETE (still polling, spec §6.2)", async () => {
      const scan = await seedScan("PARTIAL_COMPLETE");
      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    });

    it("returns Cache-Control: private, max-age=60 for terminal COMPLETE", async () => {
      const scan = await seedScan("COMPLETE");
      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    });

    it("returns Cache-Control: private, max-age=60 for terminal FAILED", async () => {
      const scan = await seedScan("FAILED");
      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    });

    it("returns Cache-Control: private, max-age=60 for terminal EXPIRED", async () => {
      const scan = await seedScan("EXPIRED");
      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    });

    it("returns 404 with scan_not_found when the scan is missing", async () => {
      // Random valid-shape UUID so we pass the UUID gate, but no row exists.
      const fakeId = "00000000-0000-4000-8000-000000000000";
      const res = await GET(buildRequest(fakeId), { params: { id: fakeId } });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toBe("scan_not_found");
    });

    it("returns 400 with invalid_scan_id when the id is not a UUID", async () => {
      const res = await GET(buildRequest("not-a-uuid"), {
        params: { id: "not-a-uuid" },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("invalid_scan_id");
    });

    it("payload stays under 500 bytes for a typical scan (target ≤200 typical)", async () => {
      const scan = await seedScan("COMPLETE");
      await seedModuleRun(scan.id);

      const res = await GET(buildRequest(scan.id), { params: { id: scan.id } });
      const text = await res.text();
      // 500 is a loose ceiling — spec §6.3 targets ~200 bytes typical.
      // Single-module scans should sit well under this.
      expect(text.length).toBeLessThan(500);
    });
  },
);
