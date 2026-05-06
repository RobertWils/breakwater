import { isGovernanceModuleEnabled } from "@/lib/feature-flags";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";

/**
 * Phase C.1 skeleton for the scan lifecycle dispatcher.
 *
 * Responsibilities (skeleton-level):
 *   1. Mark scan as RUNNING when the worker picks it up.
 *   2. Decide which module dispatches to fan out (governance only for now).
 *   3. Wait for each fan-out's `scan.module.completed` echo, with a hard
 *      timeout that records `errorMessage = "module_timeout"`.
 *   4. Compute a final scan status using a simple rule: every module is
 *      terminal-success (COMPLETE or SKIPPED) → COMPLETE; otherwise FAILED.
 *      Phase F refines this to PARTIAL_COMPLETE for mixed-state scans.
 *   5. Emit `scan.completed` so downstream listeners (analytics, email
 *      triggers) can react.
 *
 * Non-goals here (Phase F):
 *   - Implementing executeGovernanceModule (the consumer of
 *     scan.module.requested). Until that lands, this skeleton always hits
 *     the timeout branch in dev/staging.
 *   - Composite grade calculation.
 *   - PARTIAL_COMPLETE bookkeeping.
 */
export const executeScan = inngest.createFunction(
  {
    id: "execute-scan",
    name: "Execute Scan",
    retries: 3,
  },
  { event: "scan.queued" },
  async ({ event, step }) => {
    const { scanId, modulesEnabled } = event.data;

    // Step 1: Mark scan as RUNNING. executionStartedAt was added in B.2;
    // dispatchedAt is set by the producer (POST /api/scan in C.2).
    await step.run("mark-running", async () =>
      prisma.scan.update({
        where: { id: scanId },
        data: {
          status: "RUNNING",
          executionStartedAt: new Date(),
        },
      }),
    );

    // Step 2: Determine which modules to fan out. The feature flag short-
    // circuits the governance dispatch entirely (audit log will still
    // show the module's persisted ModuleRun row from submitScan).
    const willRunGovernance =
      modulesEnabled.includes("GOVERNANCE") && isGovernanceModuleEnabled();

    // Step 3: Dispatch governance module + wait for completion echo.
    if (willRunGovernance) {
      await step.sendEvent("dispatch-governance", {
        name: "scan.module.requested",
        data: {
          scanId,
          module: "GOVERNANCE",
        },
      });

      const completedEvent = await step.waitForEvent("wait-governance", {
        event: "scan.module.completed",
        match: "data.scanId",
        timeout: "5m",
      });

      if (!completedEvent) {
        // Timeout: mark any non-terminal governance ModuleRun rows as
        // FAILED so the audit trail records why this scan didn't progress.
        // QUEUED rows mean executeGovernanceModule never started; RUNNING
        // means it started but never echoed completion.
        await step.run("mark-governance-timeout", async () =>
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

    // Step 4: Compute final scan status. SKIPPED counts as terminal-success
    // (e.g., FRONTEND on a domain-less scan was deliberately skipped at
    // submitScan time, not failed). Phase F upgrades to PARTIAL_COMPLETE
    // for partial-failure cases.
    await step.run("mark-complete", async () => {
      const scan = await prisma.scan.findUnique({
        where: { id: scanId },
        include: { modules: true },
      });
      if (!scan) {
        throw new Error(
          `[execute-scan] Scan ${scanId} not found in mark-complete step`,
        );
      }

      const allTerminalSuccess = scan.modules.every(
        (m) => m.status === "COMPLETE" || m.status === "SKIPPED",
      );
      const finalStatus = allTerminalSuccess ? "COMPLETE" : "FAILED";

      return prisma.scan.update({
        where: { id: scanId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
        },
      });
    });

    // Step 5: Emit terminal event. compositeGrade and executionMs are
    // skeleton placeholders; Phase F populates them from the per-module
    // results aggregated in Step 4.
    await step.sendEvent("emit-scan-completed", {
      name: "scan.completed",
      data: {
        scanId,
        finalStatus: "COMPLETE",
        compositeGrade: null,
        executionMs: 0,
      },
    });

    return { scanId, status: "completed" };
  },
);
