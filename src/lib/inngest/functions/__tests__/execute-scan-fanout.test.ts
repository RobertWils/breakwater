// @vitest-environment node
/**
 * Plan 03 Phase D.4 — fan-out + parallel waitForEvent tests using
 * @inngest/test 0.1.9. These assert the SHAPE of executeScan's
 * per-(module, contractId) dispatch + wait calls — specifically that
 * the BLOCKER 1 fix (the `event` vs `async` distinction in Inngest's
 * if-expression DSL) is encoded correctly in the wait expression.
 *
 * Framework limitation: @inngest/test 0.1.9 returns the FIRST
 * individualExecution's ctx from `t.execute()`, so cross-batch step
 * call accumulation isn't directly observable via `ctx.step.*.mock.calls`.
 * For step calls that happen in the first execution batch (the
 * dispatch-modules step.sendEvent), `t.execute()` + ctx assertions
 * work. For step calls that happen in later batches (the parallel
 * waitForEvent calls), we use `t.executeStep("wait-...-...")` which
 * advances the execution until that specific step is reached and
 * returns the step's `opts` directly (the WaitForEvent op carries
 * its options on the OutgoingOp).
 *
 * Live end-to-end coverage (real Inngest dev server, actual
 * cross-scope event routing, per-Contract timeout firing) lives in
 * Phase H per the plan §1.3 cadence.
 *
 * Note on @inngest/test versioning: 1.0.0 requires inngest@^4.0.0,
 * which is incompatible with our pinned inngest@3.54.2. We use 0.1.9
 * which is the latest 3.x-compatible release.
 */

import { InngestTestEngine } from "@inngest/test";
import { describe, expect, it, vi } from "vitest";

// @inngest/test 0.1.9's `executeStep` advances execution across multiple
// individualExecution batches; each batch may send step results back to
// the Inngest SDK. Without an event key, those internal sends fail with
// "401 Event key not found" before our step mocks are even consulted.
// vi.hoisted runs before any import in this file so the Inngest client
// (whose eventKey is captured at module-load time in client.ts) picks
// up the fake key on instantiation.
vi.hoisted(() => {
  process.env.INNGEST_EVENT_KEY = "test-event-key";
});

vi.mock("@/lib/feature-flags", () => ({
  isGovernanceModuleEnabled: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    moduleRun: { findMany: vi.fn(), updateMany: vi.fn() },
    scan: { findUnique: vi.fn(), updateMany: vi.fn() },
    finding: { findMany: vi.fn() },
  },
}));

// Plan 05 Fase 1.4 — executeScan now runs a detect-and-attach step before the
// fan-out. These tests are about dispatch SHAPE, so stub discovery to a no-op
// (its own behaviour is covered in attach-proxy-implementations.test.ts).
vi.mock("@/lib/discovery/attach-proxy-implementations", () => ({
  discoverAndAttachProxyImplementations: vi
    .fn()
    .mockResolvedValue({ probed: 0, attached: [] }),
}));

import { executeScan } from "../execute-scan";

const SCAN_ID = "scan-fanout-1";

const SCAN_QUEUED_EVENT = {
  name: "scan.queued" as const,
  data: {
    scanId: SCAN_ID,
    protocolId: "protocol-1",
    chain: "ETHEREUM" as const,
    primaryContractAddress: "0xaaaa000000000000000000000000000000000001",
    modulesEnabled: ["GOVERNANCE" as const],
  },
};

function queuedRuns(
  contracts: Array<{ contractId: string; address: string }>,
) {
  return contracts.map((c, i) => ({
    id: `mr-${i}`,
    module: "GOVERNANCE",
    contractId: c.contractId,
    contractAddress: c.address,
  }));
}

/**
 * Helper: build the steps[] array for a multi-Contract scan. Provides
 * a default happy-path mock for every step in the executeScan flow
 * given the supplied contract list.
 */
