// @vitest-environment node
/**
 * Unit tests for checkIpRateLimit and checkDedupe.
 * Prisma is fully mocked — no DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma before importing the module under test ──
const mockCount = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scanAttempt: {
      count: (...args: unknown[]) => mockCount(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

import { checkIpRateLimit, checkDedupe } from "@/lib/rate-limit";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── checkIpRateLimit — unauthenticated ───────────────────────────────────────

describe("checkIpRateLimit — unauthenticated (limit = 3)", () => {
  it("allows when count is below limit", async () => {
    mockCount.mockResolvedValue(2);
    const result = await checkIpRateLimit({ ipHash: "hash-a", userId: null });
    expect(result.allowed).toBe(true);
    expect(result.retryAfterSec).toBe(0);
  });

  it("allows when count is exactly 0", async () => {
    mockCount.mockResolvedValue(0);
    const result = await checkIpRateLimit({ ipHash: "hash-a", userId: null });
    expect(result.allowed).toBe(true);
  });

  it("denies when count equals the limit (3)", async () => {
    mockCount.mockResolvedValue(3);
    // oldest row was added 30 minutes ago → retry in 30 min
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
    mockFindFirst.mockResolvedValue({ attemptedAt: thirtyMinAgo });

    const result = await checkIpRateLimit({ ipHash: "hash-a", userId: null });
    expect(result.allowed).toBe(false);
    // retryAfter ≈ 30 min = 1800 sec (within ±5 sec of scheduling jitter)
    expect(result.retryAfterSec).toBeGreaterThan(1790);
    expect(result.retryAfterSec).toBeLessThanOrEqual(1801);
  });

  it("denies when count exceeds the limit", async () => {
    mockCount.mockResolvedValue(5);
    const fiftyMinAgo = new Date(Date.now() - 50 * 60 * 1000);
    mockFindFirst.mockResolvedValue({ attemptedAt: fiftyMinAgo });

    const result = await checkIpRateLimit({ ipHash: "hash-a", userId: null });
    expect(result.allowed).toBe(false);
    // retry ≈ 10 min = 600 sec
    expect(result.retryAfterSec).toBeGreaterThan(595);
    expect(result.retryAfterSec).toBeLessThanOrEqual(601);
  });

  it("uses ipHash (not userId) in the where clause for unauth", async () => {
    mockCount.mockResolvedValue(0);
    await checkIpRateLimit({ ipHash: "my-ip-hash", userId: null });

    const call = mockCount.mock.calls[0][0];
    expect(call.where).toMatchObject({ ipHash: "my-ip-hash" });
    expect(call.where.userId).toBeUndefined();
  });

  it("returns retryAfterSec of at least 1 when oldest row just expired", async () => {
    mockCount.mockResolvedValue(3);
    // oldest row is right at the boundary — retryAfter would be 0 or negative
    const justExpired = new Date(Date.now() - 60 * 60 * 1000 + 100);
    mockFindFirst.mockResolvedValue({ attemptedAt: justExpired });

    const result = await checkIpRateLimit({ ipHash: "hash-a", userId: null });
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("falls back to full window when no oldest row found", async () => {
    mockCount.mockResolvedValue(3);
    mockFindFirst.mockResolvedValue(null);

    const result = await checkIpRateLimit({ ipHash: "hash-a", userId: null });
    expect(result.allowed).toBe(false);
    // Full 1-hour window fallback
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(3599);
    expect(result.retryAfterSec).toBeLessThanOrEqual(3601);
  });
});

// ─── checkIpRateLimit — authenticated ────────────────────────────────────────

describe("checkIpRateLimit — authenticated (limit = 10)", () => {
  it("allows when count is below limit (e.g. 3 — which would block unauth)", async () => {
    mockCount.mockResolvedValue(3);
    const result = await checkIpRateLimit({
      ipHash: "hash-b",
      userId: "user-123",
    });
    expect(result.allowed).toBe(true);
  });

  it("allows when count is exactly 9", async () => {
    mockCount.mockResolvedValue(9);
    const result = await checkIpRateLimit({
      ipHash: "hash-b",
      userId: "user-123",
    });
    expect(result.allowed).toBe(true);
  });

  it("denies when count equals the auth limit (10)", async () => {
    mockCount.mockResolvedValue(10);
    const fortyMinAgo = new Date(Date.now() - 40 * 60 * 1000);
    mockFindFirst.mockResolvedValue({ attemptedAt: fortyMinAgo });

    const result = await checkIpRateLimit({
      ipHash: "hash-b",
      userId: "user-123",
    });
    expect(result.allowed).toBe(false);
    // retry ≈ 20 min = 1200 sec
    expect(result.retryAfterSec).toBeGreaterThan(1195);
    expect(result.retryAfterSec).toBeLessThanOrEqual(1201);
  });

  it("queries by userId (not ipHash) for authenticated users", async () => {
    mockCount.mockResolvedValue(0);
    await checkIpRateLimit({ ipHash: "hash-b", userId: "user-xyz" });

    const call = mockCount.mock.calls[0][0];
    expect(call.where).toMatchObject({ userId: "user-xyz" });
    expect(call.where.ipHash).toBeUndefined();
  });

  it("uses oldest row to compute retry-after (rate limit semantic)", async () => {
    mockCount.mockResolvedValue(10);
    // oldest was 55 min ago → retry in 5 min = 300 sec
    const fiftyFiveMinAgo = new Date(Date.now() - 55 * 60 * 1000);
    mockFindFirst.mockResolvedValue({ attemptedAt: fiftyFiveMinAgo });

    const result = await checkIpRateLimit({
      ipHash: "hash-b",
      userId: "user-123",
    });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(295);
    expect(result.retryAfterSec).toBeLessThanOrEqual(301);
  });
});

// ─── checkDedupe ─────────────────────────────────────────────────────────────

describe("checkDedupe", () => {
  it("returns existingScanId when a recent match exists", async () => {
    mockFindFirst.mockResolvedValue({ scanId: "scan-abc" });

    const result = await checkDedupe({
      ipHash: "ip-hash",
      inputPayloadHash: "payload-hash",
    });
    expect(result.existingScanId).toBe("scan-abc");
  });

  it("returns null when no recent match exists", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await checkDedupe({
      ipHash: "ip-hash",
      inputPayloadHash: "payload-hash",
    });
    expect(result.existingScanId).toBeNull();
  });

  it("returns null when match has null scanId", async () => {
    mockFindFirst.mockResolvedValue({ scanId: null });

    const result = await checkDedupe({
      ipHash: "ip-hash",
      inputPayloadHash: "payload-hash",
    });
    // null scanId is excluded by the `scanId: { not: null }` filter,
    // but even if returned, the fallback is null.
    expect(result.existingScanId).toBeNull();
  });

  it("passes correct where clause to prisma", async () => {
    mockFindFirst.mockResolvedValue(null);

    await checkDedupe({ ipHash: "test-ip", inputPayloadHash: "test-payload" });

    const call = mockFindFirst.mock.calls[0][0];
    expect(call.where).toMatchObject({
      ipHash: "test-ip",
      inputPayloadHash: "test-payload",
      status: "ACCEPTED",
      scanId: { not: null },
    });
    expect(call.where.attemptedAt).toBeDefined();
  });

  it("returns null for different ipHash even if payloadHash matches", async () => {
    // Simulate no match found (DB filters by both)
    mockFindFirst.mockResolvedValue(null);

    const result = await checkDedupe({
      ipHash: "different-ip",
      inputPayloadHash: "payload-hash",
    });
    expect(result.existingScanId).toBeNull();
  });

  it("returns null for different payloadHash even if ipHash matches", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await checkDedupe({
      ipHash: "ip-hash",
      inputPayloadHash: "different-payload",
    });
    expect(result.existingScanId).toBeNull();
  });

  it("queries with desc order by attemptedAt (most recent first)", async () => {
    mockFindFirst.mockResolvedValue(null);

    await checkDedupe({ ipHash: "ip", inputPayloadHash: "ph" });

    const call = mockFindFirst.mock.calls[0][0];
    expect(call.orderBy).toMatchObject({ attemptedAt: "desc" });
  });
});
