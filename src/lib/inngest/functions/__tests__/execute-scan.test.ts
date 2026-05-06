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

  function makeClient(opts: {
    modules: Module[];
    updateCount?: number;
    scanExists?: boolean;
  }) {
    return {
      scan: {
        findUnique: vi.fn(async () =>
          opts.scanExists === false
            ? null
            : { id: "scan-1", modules: opts.modules },
        ),
        updateMany: vi.fn(async () => ({ count: opts.updateCount ?? 1 })),
      },
      moduleRun: { updateMany: vi.fn() },
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
    expect(result).toEqual({
      finalStatus: "COMPLETE",
      deferred: false,
      alreadyFinalized: false,
    });
  });

  it("captures finalStatus=FAILED when any module FAILED (and rest terminal)", async () => {
    const client = makeClient({
      modules: [{ status: "FAILED" }, { status: "COMPLETE" }],
    });
    const result = await markComplete(client, "scan-1");
    expect(result).toEqual({
      finalStatus: "FAILED",
      deferred: false,
      alreadyFinalized: false,
    });
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
