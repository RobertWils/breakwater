// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import {
  executeScan,
  markComplete,
  markRunning,
} from "../execute-scan";

describe("executeScan function (Plan 02 C.1 + C.4)", () => {
  it("exports a function instance", () => {
    expect(executeScan).toBeDefined();
    expect(typeof executeScan).toBe("object");
  });

  it("carries the configured id", () => {
    expect(executeScan.opts.id).toBe("execute-scan");
  });

  it("carries the configured retries policy", () => {
    expect(executeScan.opts.retries).toBe(3);
  });

  it("triggers on scan.queued (Inngest 3.x normalizes single-event form into opts.triggers[])", () => {
    const opts = executeScan.opts as { triggers?: Array<{ event?: string }> };
    expect(opts.triggers).toBeDefined();
    expect(opts.triggers).toHaveLength(1);
    expect(opts.triggers?.[0]).toMatchObject({ event: "scan.queued" });
  });
});

describe("markRunning helper (C.4 B2 — compare-and-set on QUEUED)", () => {
  function makeClient(updateCount: number) {
    return {
      scan: {
        updateMany: vi.fn(async () => ({ count: updateCount })),
        findUnique: vi.fn(),
      },
      moduleRun: { updateMany: vi.fn() },
      finding: { findMany: vi.fn(async () => []) },
    } as unknown as Parameters<typeof markRunning>[0];
  }

  it("returns skipped:false when QUEUED row was updated", async () => {
    const client = makeClient(1);
    const result = await markRunning(client, "scan-1");
    expect(result).toEqual({ skipped: false });
  });

  it("returns skipped:true with reason scan_not_queued when no row matched", async () => {
    const client = makeClient(0);
    const result = await markRunning(client, "scan-1");
    expect(result).toEqual({ skipped: true, reason: "scan_not_queued" });
  });

  it("issues compare-and-set with status:QUEUED filter", async () => {
    const client = makeClient(1);
    await markRunning(client, "scan-42");
    const updateMany = client.scan.updateMany as unknown as {
      mock: { calls: unknown[][] };
    };
    const args = updateMany.mock.calls[0]![0] as {
      where: { id: string; status: string };
      data: { status: string };
    };
    expect(args.where.id).toBe("scan-42");
    expect(args.where.status).toBe("QUEUED");
    expect(args.data.status).toBe("RUNNING");
  });
});

describe("markComplete helper (C.4 B1 + I3 — finalStatus capture + race guards)", () => {
  type Module = { status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "SKIPPED" };
  type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

  function makeClient(opts: {
    modules: Module[];
    updateCount?: number;
    scanExists?: boolean;
    findings?: Array<{ severity: Severity }>;
    executionStartedAt?: Date | null;
  }) {
    return {
      scan: {
        findUnique: vi.fn(async () =>
          opts.scanExists === false
            ? null
            : {
                id: "scan-1",
                modules: opts.modules,
                executionStartedAt:
                  opts.executionStartedAt === undefined
                    ? new Date("2026-05-05T12:00:00.000Z")
                    : opts.executionStartedAt,
              },
        ),
        updateMany: vi.fn(async () => ({ count: opts.updateCount ?? 1 })),
      },
      moduleRun: { updateMany: vi.fn() },
      finding: {
        findMany: vi.fn(async () => opts.findings ?? []),
      },
    } as unknown as Parameters<typeof markComplete>[0];
  }

  it("returns deferred:true when a module is still RUNNING", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }, { status: "RUNNING" }],
    });
    const result = await markComplete(client, "scan-1");
    expect(result).toEqual({
      finalStatus: null,
      deferred: true,
      alreadyFinalized: false,
    });
  });

  it("returns deferred:true when a module is still QUEUED", async () => {
    const client = makeClient({
      modules: [{ status: "QUEUED" }, { status: "COMPLETE" }],
    });
    const result = await markComplete(client, "scan-1");
    expect(result.deferred).toBe(true);
  });

  it("captures finalStatus=COMPLETE when every module COMPLETE or SKIPPED", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }, { status: "SKIPPED" }],
    });
    const result = await markComplete(client, "scan-1");
    expect(result.finalStatus).toBe("COMPLETE");
    expect(result.deferred).toBe(false);
    expect(result.alreadyFinalized).toBe(false);
  });

  it("captures finalStatus=FAILED when any module FAILED (and rest terminal)", async () => {
    const client = makeClient({
      modules: [{ status: "FAILED" }, { status: "COMPLETE" }],
    });
    const result = await markComplete(client, "scan-1");
    expect(result.finalStatus).toBe("FAILED");
    expect(result.deferred).toBe(false);
    expect(result.alreadyFinalized).toBe(false);
  });

  it("returns alreadyFinalized:true when the RUNNING compare-and-set finds nothing to update", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
      updateCount: 0,
    });
    const result = await markComplete(client, "scan-1");
    expect(result).toEqual({
      finalStatus: null,
      deferred: false,
      alreadyFinalized: true,
    });
  });

  it("issues compare-and-set with status:RUNNING filter on the finalize update", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
    });
    await markComplete(client, "scan-1");
    const updateMany = client.scan.updateMany as unknown as {
      mock: { calls: unknown[][] };
    };
    const args = updateMany.mock.calls[0]![0] as {
      where: { id: string; status: string };
      data: { status: string };
    };
    expect(args.where.status).toBe("RUNNING");
    expect(args.data.status).toBe("COMPLETE");
  });

  it("throws when the scan row is missing", async () => {
    const client = makeClient({ modules: [], scanExists: false });
    await expect(markComplete(client, "scan-1")).rejects.toThrow(
      /not found/,
    );
  });

  it("with empty modules array, treats all-terminal-success as vacuously true → COMPLETE", async () => {
    // Edge case: a scan with zero ModuleRun rows should not silently
    // succeed in production, but the helper logic (every() over an
    // empty array is true) needs explicit coverage so a future schema
    // change that creates Scans without modules surfaces as an
    // observable spec deviation rather than a silent-pass.
    const client = makeClient({ modules: [] });
    const result = await markComplete(client, "scan-1");
    expect(result.finalStatus).toBe("COMPLETE");
  });
});

