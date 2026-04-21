// @vitest-environment node
/**
 * Unit tests for POST /api/scan catch branch (FIX #1).
 * Prisma and submitScan are fully mocked — no DB required.
 *
 * Tests A + B: verify that the catch block:
 *   A — logs a ScanAttempt(INVALID, internal_error) on unexpected errors
 *   B — does NOT double-log on ScanSubmissionError (submitScan already logged)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock modules before importing the route ─────────────────────────────────

// Suppress assertProductionHashSalts side effect at module load time.
vi.mock("@/lib/config", () => ({
  assertProductionHashSalts: vi.fn(),
}));

// Mock next-auth so getServerSession is controllable.
vi.mock("next-auth", () => ({
  getServerSession: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

// Mock hashIp so we get a deterministic value without needing a real salt.
vi.mock("@/lib/hash", () => ({
  hashIp: vi.fn().mockReturnValue("test-ip-hash"),
}));

// Mock submitScan — we'll override per test.
const mockSubmitScan = vi.fn();
const mockLogMalformedAttempt = vi.fn();
vi.mock("@/lib/scan-submission", () => ({
  submitScan: (...args: unknown[]) => mockSubmitScan(...args),
  logMalformedAttempt: (...args: unknown[]) => mockLogMalformedAttempt(...args),
}));

// Mock prisma — we need to intercept scanAttempt.create in the catch branch.
const mockScanAttemptCreate = vi.fn().mockResolvedValue({});
vi.mock("@/lib/prisma", () => ({
  prisma: {
    scanAttempt: {
      create: (...args: unknown[]) => mockScanAttemptCreate(...args),
    },
  },
}));

// ScanSubmissionError for Test B.
import { ScanSubmissionError } from "@/lib/scan-submission/errors";
// Import route AFTER mocks.
import { POST } from "@/app/api/scan/route";

// ── Helper — build a minimal valid POST request ──────────────────────────────

function buildRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/scan", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "test-agent/1.0",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  chain: "ETHEREUM",
  primaryContractAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
  extraContractAddresses: [],
  multisigs: [],
  modulesEnabled: ["GOVERNANCE"],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: prisma create succeeds
  mockScanAttemptCreate.mockResolvedValue({});
  mockLogMalformedAttempt.mockResolvedValue(undefined);
});

// ── Test A — unexpected error triggers best-effort ScanAttempt logging ────────

describe("POST /api/scan — catch branch", () => {
  it("Test A: unexpected Error → 500 internal_error + ScanAttempt(INVALID, internal_error) logged", async () => {
    mockSubmitScan.mockRejectedValue(new Error("boom"));

    const req = buildRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toMatchObject({ error: "internal_error" });

    // Best-effort ScanAttempt row must have been created with sentinel values.
    expect(mockScanAttemptCreate).toHaveBeenCalledOnce();
    const createArg = mockScanAttemptCreate.mock.calls[0][0] as {
      data: {
        status: string;
        reason: string;
        cooldownKey: string;
        inputPayloadHash: string;
        scanId: null;
      };
    };
    expect(createArg.data.status).toBe("INVALID");
    expect(createArg.data.reason).toBe("internal_error");
    expect(createArg.data.cooldownKey).toBe("internal:error");
    expect(createArg.data.inputPayloadHash).toBe("internal:error");
    expect(createArg.data.scanId).toBeNull();
  });

  // ── Test B — ScanSubmissionError is NOT double-logged ────────────────────────

  it("Test B: ScanSubmissionError → forwarded status/body, NO extra ScanAttempt row", async () => {
    const scanErr = new ScanSubmissionError(
      "rate_limited",
      429,
      "Too many requests",
      { scope: "ip", retryAfterSec: 60 },
      { "Retry-After": "60" },
    );
    mockSubmitScan.mockRejectedValue(scanErr);

    const req = buildRequest(VALID_BODY);
    const res = await POST(req);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json).toMatchObject({ error: "rate_limited" });

    // submitScan already logged the attempt — route must NOT add another row.
    expect(mockScanAttemptCreate).not.toHaveBeenCalled();
  });
});
