// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  inngest,
  type ScanCompletedEventData,
  type ScanModuleCompletedEventData,
  type ScanModuleRequestedEventData,
  type ScanQueuedEventData,
} from "../client";

describe("inngest client", () => {
  it("exports a usable Inngest instance", () => {
    expect(inngest).toBeDefined();
    expect(typeof inngest.send).toBe("function");
    expect(typeof inngest.createFunction).toBe("function");
  });

  it("has the configured app id", () => {
    const expected = process.env.INNGEST_APP_ID ?? "breakwater";
    expect((inngest as unknown as { id: string }).id).toBe(expected);
  });

  it("event data shapes accept the expected fields", () => {
    const queued: ScanQueuedEventData = {
      scanId: "scan-1",
      protocolId: "proto-1",
      chain: "ETHEREUM",
      primaryContractAddress: "0x0000000000000000000000000000000000000000",
      modulesEnabled: ["GOVERNANCE"],
    };
    const moduleRequested: ScanModuleRequestedEventData = {
      scanId: "scan-1",
      module: "GOVERNANCE",
      // Plan 03 §4.3: contractId + contractAddress are required on
      // both ScanModuleRequested/CompletedEventData so every emitter
      // carries the per-Contract context the compound wait expression
      // needs (Codex Review #3 IMPORTANT 3).
      contractId: "contract-1",
      contractAddress: "0x0000000000000000000000000000000000000000",
    };
    const moduleCompleted: ScanModuleCompletedEventData = {
      scanId: "scan-1",
      module: "GOVERNANCE",
      contractId: "contract-1",
      contractAddress: "0x0000000000000000000000000000000000000000",
      status: "COMPLETE",
      findingsCount: 0,
      grade: "A",
      executionMs: 123,
    };
    const completed: ScanCompletedEventData = {
      scanId: "scan-1",
      finalStatus: "COMPLETE",
      compositeGrade: "A",
      compositeScore: 100,
      findingsCount: 0,
      executionMs: 456,
    };

    expect(queued.scanId).toBe("scan-1");
    expect(moduleRequested.module).toBe("GOVERNANCE");
    expect(moduleCompleted.status).toBe("COMPLETE");
    expect(completed.finalStatus).toBe("COMPLETE");
  });
});