function happyPathSteps(
  contracts: Array<{ contractId: string; address: string }>,
) {
  const queued = queuedRuns(contracts);
  return [
    { id: "mark-running", handler: () => ({ skipped: false }) },
    { id: "load-queued-module-runs", handler: () => queued },
    ...contracts.map((c) => ({
      id: `wait-GOVERNANCE-${c.contractId}`,
      handler: () => ({
        name: "scan.module.completed",
        data: { scanId: SCAN_ID, module: "GOVERNANCE", contractId: c.contractId },
      }),
    })),
    {
      id: "mark-complete",
      handler: () => ({
        finalStatus: "COMPLETE",
        deferred: false,
        alreadyFinalized: false,
        compositeScore: 100,
        compositeGrade: "A",
        findingsCount: 0,
        executionMs: 0,
        isPartialGrade: false,
      }),
    },
    { id: "emit-scan-completed", handler: () => ({ ids: ["emit-1"] }) },
  ];
}

describe("executeScan fan-out — Plan 03 §4.3 dispatch shape", () => {
  it("dispatches one scan.module.requested event per QUEUED ModuleRun in a single batched step.sendEvent (3 contracts)", async () => {
    const t = new InngestTestEngine({ function: executeScan });
    const contracts = [
      { contractId: "contract-A", address: "0xaaa" },
      { contractId: "contract-B", address: "0xbbb" },
      { contractId: "contract-C", address: "0xccc" },
    ];

    const { ctx } = await t.execute({
      events: [SCAN_QUEUED_EVENT],
      steps: happyPathSteps(contracts),
    });

    // The dispatch-modules step.sendEvent runs in the first execution
    // batch (before the function suspends on waitForEvent), so ctx
    // from t.execute() captures its call args.
    const sendEvent = ctx.step.sendEvent as unknown as {
      mock: { calls: unknown[][] };
    };
    const dispatchCalls = sendEvent.mock.calls.filter(
      (call) => call[0] === "dispatch-modules",
    );
    expect(dispatchCalls).toHaveLength(1);
    const dispatchedEvents = dispatchCalls[0]![1] as Array<{
      name: string;
      data: {
        scanId: string;
        module: string;
        contractId: string;
        contractAddress: string;
      };
    }>;
    expect(dispatchedEvents).toHaveLength(3);
    expect(dispatchedEvents.map((e) => e.data.contractId).sort()).toEqual([
      "contract-A",
      "contract-B",
      "contract-C",
    ]);
    expect(dispatchedEvents[0]!.name).toBe("scan.module.requested");
    expect(dispatchedEvents[0]!.data.scanId).toBe(SCAN_ID);
    expect(dispatchedEvents[0]!.data.module).toBe("GOVERNANCE");
    // contractAddress carried alongside contractId for log readability.
    expect(
      dispatchedEvents.every((e) => typeof e.data.contractAddress === "string"),
    ).toBe(true);
  });

  it("Plan 02 backward compat: single-Contract scan dispatches exactly 1 event with the right contractId", async () => {
    const t = new InngestTestEngine({ function: executeScan });
    const contracts = [{ contractId: "the-only-contract", address: "0xprimary" }];

    const { ctx } = await t.execute({
      events: [SCAN_QUEUED_EVENT],
      steps: happyPathSteps(contracts),
    });

    const sendEvent = ctx.step.sendEvent as unknown as {
      mock: { calls: unknown[][] };
    };
    const dispatchCalls = sendEvent.mock.calls.filter(
      (c) => c[0] === "dispatch-modules",
    );
    expect(dispatchCalls).toHaveLength(1);
    const events = dispatchCalls[0]![1] as Array<{
      data: { contractId: string };
    }>;
    expect(events).toHaveLength(1);
    expect(events[0]!.data.contractId).toBe("the-only-contract");
  });
});

