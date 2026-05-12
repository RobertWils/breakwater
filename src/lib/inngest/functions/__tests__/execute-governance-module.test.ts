// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factory is hoisted to module top — declare the spy via
// vi.hoisted so it's available when the factory runs.
const { persistGovernanceSnapshotMock } = vi.hoisted(() => ({
  persistGovernanceSnapshotMock: vi.fn(),
}));

vi.mock("@/lib/detectors/governance/persist-snapshot", () => ({
  persistGovernanceSnapshot: persistGovernanceSnapshotMock,
}));

import { baseSnapshot } from "@/lib/detectors/governance/__tests__/fixtures";
import type {
  GovernanceDetector,
  GovernanceFindingInput,
} from "@/lib/detectors/governance/types";

import {
  computeModuleExecutionMs,
  executeGovernanceModule,
  loadScanContext,
  markModuleComplete,
  markModuleRunning,
  markModuleSkippedDisabled,
  persistSnapshotAndFindings,
  runDetectors,
} from "../execute-governance-module";

// ── helpers ──────────────────────────────────────────────────────────────

function fakeUpdateMany(count: number) {
  return vi.fn<(args: unknown) => Promise<{ count: number }>>(async () => ({
    count,
  }));
}

type AnyFn = (...args: unknown[]) => unknown;

function fakeClient(over: Record<string, Record<string, AnyFn>>) {
  return {
    moduleRun: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      ...over.moduleRun,
    },
    scan: {
      findUnique: vi.fn(),
      ...over.scan,
    },
    finding: {
      createMany: vi.fn(),
      ...over.finding,
    },
  } as never;
}

describe("executeGovernanceModule (Plan 02 F.1 — function shape)", () => {
  it("exports an Inngest function with id execute-governance-module", () => {
    expect(executeGovernanceModule).toBeDefined();
    expect(executeGovernanceModule.opts.id).toBe("execute-governance-module");
  });

  it("retries: 2 (transient failures absorbed by Inngest)", () => {
    expect(executeGovernanceModule.opts.retries).toBe(2);
  });

  it("triggers on scan.module.requested with module-equality filter", () => {
    const opts = executeGovernanceModule.opts as {
      triggers?: Array<{ event?: string; if?: string }>;
    };
    expect(opts.triggers).toBeDefined();
    expect(opts.triggers?.[0]?.event).toBe("scan.module.requested");
    expect(opts.triggers?.[0]?.if).toBe('event.data.module == "GOVERNANCE"');
  });
});

describe("markModuleRunning (compare-and-set on QUEUED)", () => {
  it("returns skipped:false when the QUEUED row was updated", async () => {
    const client = fakeClient({
      moduleRun: { updateMany: fakeUpdateMany(1) },
    });
    const result = await markModuleRunning(client, "scan-1", "evt-1");
    expect(result).toEqual({ skipped: false });
  });

  it("returns skipped:true when no row matched (already running/finalised/missing)", async () => {
    const client = fakeClient({
      moduleRun: { updateMany: fakeUpdateMany(0) },
    });
    const result = await markModuleRunning(client, "scan-1", "evt-1");
    expect(result).toEqual({ skipped: true });
  });

  it("issues update with status:QUEUED filter and writes inngestEventId/RunId", async () => {
    const updateMany = fakeUpdateMany(1);
    const client = fakeClient({ moduleRun: { updateMany } });
    await markModuleRunning(client, "scan-42", "evt-99");
    const args = updateMany.mock.calls[0]![0] as {
      where: { scanId: string; module: string; status: string };
      data: { status: string; inngestEventId: string; inngestRunId: string };
    };
    expect(args.where.scanId).toBe("scan-42");
    expect(args.where.module).toBe("GOVERNANCE");
    expect(args.where.status).toBe("QUEUED");
    expect(args.data.status).toBe("RUNNING");
    expect(args.data.inngestEventId).toBe("evt-99");
    expect(args.data.inngestRunId).toBe("evt-99");
  });

  it("writes nulls for inngestEventId/RunId when event id is undefined", async () => {
    const updateMany = fakeUpdateMany(1);
    const client = fakeClient({ moduleRun: { updateMany } });
    await markModuleRunning(client, "scan-1", undefined);
    const args = updateMany.mock.calls[0]![0] as {
      data: { inngestEventId: string | null; inngestRunId: string | null };
    };
    expect(args.data.inngestEventId).toBeNull();
    expect(args.data.inngestRunId).toBeNull();
  });
});

