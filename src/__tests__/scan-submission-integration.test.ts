// @vitest-environment node
/**
 * Integration tests for the scan submission flow.
 * Uses the real Prisma client against DATABASE_URL.
 * Skipped cleanly when DATABASE_URL is unset.
 *
 * Each test scenario uses a unique ipHash / address for isolation.
 * Cleanup deletes only rows this test run creates.
 */

import {
  describe,
  it,
  expect,
  afterAll,
  afterEach,
} from "vitest";
import { randomBytes } from "node:crypto";

// ── Stub modules that scan-submission imports transitively but that
//    aren't needed for the submission flow itself. ──────────────────

// next-auth providers load nodemailer which isn't installed in this workspace.
import { vi } from "vitest";
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
// assertProductionHashSalts is a no-op outside production.
vi.mock("@/lib/config", () => ({
  assertProductionHashSalts: vi.fn(),
}));

import { prisma } from "@/lib/prisma";
import { submitScan } from "@/lib/scan-submission";
import { Chain, OwnershipStatus } from "@prisma/client";

const hasDb = !!process.env.DATABASE_URL;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Generate a unique valid Ethereum address for each test. */
function uniqueEthAddress(): string {
  return `0x${randomBytes(20).toString("hex")}`;
}

/** Generate a unique ipHash string to isolate each test's rate-limit scope. */
function uniqueIpHash(): string {
  return `test-ip-${randomBytes(8).toString("hex")}`;
}

function uniqueUserId(): string {
  return `test-user-${randomBytes(8).toString("hex")}`;
}

const TEST_IP_SALT = process.env.SCAN_IP_SALT ?? "test-ip-salt";
const TEST_EMAIL_SALT = process.env.SCAN_EMAIL_SALT ?? "test-email-salt";

// Ensure salts are available for hash functions during tests.
process.env.SCAN_IP_SALT = TEST_IP_SALT;
process.env.SCAN_EMAIL_SALT = TEST_EMAIL_SALT;

// ── Cleanup tracking ────────────────────────────────────────────────────────

const createdProtocolIds: string[] = [];
const createdScanAttemptIpHashes: string[] = [];
const createdUserIds: string[] = [];

