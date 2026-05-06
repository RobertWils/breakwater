// @vitest-environment node
import { describe, expect, it } from "vitest";

import { executeScan } from "../execute-scan";

describe("executeScan function (Plan 02 C.1 skeleton)", () => {
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
    // Inngest's public Options type Omits `triggers` (its CreateFunction
    // overloads accept `trigger | trigger[]` separately and merge). At
    // runtime the merged array lives on opts; cast to read it.
    const opts = executeScan.opts as { triggers?: Array<{ event?: string }> };
    expect(opts.triggers).toBeDefined();
    expect(opts.triggers).toHaveLength(1);
    expect(opts.triggers?.[0]).toMatchObject({ event: "scan.queued" });
  });
});