describe("markModuleSkippedDisabled", () => {
  it("marks the QUEUED row as SKIPPED with the feature-flag reason", async () => {
    const updateMany = fakeUpdateMany(1);
    const client = fakeClient({ moduleRun: { updateMany } });
    const result = await markModuleSkippedDisabled(client, "scan-1");
    expect(result).toEqual({ marked: 1 });

    const args = updateMany.mock.calls[0]![0] as {
      where: { status: string };
      data: { status: string; errorMessage: string };
    };
    expect(args.where.status).toBe("QUEUED");
    expect(args.data.status).toBe("SKIPPED");
    expect(args.data.errorMessage).toMatch(/feature flag/);
  });

  it("returns marked:0 when no QUEUED row matched (F.5 I1: emit-gate signal)", async () => {
    // Used by executeGovernanceModule body to gate emit on retries
    // that arrive after the row is already in a terminal state.
    const updateMany = fakeUpdateMany(0);
    const client = fakeClient({ moduleRun: { updateMany } });
    const result = await markModuleSkippedDisabled(client, "scan-1");
    expect(result).toEqual({ marked: 0 });
  });
});

describe("loadScanContext", () => {
  it("returns protocol address + declared multisigs (string array)", async () => {
    const client = fakeClient({
      scan: {
        findUnique: vi.fn(async () => ({
          id: "scan-1",
          protocol: {
            primaryContractAddress: "0xabc",
            knownMultisigs: ["0x111", "0x222"],
          },
        })) as AnyFn,
      },
    });
    const result = await loadScanContext(client, "scan-1");
    expect(result.protocolAddress).toBe("0xabc");
    expect(result.declaredMultisigAddresses).toEqual(["0x111", "0x222"]);
  });

  it("normalises Prisma Json knownMultisigs to [] when not an array", async () => {
    const client = fakeClient({
      scan: {
        findUnique: vi.fn(async () => ({
          id: "scan-1",
          protocol: {
            primaryContractAddress: "0xabc",
            knownMultisigs: { unexpected: "shape" },
          },
        })) as AnyFn,
      },
    });
    const result = await loadScanContext(client, "scan-1");
    expect(result.declaredMultisigAddresses).toEqual([]);
  });

  it("filters non-string entries from declaredMultisigAddresses", async () => {
    const client = fakeClient({
      scan: {
        findUnique: vi.fn(async () => ({
          id: "scan-1",
          protocol: {
            primaryContractAddress: "0xabc",
            knownMultisigs: ["0x111", 42, null, "0x222"],
          },
        })) as AnyFn,
      },
    });
    const result = await loadScanContext(client, "scan-1");
    expect(result.declaredMultisigAddresses).toEqual(["0x111", "0x222"]);
  });

  it("throws when scan is missing", async () => {
    const client = fakeClient({
      scan: { findUnique: vi.fn(async () => null) as AnyFn },
    });
    await expect(loadScanContext(client, "scan-1")).rejects.toThrow(
      /Scan scan-1 not found/,
    );
  });
});

