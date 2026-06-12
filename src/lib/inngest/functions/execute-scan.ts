import type { Grade, Prisma, ScanStatus } from "@prisma/client";

import {
  formatInngestDuration,
  getTimeoutPerModuleRunMs,
} from "@/lib/config";
import { discoverAndAttachProxyImplementations } from "@/lib/discovery/attach-proxy-implementations";
import { isGovernanceModuleEnabled } from "@/lib/feature-flags";
import { inngest } from "@/lib/inngest/client";
import { prisma } from "@/lib/prisma";
import { calculateCompositeGrade } from "@/lib/scoring/composite-grade";
import {
  rollupProtocolComposite,
  type ProtocolRollupContract,
} from "@/lib/scoring/protocol-rollup";

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
  // Phase F.2: per-Contract composite is persisted before the rollup
  // runs. The CAS on Scan.status === RUNNING below is the final guard
  // against double-finalization; per-Contract updates are
  // deterministic over the same inputs, so a retried finalize re-writes
  // identical values to each Contract row.
  contract: {
    update: Prisma.ContractDelegate["update"];
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
      /**
       * Plan 03 §6.2 protocol-level rollup score. Phase F semantics:
       * this carries the `averageContractScore` (arithmetic mean over
       * ELIGIBLE Contracts). Kept under the legacy `compositeScore`
       * field name for backward-compat with the scan.completed event
       * payload and downstream consumers (rename deferred to Phase G's
       * response-shape rewrite). Null when finalStatus !== "COMPLETE".
       */
      compositeScore: number | null;
      /**
       * Plan 03 §6.2 protocol-level rollup grade — worst-grade-wins
       * across ELIGIBLE Contracts. Null when finalStatus !== "COMPLETE".
       */
      compositeGrade: Grade | null;
      /** Total findings persisted for the scan. */
      findingsCount: number;
      /** Wall-clock ms from executionStartedAt → now. 0 if executionStartedAt missing. */
      executionMs: number;
      /** True when any Contract has its own isPartialGrade flag set (Plan 02 detector-error carry-over, aggregated across Contracts per §6.3). */
      isPartialGrade: boolean;
    }
  | { finalStatus: null; deferred: true; alreadyFinalized: false }
  | { finalStatus: null; deferred: false; alreadyFinalized: true };

/**
 * Derive a Contract's status from its ModuleRuns (Phase F.2). Preserves
 * Plan 02's H.9 BLOCKER Layer C strict semantic — any FAILED ModuleRun
 * within a Contract poisons that Contract — so the per-Contract gate
 * mirrors the scan-level gate Plan 02 used. In practice Plan 03's
 * dispatcher only runs GOVERNANCE per Contract (other modules seeded
 * SKIPPED at submission), so mixed FAILED+COMPLETE within one Contract
 * is contrived; the gate is defensive against future module additions.
 *
 *   - FAILED: any ModuleRun ended FAILED. Excluded from the protocol
 *     composite via `compositeGrade=null`; surfaced separately via
 *     `isPartialCoverage` when sibling Contracts contributed grades.
 *   - SKIPPED: every ModuleRun ended SKIPPED, or no ModuleRuns exist
 *     (e.g., a Contract whose role has no applicable module under §4.2's
 *     role-applicability table). No grade contributor by design.
 *   - COMPLETE: no FAILED ModuleRuns, at least one COMPLETE. The
 *     Contract yields a grade from its findings.
 */
export function deriveContractStatus(
  moduleRuns: ReadonlyArray<{ status: string }>,
): "COMPLETE" | "FAILED" | "SKIPPED" {
  if (moduleRuns.length === 0) return "SKIPPED";
  if (moduleRuns.some((m) => m.status === "FAILED")) return "FAILED";
  if (moduleRuns.some((m) => m.status === "COMPLETE")) return "COMPLETE";
  return "SKIPPED";
}

