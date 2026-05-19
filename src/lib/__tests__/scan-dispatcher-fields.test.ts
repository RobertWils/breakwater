// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { Finding, ModuleRun, Scan } from "@prisma/client";

describe("Scan dispatcher tracking fields (Plan 02 B.2)", () => {
  it("Scan.dispatchedAt is nullable DateTime", () => {
    const value: Scan["dispatchedAt"] = null;
    const filled: Scan["dispatchedAt"] = new Date();
    expect(value).toBeNull();
    expect(filled).toBeInstanceOf(Date);
  });

  it("Scan.executionStartedAt is nullable DateTime", () => {
    const value: Scan["executionStartedAt"] = null;
    const filled: Scan["executionStartedAt"] = new Date();
    expect(value).toBeNull();
    expect(filled).toBeInstanceOf(Date);
  });
});

describe("ModuleRun Inngest correlation fields (Plan 02 B.2)", () => {
  it("ModuleRun.inngestEventId is nullable string", () => {
    const value: ModuleRun["inngestEventId"] = null;
    const filled: ModuleRun["inngestEventId"] = "evt_01HXYZ...";
    expect(value).toBeNull();
    expect(typeof filled).toBe("string");
  });

  it("ModuleRun.inngestRunId is nullable string", () => {
    const value: ModuleRun["inngestRunId"] = null;
    const filled: ModuleRun["inngestRunId"] = "run_01HXYZ...";
    expect(value).toBeNull();
    expect(typeof filled).toBe("string");
  });
});

describe("Finding reproducibility field (Plan 02 B.2)", () => {
  it("Finding.snapshotBlockNumber is nullable bigint", () => {
    const value: Finding["snapshotBlockNumber"] = null;
    const filled: Finding["snapshotBlockNumber"] = BigInt(20_000_000);
    expect(value).toBeNull();
    expect(typeof filled).toBe("bigint");
  });
});