describe("runDetectors", () => {
  function findingFor(id: string): GovernanceFindingInput {
    return {
      detectorId: id,
      detectorVersion: 1,
      severity: "INFO",
      publicTitle: "t",
      title: "t",
      description: "d",
      evidence: { id },
      affectedComponent: null,
      references: [],
      remediationHint: "h",
      remediationDetailed: "d",
      publicRank: 3,
    };
  }

  it("calls every registered detector when none are disabled", () => {
    const result = runDetectors(baseSnapshot(), () => false);
    expect(result.skippedDetectorIds).toHaveLength(0);
    expect(result.errorDetectorIds).toHaveLength(0);
    // Real detectors may return any number of findings; just assert it ran.
    expect(Array.isArray(result.findings)).toBe(true);
  });

  it("skips disabled detectors via the predicate", () => {
    const disabled = new Set(["GOV-003", "GOV-005"]);
    const result = runDetectors(baseSnapshot(), (id) => disabled.has(id));
    expect(result.skippedDetectorIds).toEqual(["GOV-003", "GOV-005"]);
  });

  it("captures detector-throw errors in errorDetectorIds without aborting (synthetic registry)", () => {
    const throwingDetector: GovernanceDetector = () => {
      throw new Error("synthetic boom");
    };
    const cleanDetector: GovernanceDetector = () => [findingFor("GOV-X")];
    const registry = [
      { id: "GOV-Z", detector: throwingDetector },
      { id: "GOV-X", detector: cleanDetector },
    ];
    const errors: Array<[string, unknown]> = [];

    const result = runDetectors(baseSnapshot(), () => false, {
      registry,
      onDetectorError: (id, err) => errors.push([id, err]),
    });

    expect(result.errorDetectorIds).toEqual(["GOV-Z"]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.detectorId).toBe("GOV-X");
    expect(errors[0]![0]).toBe("GOV-Z");
    expect((errors[0]![1] as Error).message).toMatch(/synthetic/);
  });
});

describe("persistSnapshotAndFindings", () => {
  beforeEach(() => {
    persistGovernanceSnapshotMock.mockReset();
    persistGovernanceSnapshotMock.mockResolvedValue({
      id: "snap-1",
    } as never);
  });

  it("persists snapshot, then findings, against the supplied tx client", async () => {
    const order: string[] = [];
    persistGovernanceSnapshotMock.mockImplementation(async () => {
      order.push("snapshot");
      return { id: "snap-1" } as never;
    });

    const createMany = vi.fn(async () => {
      order.push("findings");
      return { count: 1 };
    });
    const findFirst = vi.fn(async () => ({ id: "mr-1" }));
    const tx = {
      moduleRun: { findFirst },
      finding: { createMany },
    } as never;

    const finding: GovernanceFindingInput = {
      detectorId: "GOV-001",
      detectorVersion: 1,
      severity: "CRITICAL",
      publicTitle: "x",
      title: "y",
      description: "z",
      evidence: { k: "v" },
      affectedComponent: "governor",
      references: ["http://example.com"],
      remediationHint: "h",
      remediationDetailed: "d",
      publicRank: 1,
    };

    const result = await persistSnapshotAndFindings(
      tx,
      "scan-1",
      baseSnapshot(),
      [finding],
    );

    expect(order).toEqual(["snapshot", "findings"]);
    expect(result.findingCount).toBe(1);
    expect(findFirst).toHaveBeenCalledOnce();
    expect(createMany).toHaveBeenCalledOnce();
    // persist-snapshot helper called with the tx client (not top-level prisma).
    const persistArgs = persistGovernanceSnapshotMock.mock.calls[0];
    expect(persistArgs?.[1]).toBe(tx);
  });

  it("skips finding.createMany when findings is empty", async () => {
    const createMany = vi.fn();
    const findFirst = vi.fn(async () => ({ id: "mr-1" }));
    const tx = {
      moduleRun: { findFirst },
      finding: { createMany },
    } as never;

    const result = await persistSnapshotAndFindings(
      tx,
      "scan-1",
      baseSnapshot(),
      [],
    );

    expect(result.findingCount).toBe(0);
    expect(createMany).not.toHaveBeenCalled();
  });

  it("throws when the ModuleRun row is missing", async () => {
    const findFirst = vi.fn(async () => null);
    const tx = {
      moduleRun: { findFirst },
      finding: { createMany: vi.fn() },
    } as never;

    await expect(
      persistSnapshotAndFindings(tx, "scan-1", baseSnapshot(), []),
    ).rejects.toThrow(/ModuleRun not found/);
  });
});