describe("executeScan waitForEvent — BLOCKER 1 if-expression shape (source-level)", () => {
  /*
   * These tests assert the BLOCKER 1 if-expression literal pattern is
   * intact in the executeScan source. Rationale:
   *
   * @inngest/test 0.1.9's `executeStep` advances execution across
   * multiple individualExecution batches; each batch makes a network
   * call to the Inngest server to publish step-execution results. In a
   * unit-test environment with no Inngest dev server (or cloud event
   * key) reachable, those calls 401 — making executeStep-based wait
   * inspections unviable for our setup.
   *
   * Source-level regex assertions are the strongest unit-level
   * guarantee available against BLOCKER 1 regression: if someone
   * reverts the `async.data.contractId` reference back to
   * `event.data.contractId`, this test fails immediately at the
   * source-text level — no Inngest server required.
   *
   * Live end-to-end if-expression matching (the Inngest server's
   * actual cross-scope event evaluator behavior against this
   * expression) is covered by Phase H's preview-environment smoke
   * tests against a real Inngest dev server.
   */

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");

  const SOURCE_PATH = path.resolve(
    __dirname,
    "..",
    "execute-scan.ts",
  );
  const rawSource = fs.readFileSync(SOURCE_PATH, "utf-8");

  // Strip TS line + block comments before pattern-matching so that
  // doc comments explaining the BLOCKER 1 fix (which deliberately
  // reference the wrong-pattern strings to call them out) don't
  // false-positive the anti-pattern absence checks below.
  const source = rawSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("the wait if-expression equates trigger scanId with async scanId (event-vs-async bridge)", () => {
    expect(source).toMatch(/event\.data\.scanId\s*==\s*async\.data\.scanId/);
  });

  it("the wait if-expression narrows on async.data.module (NOT event.data.module — that field doesn't exist on scan.queued)", () => {
    expect(source).toMatch(/async\.data\.module\s*==/);
    // Anti-pattern check: a regression to `event.data.module` would
    // silently fail to match because scan.queued has no `module`
    // field. Lock the absence in (comments stripped above).
    expect(source).not.toMatch(/event\.data\.module/);
  });

  it("the wait if-expression narrows on async.data.contractId (NOT event.data.contractId)", () => {
    expect(source).toMatch(/async\.data\.contractId\s*==/);
    expect(source).not.toMatch(/event\.data\.contractId/);
  });

  it("each waitForEvent step is uniquely named per (module, contractId) — `wait-${mr.module}-${mr.contractId}` pattern", () => {
    // The step-name interpolation pattern in the source. If someone
    // accidentally uses a single shared step name for all contracts,
    // Inngest's retry machinery would cross-resume across siblings.
    expect(source).toMatch(/`wait-\$\{mr\.module\}-\$\{mr\.contractId\}`/);
  });

  it("the wait carries a timeout sourced from getTimeoutPerModuleRunMs (default 5m per spec §4.4; integration tests override via TIMEOUT_PER_MODULE_RUN_MS)", () => {
    // The timeout is computed via formatInngestDuration(getTimeoutPerModuleRunMs())
    // so D.5 integration tests can swap in a short override. The Plan 02
    // hardcoded literal "5m" no longer appears here — the default value
    // lives in config.ts.
    expect(source).toMatch(/timeout:\s*waitTimeout/);
    expect(source).toMatch(/getTimeoutPerModuleRunMs\(\)/);
  });
});

describe("executeScan fan-out — preconditions still hold", () => {
  it("mark-running runs first (Plan 02 C.4 idempotency preserved through fan-out refactor)", async () => {
    const t = new InngestTestEngine({ function: executeScan });
    const contracts = [{ contractId: "contract-A", address: "0xaaa" }];

    const { ctx } = await t.execute({
      events: [SCAN_QUEUED_EVENT],
      steps: happyPathSteps(contracts),
    });

    const stepRun = ctx.step.run as unknown as {
      mock: { calls: unknown[][] };
    };
    const markRunningCalls = stepRun.mock.calls.filter(
      (c) => c[0] === "mark-running",
    );
    expect(markRunningCalls).toHaveLength(1);
  });

  it("no dispatch when the QUEUED set is empty (feature flag off or all rows already terminal)", async () => {
    const t = new InngestTestEngine({ function: executeScan });

    const { ctx } = await t.execute({
      events: [SCAN_QUEUED_EVENT],
      steps: [
        { id: "mark-running", handler: () => ({ skipped: false }) },
        { id: "load-queued-module-runs", handler: () => [] },
        {
          id: "mark-complete",
          handler: () => ({
            finalStatus: "COMPLETE",
            deferred: false,
            alreadyFinalized: false,
            compositeScore: 100,
            compositeGrade: "A",
            findingsCount: 0,
            executionMs: 0,
            isPartialGrade: false,
          }),
        },
        { id: "emit-scan-completed", handler: () => ({ ids: ["emit-1"] }) },
      ],
    });

    const sendEvent = ctx.step.sendEvent as unknown as {
      mock: { calls: unknown[][] };
    };
    const dispatchCalls = sendEvent.mock.calls.filter(
      (c) => c[0] === "dispatch-modules",
    );
    expect(dispatchCalls).toHaveLength(0);
  });
});