describe("markComplete grade integration (F.3 — compositeScore + compositeGrade + executionMs)", () => {
  type Module = { status: "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "SKIPPED" };
  type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

  type FinalizedResult = Extract<
    Awaited<ReturnType<typeof markComplete>>,
    { finalStatus: NonNullable<unknown> }
  >;

  function expectFinalized(
    result: Awaited<ReturnType<typeof markComplete>>,
  ): FinalizedResult {
    if (result.finalStatus === null) {
      throw new Error(
        `expected finalized result, got ${JSON.stringify(result)}`,
      );
    }
    return result;
  }

  function makeClient(opts: {
    modules: Module[];
    updateCount?: number;
    findings?: Array<{ severity: Severity }>;
    executionStartedAt?: Date | null;
  }) {
    return {
      scan: {
        findUnique: vi.fn(async () => ({
          id: "scan-1",
          modules: opts.modules,
          executionStartedAt:
            opts.executionStartedAt === undefined
              ? new Date(Date.now() - 1234)
              : opts.executionStartedAt,
        })),
        updateMany: vi.fn(async () => ({ count: opts.updateCount ?? 1 })),
      },
      moduleRun: { updateMany: vi.fn() },
      finding: {
        findMany: vi.fn(async () => opts.findings ?? []),
      },
    } as unknown as Parameters<typeof markComplete>[0];
  }

  it("COMPLETE scan with zero findings → score 100, grade A", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }, { status: "SKIPPED" }],
      findings: [],
    });
    const result = expectFinalized(await markComplete(client, "scan-1"));
    expect(result.finalStatus).toBe("COMPLETE");
    expect(result.compositeScore).toBe(100);
    expect(result.compositeGrade).toBe("A");
    expect(result.findingsCount).toBe(0);
  });

  it("COMPLETE scan with 1 CRITICAL finding → score 65, grade C (spec §5.3)", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
      findings: [{ severity: "CRITICAL" }],
    });
    const result = expectFinalized(await markComplete(client, "scan-1"));
    expect(result.compositeScore).toBe(65);
    expect(result.compositeGrade).toBe("C");
    expect(result.findingsCount).toBe(1);
  });

  it("COMPLETE scan with 3 CRITICAL findings → grade F (floor override)", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
      findings: [
        { severity: "CRITICAL" },
        { severity: "CRITICAL" },
        { severity: "CRITICAL" },
      ],
    });
    const result = expectFinalized(await markComplete(client, "scan-1"));
    expect(result.compositeGrade).toBe("F");
    expect(result.findingsCount).toBe(3);
  });

  it("FAILED scan persists null compositeScore + compositeGrade (Option 1)", async () => {
    const client = makeClient({
      modules: [{ status: "FAILED" }, { status: "COMPLETE" }],
      findings: [{ severity: "CRITICAL" }],
    });
    const result = expectFinalized(await markComplete(client, "scan-1"));
    expect(result.finalStatus).toBe("FAILED");
    expect(result.compositeScore).toBeNull();
    expect(result.compositeGrade).toBeNull();
    // FAILED skips the finding lookup — partial findings don't represent
    // a meaningful assessment, so we don't even query for them.
    expect(client.finding.findMany).not.toHaveBeenCalled();
  });

  it("FAILED scan still reports findingsCount=0 (no lookup performed)", async () => {
    const client = makeClient({
      modules: [{ status: "FAILED" }],
      findings: [{ severity: "HIGH" }],
    });
    const result = expectFinalized(await markComplete(client, "scan-1"));
    expect(result.findingsCount).toBe(0);
  });

  it("persists compositeScore + compositeGrade in the scan.updateMany call", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
      findings: [{ severity: "HIGH" }],
    });
    await markComplete(client, "scan-1");
    const updateMany = client.scan.updateMany as unknown as {
      mock: { calls: unknown[][] };
    };
    const args = updateMany.mock.calls[0]![0] as {
      data: {
        status: string;
        compositeScore: number | null;
        compositeGrade: string | null;
      };
    };
    expect(args.data.compositeScore).toBe(80);
    expect(args.data.compositeGrade).toBe("B");
  });

  it("persists null compositeScore + compositeGrade on FAILED scans", async () => {
    const client = makeClient({
      modules: [{ status: "FAILED" }],
    });
    await markComplete(client, "scan-1");
    const updateMany = client.scan.updateMany as unknown as {
      mock: { calls: unknown[][] };
    };
    const args = updateMany.mock.calls[0]![0] as {
      data: { compositeScore: number | null; compositeGrade: string | null };
    };
    expect(args.data.compositeScore).toBeNull();
    expect(args.data.compositeGrade).toBeNull();
  });

  it("calculates executionMs from executionStartedAt → completedAt", async () => {
    const startedAt = new Date("2026-05-05T12:00:00.000Z");
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
      executionStartedAt: startedAt,
    });
    const before = Date.now();
    const result = expectFinalized(await markComplete(client, "scan-1"));
    const after = Date.now();
    // executionMs should be roughly (now - startedAt). Bound the range
    // loosely to avoid clock-jitter flakiness.
    const elapsedMin = before - startedAt.getTime();
    const elapsedMax = after - startedAt.getTime();
    expect(result.executionMs).toBeGreaterThanOrEqual(elapsedMin);
    expect(result.executionMs).toBeLessThanOrEqual(elapsedMax);
  });

  it("returns executionMs=0 when executionStartedAt is null (defensive)", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
      executionStartedAt: null,
    });
    const result = expectFinalized(await markComplete(client, "scan-1"));
    expect(result.executionMs).toBe(0);
  });

  it("queries findings filtered by scanId with severity-only select", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
      findings: [{ severity: "MEDIUM" }],
    });
    await markComplete(client, "scan-42");
    const findMany = client.finding.findMany as unknown as {
      mock: { calls: unknown[][] };
    };
    const args = findMany.mock.calls[0]![0] as {
      where: { scanId: string };
      select: { severity: boolean };
    };
    expect(args.where.scanId).toBe("scan-42");
    expect(args.select.severity).toBe(true);
  });

  it("deferred path does not query findings (no premature lookup)", async () => {
    const client = makeClient({
      modules: [{ status: "RUNNING" }, { status: "COMPLETE" }],
    });
    const result = await markComplete(client, "scan-1");
    expect(result.deferred).toBe(true);
    expect(client.finding.findMany).not.toHaveBeenCalled();
  });

  it("alreadyFinalized path returns null fields and skips persistence", async () => {
    const client = makeClient({
      modules: [{ status: "COMPLETE" }],
      findings: [{ severity: "LOW" }],
      updateCount: 0,
    });
    const result = await markComplete(client, "scan-1");
    expect(result).toEqual({
      finalStatus: null,
      deferred: false,
      alreadyFinalized: true,
    });
  });
});
