import type { Grade, Prisma, ScanStatus } from "@prisma/client";

import { isGovernanceModuleEnabled } from "@/lib/feature-flags";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { calculateCompositeGrade } from "@/lib/scoring/composite-grade";

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
  finding: {
    findMany: Prisma.FindingDelegate["findMany"];
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
  | {
      finalStatus: ScanStatus;
      deferred: false;
      alreadyFinalized: false;
      /** Composite score 0–100. Null when finalStatus !== "COMPLETE" (F.3 Option 1). */
      compositeScore: number | null;
      /** Letter grade. Null when finalStatus !== "COMPLETE" (F.3 Option 1). */
      compositeGrade: Grade | null;
      /** Total findings persisted for the scan. */
      findingsCount: number;
      /** Wall-clock ms from executionStartedAt → now. 0 if executionStartedAt missing. */
      executionMs: number;
      /** True when any COMPLETE module had detector errors (I.1 FIX 3). */
      isPartialGrade: boolean;
    }
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
  // H.9 BLOCKER Layer C: require at least one module that actually ran
  // (status COMPLETE) for a finalStatus of COMPLETE. Pre-H.9, a scan
  // with every ModuleRun seeded SKIPPED ("0 runnable") would be
  // classified COMPLETE here because vacuous-true + SKIPPED-counts-as-
  // success → finalStatus=COMPLETE → composite grade A surfaced for
  // a scan where no detector actually ran. Layer A (schema) + Layer B
  // (submission) should already prevent this from reaching the
  // executor, but markComplete is the last line of defense; keeping
  // this check makes the executor robust to any future seeding path
  // that bypasses the submission-layer gate.
  const hasAnyCompleteModule = scan.modules.some(
    (m) => m.status === "COMPLETE",
  );
  const finalStatus: ScanStatus =
    allTerminalSuccess && hasAnyCompleteModule ? "COMPLETE" : "FAILED";

  // F.3: only compute composite grade on COMPLETE scans. FAILED scans
  // persist null score/grade — partial findings on a failed scan don't
  // represent a meaningful protocol assessment.
  let compositeScore: number | null = null;
  let compositeGrade: Grade | null = null;
  let findingsCount = 0;

  if (finalStatus === "COMPLETE") {
    const findings = await client.finding.findMany({
      where: { scanId },
      select: { severity: true },
    });
    findingsCount = findings.length;
    const result = calculateCompositeGrade(findings);
    compositeScore = result.score;
    compositeGrade = result.grade;
  }

  // I.1 FIX 3: isPartialGrade fires when a COMPLETE module had one
  // or more detectors throw. A degraded coverage signal — distinct
  // from a clean COMPLETE (all detectors ran) and from a FAILED
  // scan (no useful grade at all). Product decision: NOT triggered
  // by `module_not_implemented` SKIPPED rows — those are Plan 02
  // scope (single-module by design), not coverage degradation, and
  // are surfaced separately via the per-module SKIPPED card.
  // FAILED modules also don't count: those represent module-level
  // failure, not partial coverage.
  const isPartialGrade = scan.modules.some(
    (m) => m.status === "COMPLETE" && (m.errorDetectorCount ?? 0) > 0,
  );

  const completedAt = new Date();
  const updated = await client.scan.updateMany({
    where: { id: scanId, status: "RUNNING" },
    data: {
      status: finalStatus,
      completedAt,
      // Plan 03 §3.5 PR 1: column renamed from `compositeScore`. Phase F
      // restructures markComplete to compute the worst-grade-wins protocol
      // composite + populate `worstContractScore`; in PR 1 / Phase A this
      // still writes the legacy single-contract score (now persisted as the
      // average across a 1-Contract graph) so the Plan 02 behavior is
      // preserved while the column rename lands.
      averageContractScore: compositeScore,
      compositeGrade,
      isPartialGrade,
    },
  });
  if (updated.count === 0) {
    return { finalStatus: null, deferred: false, alreadyFinalized: true };
  }

  // Clamp to non-negative: clock skew between executionStartedAt and
  // completedAt (NTP correction, container migration) could otherwise
  // emit a negative duration on scan.completed.
  const executionMs = scan.executionStartedAt
    ? Math.max(0, completedAt.getTime() - scan.executionStartedAt.getTime())
    : 0;

  return {
    finalStatus,
    deferred: false,
    alreadyFinalized: false,
    compositeScore,
    compositeGrade,
    findingsCount,
    executionMs,
    isPartialGrade,
  };
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

    // Step 2: Decide whether the governance module dispatches at all.
    // Plan 02's `willRunGovernance` flag carries over — the feature
    // flag short-circuit still applies to the whole scan.
    const willRunGovernance =
      modulesEnabled.includes("GOVERNANCE") && isGovernanceModuleEnabled();

    // Step 3: Plan 03 §4.3 — load the QUEUED ModuleRun rows for this
    // scan + fan out one scan.module.requested per (Contract, module)
    // pair in a single batched step.sendEvent.
    //
    // Phase B's submitScan creates one ModuleRun per (Contract,
    // ModuleName) pair (N×M rows per scan) with status QUEUED when
    // implemented + role-applicable. Phase D dispatches each of those
    // QUEUED rows as its own event so the per-Contract execution
    // model can drive each independently. The legacy
    // @@unique([scanId, module]) was dropped in PR 1's
    // `plan_03_drop_modulerun_legacy_unique` migration to permit this.
    //
    // The willRunGovernance flag still applies: when governance is
    // disabled by the feature flag, no GOVERNANCE events are
    // dispatched even if QUEUED rows exist (the flag is the kill
    // switch). Phase D ships M=1 (GOVERNANCE only) so this gate
    // effectively governs the whole fan-out.
    const queuedRuns = willRunGovernance
      ? await step.run("load-queued-module-runs", async () => {
          const rows = await prisma.moduleRun.findMany({
            where: { scanId, status: "QUEUED", module: "GOVERNANCE" },
            include: { contract: { select: { id: true, address: true } } },
          });
          return rows.map((r) => ({
            id: r.id,
            module: r.module,
            contractId: r.contractId,
            contractAddress: r.contract?.address ?? null,
          }));
        })
      : [];

    if (queuedRuns.length > 0) {
      // Spec §4.3 step 2: a single batched step.sendEvent for all
      // (Contract, module) pairs — one durable step, not N. Inngest
      // accepts an array on the send call.
      await step.sendEvent(
        "dispatch-modules",
        queuedRuns.map((mr) => ({
          name: "scan.module.requested" as const,
          data: {
            scanId,
            module: mr.module,
            // Phase B always populates `contractId` on new rows; the
            // load step above filters to status: "QUEUED" which only
            // matches Plan-03-era rows (legacy historical rows are
            // already in a terminal state). The non-null assertion is
            // safe by construction.
            contractId: mr.contractId!,
            contractAddress: mr.contractAddress!,
          },
        })),
      );

      // Spec §4.3 step 3 — parallel wait via Promise.all over per-
      // (module, contractId) waitForEvent calls. Inngest 3.x treats
      // each step.waitForEvent as its own durable step; wrapping them
      // in Promise.all is the idiomatic concurrent-wait pattern (same
      // shape used for parallel step.run calls). Each wait has an
      // independent 5-minute timeout that runs concurrently with the
      // others, so the scan-level wall-time cap is ~5 minutes
      // regardless of how many Contracts dispatched.
      //
      // BLOCKER 1 fix — `event` vs `async` binding distinction in
      // Inngest's if-expression DSL (spec §4.3):
      //   - `event` references the original `scan.queued` event that
      //     triggered this function. It carries scanId but NOT module
      //     or contractId.
      //   - `async` references the incoming `scan.module.completed`
      //     event being matched. It carries all three fields.
      // The equality `event.data.scanId == async.data.scanId` scopes
      // the waiter to this scan; the literal module + contractId
      // comparisons against async.data narrow to the specific
      // (Contract, module) row. Referencing `event.data.module` or
      // `event.data.contractId` here would silently fail to ever
      // match — those fields don't exist on the trigger event. This
      // is the load-bearing factual claim about Inngest 3.x that
      // Phase D.4's cross-scope isolation tests guard against
      // regression.
      //
      // Each waitForEvent step is uniquely named per (module,
      // contractId) so retries don't cross-resume across siblings.
      const waitResults = await Promise.all(
        queuedRuns.map((mr) =>
          step.waitForEvent(`wait-${mr.module}-${mr.contractId}`, {
            event: "scan.module.completed",
            if: `event.data.scanId == async.data.scanId && async.data.module == '${mr.module}' && async.data.contractId == '${mr.contractId}'`,
            timeout: "5m",
          }),
        ),
      );

      // Spec §4.4 — for any wait that timed out (waitForEvent returns
      // null on timeout), mark the corresponding ModuleRun as FAILED
      // with errorMessage "module_timeout". The status filter
      // (where: { status: { in: ["QUEUED", "RUNNING"] } }) is the
      // race-safety mechanism per spec §4.3 orphan-event handling: if
      // a delayed completion event already wrote the row to
      // COMPLETE/FAILED between this Promise.all settling and the
      // updateMany executing, the where-clause matches zero rows and
      // the timeout step becomes a harmless no-op.
      //
      // The inner Promise.all parallelises the per-row updateManys but
      // is itself wrapped in a single step.run — Inngest only
      // serialises one step boundary here, not N, keeping the step
      // count predictable.
      const timedOut = queuedRuns.filter((_, i) => waitResults[i] === null);
      if (timedOut.length > 0) {
        await step.run("mark-module-timeout", () =>
          Promise.all(
            timedOut.map((mr) =>
              prisma.moduleRun.updateMany({
                where: {
                  scanId,
                  module: mr.module,
                  contractId: mr.contractId,
                  status: { in: ["QUEUED", "RUNNING"] },
                },
                data: {
                  status: "FAILED",
                  errorMessage: "module_timeout",
                  completedAt: new Date(),
                },
              }),
            ),
          ),
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

    // Step 5: Emit terminal event with captured finalStatus + grade (B1 + F.3).
    await step.sendEvent("emit-scan-completed", {
      name: "scan.completed",
      data: {
        scanId,
        finalStatus: markCompleteResult.finalStatus,
        compositeGrade: markCompleteResult.compositeGrade,
        compositeScore: markCompleteResult.compositeScore,
        findingsCount: markCompleteResult.findingsCount,
        executionMs: markCompleteResult.executionMs,
      },
    });

    return {
      scanId,
      status: "completed",
      finalStatus: markCompleteResult.finalStatus,
      compositeGrade: markCompleteResult.compositeGrade,
      compositeScore: markCompleteResult.compositeScore,
    } as const;
  },
);