describe("markModuleComplete (compare-and-set on RUNNING)", () => {
  it("finalises COMPLETE when the RUNNING row was updated", async () => {
    const updateMany = fakeUpdateMany(1);
    const client = fakeClient({ moduleRun: { updateMany } });
    const result = await markModuleComplete(
      client,
      "scan-1",
      "COMPLETE",
      null,
      "B",
      80,
    );
    expect(result).toEqual({ finalized: true });

    const args = updateMany.mock.calls[0]![0] as {
      where: { status: string };
      data: {
        status: string;
        errorMessage: string | null;
        grade: string | null;
        score: number | null;
      };
    };
    expect(args.where.status).toBe("RUNNING");
    expect(args.data.status).toBe("COMPLETE");
    expect(args.data.errorMessage).toBeNull();
    expect(args.data.grade).toBe("B");
    expect(args.data.score).toBe(80);
  });

  it("finalises FAILED with errorMessage and null grade/score (F.4.2 Option 1)", async () => {
    const updateMany = fakeUpdateMany(1);
    const client = fakeClient({ moduleRun: { updateMany } });
    await markModuleComplete(
      client,
      "scan-1",
      "FAILED",
      "RPC outage",
      null,
      null,
    );
    const args = updateMany.mock.calls[0]![0] as {
      data: {
        status: string;
        errorMessage: string | null;
        grade: string | null;
        score: number | null;
      };
    };
    expect(args.data.status).toBe("FAILED");
    expect(args.data.errorMessage).toBe("RPC outage");
    expect(args.data.grade).toBeNull();
    expect(args.data.score).toBeNull();
  });

  it("returns finalized:false when no RUNNING row matched (already finalised)", async () => {
    const updateMany = fakeUpdateMany(0);
    const client = fakeClient({ moduleRun: { updateMany } });
    const result = await markModuleComplete(
      client,
      "scan-1",
      "COMPLETE",
      null,
      "A",
      100,
    );
    expect(result).toEqual({ finalized: false });
  });

  it("persists grade + score in the updateMany data block (F.4.2)", async () => {
    const updateMany = fakeUpdateMany(1);
    const client = fakeClient({ moduleRun: { updateMany } });
    await markModuleComplete(client, "scan-42", "COMPLETE", null, "F", 0);
    const args = updateMany.mock.calls[0]![0] as {
      where: { scanId: string };
      data: { grade: string | null; score: number | null };
    };
    expect(args.where.scanId).toBe("scan-42");
    expect(args.data.grade).toBe("F");
    expect(args.data.score).toBe(0);
  });
});

describe("computeModuleExecutionMs (F.5 N1 — module-side clamp)", () => {
  it("returns the elapsed ms when startedAt is in the past", () => {
    const startedAt = Date.now() - 500;
    const result = computeModuleExecutionMs(startedAt);
    expect(result).toBeGreaterThanOrEqual(500);
    expect(result).toBeLessThan(5_000); // generous upper bound for slow CI
  });

  it("clamps to 0 when startedAt equals Date.now()", () => {
    // Same instant on a deterministic clock — Date.now() advances by
    // microseconds between calls but the result should never go
    // negative either way.
    const result = computeModuleExecutionMs(Date.now() + 1);
    expect(result).toBe(0);
  });

  it("clamps to 0 when startedAt is in the future (clock skew, mirrors F.4.1)", () => {
    // Same defensive case the scan-side markComplete clamps for:
    // NTP correction or container migration mid-scan can push
    // startedAt past Date.now() during durable replay.
    const result = computeModuleExecutionMs(Date.now() + 10_000);
    expect(result).toBe(0);
  });
});
