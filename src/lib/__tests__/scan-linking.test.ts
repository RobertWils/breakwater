// @vitest-environment node
// Strategy A: vi.mock the prisma module. No real DB needed — prisma.scan.updateMany
// is stubbed with vi.fn() for call assertions and return-value control.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { linkAnonymousScans } from "@/lib/scan-linking";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    scan: {
      updateMany: vi.fn(),
    },
  },
}));

// Import after mock so the module sees the stub.
import { prisma } from "@/lib/prisma";

const mockUpdateMany = prisma.scan.updateMany as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("linkAnonymousScans()", () => {
  it("(a) happy path: links matching anonymous scans", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 3 });

    const result = await linkAnonymousScans({
      userId: "user-1",
      userEmail: "alice@example.com",
    });

    expect(result).toEqual({ linkedCount: 3, failedCount: 0 });
    expect(mockUpdateMany).toHaveBeenCalledOnce();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { submittedByUserId: null, submittedEmail: "alice@example.com" },
      data: { submittedByUserId: "user-1" },
    });
  });

  it("(b) no matching scans: returns zero count, no errors", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });

    const result = await linkAnonymousScans({
      userId: "user-2",
      userEmail: "nobody@example.com",
    });

    expect(result).toEqual({ linkedCount: 0, failedCount: 0 });
    expect(mockUpdateMany).toHaveBeenCalledOnce();
  });

  it("(c) mixed match: only unclaimed scans are updated", async () => {
    // DB returns 2 because the WHERE clause (submittedByUserId IS NULL) filters
    // out already-claimed rows — the mock simulates what Prisma returns.
    mockUpdateMany.mockResolvedValueOnce({ count: 2 });

    const result = await linkAnonymousScans({
      userId: "user-3",
      userEmail: "mixed@example.com",
    });

    expect(result).toEqual({ linkedCount: 2, failedCount: 0 });
    // Confirm the query always includes the null guard.
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ submittedByUserId: null }),
      }),
    );
  });

  it("(d) email case insensitivity: normalises to lowercase before querying", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    await linkAnonymousScans({
      userId: "user-4",
      userEmail: "Robert@Example.com",
    });

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submittedEmail: "robert@example.com",
        }),
      }),
    );
  });

  it("(e) whitespace email: trims before querying", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    await linkAnonymousScans({
      userId: "user-5",
      userEmail: "  alice@test.com  ",
    });

    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          submittedEmail: "alice@test.com",
        }),
      }),
    );
  });

  it("(f) DB error: returns failedCount:-1, does not rethrow", async () => {
    const dbError = new Error("connection refused");
    mockUpdateMany.mockRejectedValueOnce(dbError);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await linkAnonymousScans({
      userId: "user-6",
      userEmail: "bob@example.com",
    });

    expect(result).toEqual({ linkedCount: 0, failedCount: -1 });
    expect(errorSpy).toHaveBeenCalledWith(
      "[scan-linking] Transaction failed:",
      dbError,
    );

    errorSpy.mockRestore();
  });

  it("(g) missing email (null): returns zero counts, no DB call", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resultNull = await linkAnonymousScans({
      userId: "user-7",
      userEmail: null,
    });

    expect(resultNull).toEqual({ linkedCount: 0, failedCount: 0 });
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[scan-linking] No email provided, skipping",
    );

    vi.clearAllMocks();

    const resultUndefined = await linkAnonymousScans({
      userId: "user-7",
      userEmail: undefined,
    });

    expect(resultUndefined).toEqual({ linkedCount: 0, failedCount: 0 });
    expect(mockUpdateMany).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