async function cleanup() {
  // Cleanup order respects FK constraints:
  //   ScanAttempt (→ Scan, → User) first
  //   ModuleRun (→ Scan) second
  //   Scan (→ Protocol) third
  //   Protocol last
  //   User last (after scan attempts that reference it)
  //
  // We scope cleanup by protocolId so we catch ALL scans for test protocols,
  // not just the ones we tracked in createdScanIds (avoids RESTRICT FK errors).

  if (createdScanAttemptIpHashes.length) {
    await prisma.scanAttempt.deleteMany({
      where: { ipHash: { in: createdScanAttemptIpHashes } },
    });
  }

  if (createdProtocolIds.length) {
    // Find ALL scans for our test protocols (may be more than we tracked)
    const scans = await prisma.scan.findMany({
      where: { protocolId: { in: createdProtocolIds } },
      select: { id: true },
    });
    const scanIds = scans.map((s) => s.id);

    if (scanIds.length) {
      // ScanAttempts that reference these scans (by scanId FK)
      await prisma.scanAttempt.deleteMany({
        where: { scanId: { in: scanIds } },
      });
      await prisma.moduleRun.deleteMany({
        where: { scanId: { in: scanIds } },
      });
      await prisma.scan.deleteMany({ where: { id: { in: scanIds } } });
    }

    await prisma.protocol.deleteMany({
      where: {
        id: { in: createdProtocolIds },
        ownershipStatus: { not: OwnershipStatus.CURATED },
      },
    });
  }

  if (createdUserIds.length) {
    await prisma.scanAttempt.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
}

afterEach(async () => {
  await cleanup();
  createdProtocolIds.length = 0;
  createdScanAttemptIpHashes.length = 0;
  createdUserIds.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// Integration tests hit a real DB over the network — set a generous
// global timeout so individual test timeouts don't need to be annotated
// on every `it()` call.
vi.setConfig({ testTimeout: 30000 });

// ── Test suites ────────────────────────────────────────────────────────────

describe.skipIf(!hasDb)("scan submission integration", () => {
  // ── 1. Happy path — no domain ──────────────────────────────────────────

  it("happy path: creates Protocol + Scan + 4 ModuleRuns, FRONTEND skipped without domain", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const address = uniqueEthAddress();
    const result = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address,
        extraContractAddresses: [],
        multisigs: [],
        modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });

    expect(result.statusCode).toBe(202);
    expect(result.scanId).toBeTruthy();

    // Protocol created as UNCLAIMED
    const protocol = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
    });
    expect(protocol).not.toBeNull();
    expect(protocol!.ownershipStatus).toBe("UNCLAIMED");
    expect(protocol!.organizationId).toBeNull();
    createdProtocolIds.push(protocol!.id);

    // Scan is QUEUED
    const scan = await prisma.scan.findUnique({ where: { id: result.scanId } });
    expect(scan).not.toBeNull();
    expect(scan!.status).toBe("QUEUED");
    expect(scan!.ipHash).toBe(ipHash);

    // 4 ModuleRun rows
    const modules = await prisma.moduleRun.findMany({
      where: { scanId: result.scanId },
    });
    expect(modules).toHaveLength(4);

    // FRONTEND skipped (no domain)
    const frontend = modules.find((m) => m.module === "FRONTEND");
    expect(frontend!.status).toBe("SKIPPED");

    // Others queued
    for (const mod of ["GOVERNANCE", "ORACLE", "SIGNER"]) {
      const row = modules.find((m) => m.module === mod);
      expect(row!.status).toBe("QUEUED");
    }

    // ACCEPTED ScanAttempt
    const attempt = await prisma.scanAttempt.findFirst({
      where: { ipHash, status: "ACCEPTED" },
    });
    expect(attempt).not.toBeNull();
    expect(attempt!.scanId).toBe(result.scanId);
  });

  // ── 2. Happy path WITH domain — FRONTEND queued ────────────────────────

  it("happy path with domain: FRONTEND module is QUEUED", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const address = uniqueEthAddress();
    const result = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address,
        extraContractAddresses: [],
        domain: "app.example.com",
        multisigs: [],
        modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });

    expect(result.statusCode).toBe(202);

    const protocol = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
    });
    createdProtocolIds.push(protocol!.id);

    const modules = await prisma.moduleRun.findMany({
      where: { scanId: result.scanId },
    });
    expect(modules).toHaveLength(4);

    for (const mod of ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"]) {
      const row = modules.find((m) => m.module === mod);
      expect(row!.status).toBe("QUEUED");
    }
  });

  // ── 3. Dedupe path ─────────────────────────────────────────────────────

  it("dedupe: identical submission within 5 min returns 200 + same scanId", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const address = uniqueEthAddress();
    const baseInput = {
      chain: "ETHEREUM" as const,
      primaryContractAddress: address,
      extraContractAddresses: [] as string[],
      multisigs: [] as string[],
      modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"] as ("GOVERNANCE" | "ORACLE" | "SIGNER" | "FRONTEND")[],
    };

    const first = await submitScan({
      input: baseInput,
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });
    expect(first.statusCode).toBe(202);

    const protocol = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
    });
    createdProtocolIds.push(protocol!.id);

    // Second identical submission → should dedupe
    const second = await submitScan({
      input: baseInput,
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });
    expect(second.statusCode).toBe(200);
    expect(second.scanId).toBe(first.scanId);

    // DUPLICATE ScanAttempt created
    const dupAttempt = await prisma.scanAttempt.findFirst({
      where: { ipHash, status: "DUPLICATE" },
    });
    expect(dupAttempt).not.toBeNull();
    expect(dupAttempt!.scanId).toBe(first.scanId);
  });

  // ── 4. Cooldown path ───────────────────────────────────────────────────

  it("cooldown: different ipHash for same protocol within 10 min returns 429", async () => {
    const ipHashA = uniqueIpHash();
    const ipHashB = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHashA, ipHashB);

    const address = uniqueEthAddress();

    // First submission from ipHash A
    const first = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address,
        extraContractAddresses: [],
        multisigs: [],
        modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash: ipHashA,
      userAgent: "integration-test/1.0",
    });
    expect(first.statusCode).toBe(202);

    const protocol = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
    });
    createdProtocolIds.push(protocol!.id);

    // Second submission from ipHash B for the same protocol → cooldown
    const { ScanSubmissionError } = await import("@/lib/scan-submission/errors");
    await expect(
      submitScan({
        input: {
          chain: "ETHEREUM",
          primaryContractAddress: address,
          extraContractAddresses: [],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
        },
        userId: null,
        userEmail: null,
        ip: "5.6.7.8",
        ipHash: ipHashB,
        userAgent: "integration-test/1.0",
      }),
    ).rejects.toThrow(ScanSubmissionError);

    // Verify the thrown error has protocol_cooldown code and Retry-After header
    let caughtErr: unknown;
    try {
      await submitScan({
        input: {
          chain: "ETHEREUM",
          primaryContractAddress: address,
          extraContractAddresses: [],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
        },
        userId: null,
        userEmail: null,
        ip: "5.6.7.8",
        ipHash: ipHashB,
        userAgent: "integration-test/1.0",
      });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(ScanSubmissionError);
    const err = caughtErr as InstanceType<typeof ScanSubmissionError>;
    expect(err.code).toBe("protocol_cooldown");
    expect(err.statusCode).toBe(429);
    expect(err.headers["Retry-After"]).toBeTruthy();

    // RATE_LIMITED ScanAttempt with reason protocol_cooldown
    const cooldownAttempt = await prisma.scanAttempt.findFirst({
      where: { ipHash: ipHashB, status: "RATE_LIMITED", reason: "protocol_cooldown" },
    });
    expect(cooldownAttempt).not.toBeNull();
  });

  // ── 5. Curated protocol path ───────────────────────────────────────────

  it("curated protocol: returns 409 + INVALID ScanAttempt, protocol row unchanged", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    // Find a CURATED protocol from the seed (Aave, Uniswap, or Drift).
    // If the DB has no curated protocols (seed not run), create one for the test.
    let curatedProtocol = await prisma.protocol.findFirst({
      where: { ownershipStatus: "CURATED" },
    });

    let ownedCurated = false;
    if (!curatedProtocol) {
      const curatedAddress = uniqueEthAddress();
      curatedProtocol = await prisma.protocol.create({
        data: {
          chain: Chain.ETHEREUM,
          primaryContractAddress: curatedAddress,
          slug: `curated-test-${randomBytes(4).toString("hex")}`,
          displayName: "Test Curated Protocol",
          ownershipStatus: OwnershipStatus.CURATED,
          extraContractAddresses: [],
          knownMultisigs: [],
        },
      });
      createdProtocolIds.push(curatedProtocol.id);
      ownedCurated = true;
    }

    const { ScanSubmissionError } = await import("@/lib/scan-submission/errors");
    let caughtErr: unknown;
    try {
      await submitScan({
        input: {
          chain: curatedProtocol.chain,
          primaryContractAddress: curatedProtocol.primaryContractAddress,
          extraContractAddresses: [],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
        },
        userId: null,
        userEmail: null,
        ip: "1.2.3.4",
        ipHash,
        userAgent: "integration-test/1.0",
      });
    } catch (e) {
      caughtErr = e;
    }

    expect(caughtErr).toBeInstanceOf(ScanSubmissionError);
    const err = caughtErr as InstanceType<typeof ScanSubmissionError>;
    expect(err.code).toBe("curated_protocol");
    expect(err.statusCode).toBe(409);

    // INVALID ScanAttempt written
    const attempt = await prisma.scanAttempt.findFirst({
      where: { ipHash, status: "INVALID", reason: "protocol_is_curated" },
    });
    expect(attempt).not.toBeNull();

    // Protocol row unchanged (still CURATED)
    const afterProtocol = await prisma.protocol.findUnique({
      where: { id: curatedProtocol.id },
    });
    expect(afterProtocol!.ownershipStatus).toBe("CURATED");

    // If we created the curated protocol, ensure it's in cleanup list.
    // (already pushed above if ownedCurated)
    void ownedCurated;
  });

  // ── 6. Rate limit — unauthenticated (3/hr) ────────────────────────────

  it("rate limit unauth: 4th submission from same ipHash within 1hr returns 429 ip_hour", { timeout: 30000 }, async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    // Submit 3 accepted scans from the same ipHash (different protocols each time)
    for (let i = 0; i < 3; i++) {
      const address = uniqueEthAddress();
      await submitScan({
        input: {
          chain: "ETHEREUM",
          primaryContractAddress: address,
          extraContractAddresses: [],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE"],
        },
        userId: null,
        userEmail: null,
        ip: "1.2.3.4",
        ipHash,
        userAgent: "integration-test/1.0",
      });
      const protocol = await prisma.protocol.findFirst({
        where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
      });
      if (protocol) createdProtocolIds.push(protocol.id);
    }

    // 4th submission → should be rate limited
    const { ScanSubmissionError } = await import("@/lib/scan-submission/errors");
    let caughtErr: unknown;
    try {
      await submitScan({
        input: {
          chain: "ETHEREUM",
          primaryContractAddress: uniqueEthAddress(),
          extraContractAddresses: [],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE"],
        },
        userId: null,
        userEmail: null,
        ip: "1.2.3.4",
        ipHash,
        userAgent: "integration-test/1.0",
      });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(ScanSubmissionError);
    const err = caughtErr as InstanceType<typeof ScanSubmissionError>;
    expect(err.code).toBe("rate_limited");
    expect(err.statusCode).toBe(429);

    // RATE_LIMITED ScanAttempt with reason ip_hour
    const attempt = await prisma.scanAttempt.findFirst({
      where: { ipHash, status: "RATE_LIMITED", reason: "ip_hour" },
    });
    expect(attempt).not.toBeNull();
  });

  // ── 7. Rate limit — authenticated (10/hr) ─────────────────────────────

  it("rate limit auth: 11th submission from same userId within 1hr returns 429 user_hour", { timeout: 60000 }, async () => {
    const userId = uniqueUserId();
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    // Create a real user row (ScanAttempt has a FK to User)
    const user = await prisma.user.create({ data: { id: userId, email: `${userId}@test.example` } });
    createdUserIds.push(userId);

    // Submit 10 accepted scans from this userId (different protocols)
    for (let i = 0; i < 10; i++) {
      const address = uniqueEthAddress();
      await submitScan({
        input: {
          chain: "ETHEREUM",
          primaryContractAddress: address,
          extraContractAddresses: [],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE"],
        },
        userId,
        userEmail: user.email,
        ip: "1.2.3.4",
        ipHash,
        userAgent: "integration-test/1.0",
      });
      const protocol = await prisma.protocol.findFirst({
        where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
      });
      if (protocol) createdProtocolIds.push(protocol.id);
    }

    // 11th submission → user_hour rate limit
    const { ScanSubmissionError } = await import("@/lib/scan-submission/errors");
    let caughtErr: unknown;
    try {
      await submitScan({
        input: {
          chain: "ETHEREUM",
          primaryContractAddress: uniqueEthAddress(),
          extraContractAddresses: [],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE"],
        },
        userId,
        userEmail: user.email,
        ip: "1.2.3.4",
        ipHash,
        userAgent: "integration-test/1.0",
      });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(ScanSubmissionError);
    const err = caughtErr as InstanceType<typeof ScanSubmissionError>;
    expect(err.code).toBe("rate_limited");
    expect(err.statusCode).toBe(429);

    // RATE_LIMITED with reason user_hour
    const attempt = await prisma.scanAttempt.findFirst({
      where: { ipHash, status: "RATE_LIMITED", reason: "user_hour" },
    });
    expect(attempt).not.toBeNull();
  });

  // ── 8. Invalid primary address ─────────────────────────────────────────

  it("invalid primary address: returns 400 + INVALID ScanAttempt", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const { ScanSubmissionError } = await import("@/lib/scan-submission/errors");
    let caughtErr: unknown;
    try {
      await submitScan({
        input: {
          chain: "ETHEREUM",
          primaryContractAddress: "not-an-eth-address",
          extraContractAddresses: [],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
        },
        userId: null,
        userEmail: null,
        ip: "1.2.3.4",
        ipHash,
        userAgent: "integration-test/1.0",
      });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(ScanSubmissionError);
    const err = caughtErr as InstanceType<typeof ScanSubmissionError>;
    expect(err.code).toBe("invalid_address");
    expect(err.statusCode).toBe(400);

    // INVALID ScanAttempt with reason invalid_primaryContractAddress
    const attempt = await prisma.scanAttempt.findFirst({
      where: { ipHash, status: "INVALID", reason: "invalid_primaryContractAddress" },
    });
    expect(attempt).not.toBeNull();
  });

  // ── 9. Invalid extra contract address ─────────────────────────────────

  it("invalid extra address: valid primary + malformed extra returns 400", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const { ScanSubmissionError } = await import("@/lib/scan-submission/errors");
    let caughtErr: unknown;
    try {
      await submitScan({
        input: {
          chain: "ETHEREUM",
          primaryContractAddress: uniqueEthAddress(),
          extraContractAddresses: ["not-valid"],
          multisigs: [],
          modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"],
        },
        userId: null,
        userEmail: null,
        ip: "1.2.3.4",
        ipHash,
        userAgent: "integration-test/1.0",
      });
    } catch (e) {
      caughtErr = e;
    }
    expect(caughtErr).toBeInstanceOf(ScanSubmissionError);
    const err = caughtErr as InstanceType<typeof ScanSubmissionError>;
    expect(err.code).toBe("invalid_address");
    expect(err.statusCode).toBe(400);
    expect((err.details as { field?: string }).field).toBe("extraContractAddresses");

    const attempt = await prisma.scanAttempt.findFirst({
      where: { ipHash, status: "INVALID", reason: "invalid_extraContractAddresses" },
    });
    expect(attempt).not.toBeNull();
  });

  // ── 10. Module skip path ───────────────────────────────────────────────

  it("module skip: only GOVERNANCE queued when modulesEnabled = ['GOVERNANCE']", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const address = uniqueEthAddress();
    const result = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address,
        extraContractAddresses: [],
        domain: "app.example.com", // domain present but FRONTEND not in modulesEnabled
        multisigs: [],
        modulesEnabled: ["GOVERNANCE"],
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });
    expect(result.statusCode).toBe(202);

    const protocol = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
    });
    createdProtocolIds.push(protocol!.id);

    const modules = await prisma.moduleRun.findMany({
      where: { scanId: result.scanId },
    });
    expect(modules).toHaveLength(4);

    const gov = modules.find((m) => m.module === "GOVERNANCE");
    expect(gov!.status).toBe("QUEUED");

    for (const mod of ["ORACLE", "SIGNER", "FRONTEND"]) {
      const row = modules.find((m) => m.module === mod);
      expect(row!.status).toBe("SKIPPED");
    }
  });

  // ── 11. No new Protocol/Scan/ModuleRun on dedupe ─────────────────────

  it("dedupe creates no new Protocol, Scan, or ModuleRun rows", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const address = uniqueEthAddress();
    const normalizedAddr = address.toLowerCase();
    const input = {
      chain: "ETHEREUM" as const,
      primaryContractAddress: address,
      extraContractAddresses: [] as string[],
      multisigs: [] as string[],
      modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"] as ("GOVERNANCE" | "ORACLE" | "SIGNER" | "FRONTEND")[],
    };

    const first = await submitScan({
      input,
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });

    const protocol = await prisma.protocol.findFirst({
      where: { primaryContractAddress: normalizedAddr, chain: "ETHEREUM" },
    });
    createdProtocolIds.push(protocol!.id);

    // Count scans and protocols scoped to THIS address only
    const scanCountBefore = await prisma.scan.count({
      where: { protocolId: protocol!.id },
    });
    const moduleCountBefore = await prisma.moduleRun.count({
      where: { scanId: first.scanId },
    });

    const second = await submitScan({
      input,
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });
    expect(second.statusCode).toBe(200);
    expect(second.scanId).toBe(first.scanId);

    // No new Scan or ModuleRun for this protocol
    expect(
      await prisma.scan.count({ where: { protocolId: protocol!.id } }),
    ).toBe(scanCountBefore);
    expect(
      await prisma.moduleRun.count({ where: { scanId: first.scanId } }),
    ).toBe(moduleCountBefore);

    // Protocol count for this address is still 1
    expect(
      await prisma.protocol.count({
        where: { primaryContractAddress: normalizedAddr, chain: "ETHEREUM" },
      }),
    ).toBe(1);
  });

  // ── 12. Second submission after cooldown window (different protocol) ──

  it("second scan for a NEW protocol succeeds (cooldown is per-protocol)", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const address1 = uniqueEthAddress();
    const address2 = uniqueEthAddress();

    const first = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address1,
        extraContractAddresses: [],
        multisigs: [],
        modulesEnabled: ["GOVERNANCE"],
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });
    expect(first.statusCode).toBe(202);

    const p1 = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address1.toLowerCase(), chain: "ETHEREUM" },
    });
    createdProtocolIds.push(p1!.id);

    // Second scan for a DIFFERENT protocol — should succeed (different cooldownKey)
    const second = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address2,
        extraContractAddresses: [],
        multisigs: [],
        modulesEnabled: ["GOVERNANCE"],
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });
    expect(second.statusCode).toBe(202);

    const p2 = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address2.toLowerCase(), chain: "ETHEREUM" },
    });
    createdProtocolIds.push(p2!.id);
  });

  // ── 13. Submitted email hashed and stored ─────────────────────────────

  it("submittedEmail is stored normalized and hashed", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const address = uniqueEthAddress();
    const result = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address,
        extraContractAddresses: [],
        multisigs: [],
        modulesEnabled: ["GOVERNANCE"],
        submittedEmail: "Alice@Example.COM",
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });
    expect(result.statusCode).toBe(202);

    const protocol = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
    });
    createdProtocolIds.push(protocol!.id);

    const scan = await prisma.scan.findUnique({ where: { id: result.scanId } });
    expect(scan!.submittedEmail).toBe("alice@example.com");
    expect(scan!.submittedEmailHash).toBeTruthy();
    expect(scan!.submittedEmailHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // ── 14. Module inputSnapshot stored correctly ──────────────────────────

  it("ModuleRun inputSnapshot contains chain, normalizedAddress, modulesEnabled", async () => {
    const ipHash = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHash);

    const rawAddress = "0xABCDEF0123456789ABCDEF0123456789ABCDEF01";
    const result = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: rawAddress,
        extraContractAddresses: [],
        domain: "app.test.com",
        multisigs: [],
        modulesEnabled: ["GOVERNANCE", "FRONTEND"],
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash,
      userAgent: "integration-test/1.0",
    });

    const protocol = await prisma.protocol.findFirst({
      where: {
        primaryContractAddress: rawAddress.toLowerCase(),
        chain: "ETHEREUM",
      },
    });
    createdProtocolIds.push(protocol!.id);

    const govModule = await prisma.moduleRun.findFirst({
      where: { scanId: result.scanId, module: "GOVERNANCE" },
    });
    const snapshot = govModule!.inputSnapshot as {
      chain: string;
      normalizedAddress: string;
      modulesEnabled: string[];
    };
    expect(snapshot.chain).toBe("ETHEREUM");
    // Address must be normalized (lowercase)
    expect(snapshot.normalizedAddress).toBe(rawAddress.toLowerCase());
    expect(snapshot.modulesEnabled).toContain("GOVERNANCE");
    expect(snapshot.modulesEnabled).toContain("FRONTEND");
  });

  // ── 15. Reuses existing UNCLAIMED Protocol (no duplicate) ─────────────

  it("re-scans reuse existing UNCLAIMED Protocol row without creating a duplicate", { timeout: 20000 }, async () => {
    const ipHashA = uniqueIpHash();
    const ipHashB = uniqueIpHash();
    createdScanAttemptIpHashes.push(ipHashA, ipHashB);

    const address = uniqueEthAddress();

    // First scan
    const first = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address,
        extraContractAddresses: [],
        multisigs: [],
        modulesEnabled: ["GOVERNANCE"],
      },
      userId: null,
      userEmail: null,
      ip: "1.2.3.4",
      ipHash: ipHashA,
      userAgent: "integration-test/1.0",
    });
    expect(first.statusCode).toBe(202);

    const protocol = await prisma.protocol.findFirst({
      where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
    });
    createdProtocolIds.push(protocol!.id);
    const originalProtocolId = protocol!.id;

    // Fast-forward by manually backdating the ACCEPTED ScanAttempt beyond cooldown
    await prisma.scanAttempt.updateMany({
      where: { ipHash: ipHashA, status: "ACCEPTED" },
      data: { attemptedAt: new Date(Date.now() - 11 * 60 * 1000) },
    });

    // Second scan — cooldown expired, different client
    const second = await submitScan({
      input: {
        chain: "ETHEREUM",
        primaryContractAddress: address,
        extraContractAddresses: [],
        multisigs: [],
        modulesEnabled: ["GOVERNANCE"],
      },
      userId: null,
      userEmail: null,
      ip: "5.6.7.8",
      ipHash: ipHashB,
      userAgent: "integration-test/1.0",
    });
    expect(second.statusCode).toBe(202);

    // Both scans reference the same Protocol ID
    const secondScan = await prisma.scan.findUnique({
      where: { id: second.scanId },
    });
    expect(secondScan!.protocolId).toBe(originalProtocolId);

    // Only one Protocol row for this address
    const protocolCount = await prisma.protocol.count({
      where: { primaryContractAddress: address.toLowerCase(), chain: "ETHEREUM" },
    });
    expect(protocolCount).toBe(1);
  });
});