export async function markComplete(
  client: DbClient,
  scanId: string,
): Promise<MarkCompleteResult> {
  // Phase F.2: load Contracts with their ModuleRuns + findings so the
  // per-Contract composite can be computed without a second round-trip.
  // `modules` (the scan-wide ModuleRun relation) is kept on the load
  // for the allTerminal gate — it's the same set of rows as
  // `contracts.flatMap(c => c.moduleRuns)` but pre-flattened for the
  // every() check.
  const scan = await client.scan.findUnique({
    where: { id: scanId },
    include: {
      modules: true,
      contracts: {
        include: {
          moduleRuns: {
            select: { id: true, status: true, errorDetectorCount: true },
          },
          findings: { select: { severity: true } },
        },
      },
    },
  });
  if (!scan) {
    throw new Error(
      `[execute-scan] Scan ${scanId} not found in mark-complete step`,
    );
  }

  // Plan 03 §4.5 step 2: defer until every ModuleRun across every
  // Contract is terminal. The race-guard semantic from Plan 02 I.3
  // carries over unchanged.
  const allTerminal = scan.modules.every(
    (m) =>
      m.status === "COMPLETE" ||
      m.status === "FAILED" ||
      m.status === "SKIPPED",
  );
  if (!allTerminal) {
    return { finalStatus: null, deferred: true, alreadyFinalized: false };
  }

  // Plan 03 §6.1 + §4.5 step 5: per-Contract composite. For each
  // Contract derive its status from its ModuleRuns, compute the
  // Plan 02 §5.3 composite from its findings when COMPLETE, and
  // capture per-Contract isPartialGrade (Plan 02 I.1 FIX 3 semantic,
  // scoped per-Contract).
  const perContract = scan.contracts.map((c) => {
    const status = deriveContractStatus(c.moduleRuns);
    let compositeScore: number | null = null;
    let compositeGrade: Grade | null = null;
    if (status === "COMPLETE") {
      const result = calculateCompositeGrade(c.findings);
      compositeScore = result.score;
      compositeGrade = result.grade;
    }
    // Per-Contract isPartialGrade: at least one of this Contract's
    // COMPLETE ModuleRuns had errorDetectorCount > 0.
    const isPartialGrade = c.moduleRuns.some(
      (m) => m.status === "COMPLETE" && (m.errorDetectorCount ?? 0) > 0,
    );
    return {
      id: c.id,
      // Plan 05 Fase 1.2: address + isPrimary feed the reachability-aware
      // rollup (the KNOWN_INFRA hook + the reachability root).
      address: c.address,
      isPrimary: c.isPrimary,
      status,
      compositeScore,
      compositeGrade,
      isPartialGrade,
    };
  });

  // Persist per-Contract grades. These are deterministic over the
  // same ModuleRuns + findings, so a retried finalize that races
  // against the scan-level CAS below is safe — both attempts write
  // identical values. Per-Contract failure (e.g., one Contract row
  // missing) would surface as an error and bubble up; Inngest's
  // retry contract on step.run handles the redo.
  await Promise.all(
    perContract.map((c) =>
      client.contract.update({
        where: { id: c.id },
        data: {
          compositeScore: c.compositeScore,
          compositeGrade: c.compositeGrade,
          isPartialGrade: c.isPartialGrade,
        },
      }),
    ),
  );

  // Plan 03 §6.2: roll up per-Contract composites into the protocol
  // composite. The pure function in `protocol-rollup.ts` handles the
  // worst-grade-wins logic, tie-breaking, partial flags, and the
  // zero-graded-Contracts guard (§6.2 extension of Plan 02 H.9
  // BLOCKER Layer C from executor to graph layer).
  const rollupContracts: ProtocolRollupContract[] = perContract.map((c) => ({
    id: c.id,
    address: c.address,
    isPrimary: c.isPrimary,
    compositeScore: c.compositeScore,
    compositeGrade: c.compositeGrade,
    isPartialGrade: c.isPartialGrade,
    status: c.status,
  }));
  // No edges passed ⇒ the rollup synthesises the star (no persisted
  // ContractEdge rows exist at finalisation in Fase 1.2). Bit-identical to
  // the prior flat fold; Fase 2 will pass real discovered edges.
  const rollup = rollupProtocolComposite(rollupContracts);

  // Plan 03 §6.2 zero-graded-Contracts guard → FAILED. When at least
  // one Contract contributed a grade → COMPLETE (with isPartialCoverage
  // surfacing any FAILED siblings).
  const finalStatus: ScanStatus =
    rollup.compositeGrade !== null ? "COMPLETE" : "FAILED";

  const findingsCount =
    finalStatus === "COMPLETE"
      ? scan.contracts.reduce((acc, c) => acc + c.findings.length, 0)
      : 0;

  const completedAt = new Date();
  const updated = await client.scan.updateMany({
    where: { id: scanId, status: "RUNNING" },
    data: {
      status: finalStatus,
      completedAt,
      compositeGrade: rollup.compositeGrade,
      averageContractScore: rollup.averageContractScore,
      worstContractScore: rollup.worstContractScore,
      isPartialGrade: rollup.isPartialGrade,
      isPartialCoverage: rollup.isPartialCoverage,
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
    // Backward-compat name: the result field stays `compositeScore`
    // (consumed by the scan.completed event payload + the function
    // return value); semantically it now carries `averageContractScore`.
    // Phase G's response-shape rewrite renames this on the wire.
    compositeScore: rollup.averageContractScore,
    compositeGrade: rollup.compositeGrade,
    findingsCount,
    executionMs,
    isPartialGrade: rollup.isPartialGrade,
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

    // Step 1.5 (Plan 05 Fase 1.4): detect-and-attach proxy implementations
    // BEFORE the fan-out, so a discovered implementation is scanned in THIS
    // scan, not the next (the timing bug we design out, not debug later). It
    // adds the impl as a flat sibling Contract (+ a QUEUED GOVERNANCE
    // ModuleRun) that the load-queued step below then picks up.
    //
    // Guarded (degraded-fallback): a hard failure marks the scan
    // `discoveryDegraded` and continues on the manual contracts + existing
    // detectors — one failing discovery must not sink a whole scan. The attach
    // is idempotent, so an Inngest retry of the step never double-attaches.
    try {
      await step.run("discover-attach-proxy-implementations", () =>
        discoverAndAttachProxyImplementations(prisma, { scanId, modulesEnabled }),
      );
    } catch {
      await step.run("mark-discovery-degraded", () =>
        prisma.scan.updateMany({
          where: { id: scanId },
          data: { discoveryDegraded: true },
        }),
      );
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
      // Plan 03 §4.4 default is 5 minutes; the TIMEOUT_PER_MODULE_RUN_MS
      // env var lets integration tests override to a short value (e.g.,
      // 10s) so per-Contract timeout isolation can be runtime-verified
      // within a vitest wall-time budget.
      const waitTimeout = formatInngestDuration(getTimeoutPerModuleRunMs());
      const waitResults = await Promise.all(
        queuedRuns.map((mr) =>
          step.waitForEvent(`wait-${mr.module}-${mr.contractId}`, {
            event: "scan.module.completed",
            if: `event.data.scanId == async.data.scanId && async.data.module == '${mr.module}' && async.data.contractId == '${mr.contractId}'`,
            timeout: waitTimeout,
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
