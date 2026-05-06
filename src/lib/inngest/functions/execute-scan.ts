import type { Prisma, ScanStatus } from "@prisma/client";

import { isGovernanceModuleEnabled } from "@/lib/feature-flags";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";

/**
 * Phase C.1 + C.4 dispatcher orchestrator for the scan lifecycle.
 *
 * Step body logic is extracted into `markRunning` / `markComplete` helpers
 * so it can be unit-tested without spinning up Inngest's test framework
 * (deferred to Phase H per implementation.md). Inngest steps below are
 * thin wrappers that pass the request-time prisma client.
 *
 * Idempotency model (C.4):
 *   - mark-running uses compare-and-set on status='QUEUED'. A retry on the
 *     same scan.queued event finds status='RUNNING' and short-circuits.
 *   - mark-complete uses compare-and-set on status='RUNNING'. A late
 *     module-completed event arriving after a sibling-driven finalisation
 *     finds status terminal and reports `alreadyFinalized: true`.
 *   - mark-complete also defers when modules aren't all terminal yet
 *     (defends the timeout-vs-late-completion race in I3).
 */

type DbClient = {
  scan: {
    updateMany: Prisma.ScanDelegate["updateMany"];
    findUnique: Prisma.ScanDelegate["findUnique"];
  };
  moduleRun: {
    updateMany: Prisma.ModuleRunDelegate["updateMany"];
  };
};

export type MarkRunningResult =
  | { skipped: false }
  | { skipped: true; reason: "scan_not_queued" };

export async function markRunning(
  client: DbClient,
  scanId: string,
): Promise<MarkRunningResult> {
  const updated = await client.scan.updateMany({
    where: { id: scanId, status: "QUEUED" },
    data: { status: "RUNNING", executionStartedAt: new Date() },
  });
  if (updated.count === 0) {
    return { skipped: true, reason: "scan_not_queued" };
  }
  return { skipped: false };
}

export type MarkCompleteResult =
  | { finalStatus: ScanStatus; deferred: false; alreadyFinalized: false }
  | { finalStatus: null; deferred: true; alreadyFinalized: false }
  | { finalStatus: null; deferred: false; alreadyFinalized: true };

export async function markComplete(
  client: DbClient,
  scanId: string,
): Promise<MarkCompleteResult> {
  const scan = await client.scan.findUnique({
    where: { id: scanId },
    include: { modules: true },
  });
  if (!scan) {
    throw new Error(
      `[execute-scan] Scan ${scanId} not found in mark-complete step`,
    );
  }

  const allTerminal = scan.modules.every(
    (m) =>
      m.status === "COMPLETE" ||
      m.status === "FAILED" ||
      m.status === "SKIPPED",
  );
  if (!allTerminal) {
    return { finalStatus: null, deferred: true, alreadyFinalized: false };
  }

  const allTerminalSuccess = scan.modules.every(
    (m) => m.status === "COMPLETE" || m.status === "SKIPPED",
  );
  const finalStatus: ScanStatus = allTerminalSuccess ? "COMPLETE" : "FAILED";

  const updated = await client.scan.updateMany({
    where: { id: scanId, status: "RUNNING" },
    data: { status: finalStatus, completedAt: new Date() },
  });
  if (updated.count === 0) {
    return { finalStatus: null, deferred: false, alreadyFinalized: true };
  }

  return { finalStatus, deferred: false, alreadyFinalized: false };
}

export const executeScan = inngest.createFunction(
  {
    id: "execute-scan",
    name: "Execute Scan",
    retries: 3,
  },
  { event: "scan.queued" },
  async ({ event, step }) => {
    const { scanId, modulesEnabled } = event.data;

    // Step 1: Compare-and-set QUEUED → RUNNING (B2 idempotency).
    const markRunningResult = await step.run("mark-running", () =>
      markRunning(prisma, scanId),
    );
    if (markRunningResult.skipped) {
      return {
        scanId,
        status: "skipped",
        reason: markRunningResult.reason,
      } as const;
    }

    // Step 2: Decide which modules to dispatch.
    const willRunGovernance =
      modulesEnabled.includes("GOVERNANCE") && isGovernanceModuleEnabled();

    // Step 3: Fan out to governance + wait for completion echo.
    if (willRunGovernance) {
      await step.sendEvent("dispatch-governance", {
        name: "scan.module.requested",
        data: { scanId, module: "GOVERNANCE" },
      });

      const completedEvent = await step.waitForEvent("wait-governance", {
        event: "scan.module.completed",
        match: "data.scanId",
        timeout: "5m",
      });

      if (!completedEvent) {
        // Timeout: mark non-terminal governance ModuleRun rows as FAILED.
        // The mark-complete step below tolerates a late completion arriving
        // after this update via its compare-and-set + deferred guards.
        await step.run("mark-governance-timeout", () =>
          prisma.moduleRun.updateMany({
            where: {
              scanId,
              module: "GOVERNANCE",
              status: { in: ["QUEUED", "RUNNING"] },
            },
            data: {
              status: "FAILED",
              errorMessage: "module_timeout",
              completedAt: new Date(),
            },
          }),
        );
      }
    }

    // Step 4: Compute final scan status with race guards (B1 + I3).
    const markCompleteResult = await step.run("mark-complete", () =>
      markComplete(prisma, scanId),
    );

    if (markCompleteResult.deferred) {
      return { scanId, status: "deferred" } as const;
    }
    if (markCompleteResult.alreadyFinalized) {
      return { scanId, status: "already_finalized" } as const;
    }

    // Step 5: Emit terminal event with captured finalStatus (B1).
    // compositeGrade and executionMs are skeleton placeholders; Phase F
    // populates them from the per-module results aggregated upstream.
    await step.sendEvent("emit-scan-completed", {
      name: "scan.completed",
      data: {
        scanId,
        finalStatus: markCompleteResult.finalStatus,
        compositeGrade: null,
        executionMs: 0,
      },
    });

    return {
      scanId,
      status: "completed",
      finalStatus: markCompleteResult.finalStatus,
    } as const;
  },
);
