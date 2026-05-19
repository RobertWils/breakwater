// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "../logging";

describe("log()", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi
      .spyOn(console, "log")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  function lastLogged(): Record<string, unknown> {
    expect(consoleLogSpy).toHaveBeenCalled();
    const args = consoleLogSpy.mock.calls.at(-1) as unknown[] | undefined;
    if (!args) throw new Error("expected at least one console.log call");
    return JSON.parse(args[0] as string) as Record<string, unknown>;
  }

  it("logs scan.submitted with correct shape and enriched fields", () => {
    log({
      event: "scan.submitted",
      scanId: "abc-123",
      chain: "ETHEREUM",
      modulesEnabled: ["GOVERNANCE"],
    });

    expect(consoleLogSpy).toHaveBeenCalledOnce();
    const logged = lastLogged();
    expect(logged).toMatchObject({
      event: "scan.submitted",
      scanId: "abc-123",
      chain: "ETHEREUM",
      modulesEnabled: ["GOVERNANCE"],
      service: "breakwater",
    });
    expect(logged.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("logs scan.dispatched with optional inngestEventId", () => {
    log({
      event: "scan.dispatched",
      scanId: "abc-123",
      inngestEventId: "evt-456",
    });
    const logged = lastLogged();
    expect(logged).toMatchObject({
      event: "scan.dispatched",
      scanId: "abc-123",
      inngestEventId: "evt-456",
    });
  });

  it("logs scan.dispatched without inngestEventId — field is omitted", () => {
    log({ event: "scan.dispatched", scanId: "abc-123" });
    const logged = lastLogged();
    expect(logged.event).toBe("scan.dispatched");
    expect(logged.scanId).toBe("abc-123");
    expect("inngestEventId" in logged).toBe(false);
  });

  it("logs scan.module.started", () => {
    log({
      event: "scan.module.started",
      scanId: "abc-123",
      module: "GOVERNANCE",
    });
    const logged = lastLogged();
    expect(logged).toMatchObject({
      event: "scan.module.started",
      module: "GOVERNANCE",
    });
  });

  it("logs scan.module.completed with grade null and execution time", () => {
    log({
      event: "scan.module.completed",
      scanId: "abc-123",
      module: "GOVERNANCE",
      grade: null,
      executionMs: 1234,
    });
    const logged = lastLogged();
    expect(logged.grade).toBeNull();
    expect(logged.executionMs).toBe(1234);
  });

  it("logs scan.completed with composite grade and total ms", () => {
    log({
      event: "scan.completed",
      scanId: "abc-123",
      compositeGrade: "B",
      totalExecutionMs: 5000,
    });
    const logged = lastLogged();
    expect(logged.event).toBe("scan.completed");
    expect(logged.compositeGrade).toBe("B");
    expect(logged.totalExecutionMs).toBe(5000);
  });

  it("logs scan.failed with errorCode", () => {
    log({
      event: "scan.failed",
      scanId: "abc-123",
      module: "GOVERNANCE",
      errorCode: "rpc_timeout",
    });
    const logged = lastLogged();
    expect(logged.event).toBe("scan.failed");
    expect(logged.errorCode).toBe("rpc_timeout");
  });

  it("logs detector.fired with detectorId and severity", () => {
    log({
      event: "detector.fired",
      scanId: "abc-123",
      detectorId: "GOV-001",
      severity: "HIGH",
    });
    const logged = lastLogged();
    expect(logged.event).toBe("detector.fired");
    expect(logged.detectorId).toBe("GOV-001");
    expect(logged.severity).toBe("HIGH");
  });
});
