import type {
  Grade,
  GovernanceSnapshot,
  ModuleStatus,
  Prisma,
} from "@prisma/client";

import {
  GOVERNANCE_DETECTORS,
  type DetectorRegistry,
} from "@/lib/detectors/governance/registry";
import { captureGovernanceSnapshot } from "@/lib/detectors/governance/capture-snapshot";
import { persistGovernanceSnapshot } from "@/lib/detectors/governance/persist-snapshot";
import type {
  GovernanceFindingInput,
  GovernanceSnapshotData,
} from "@/lib/detectors/governance/types";
import {
  isDetectorDisabled,
  isGovernanceModuleEnabled,
} from "@/lib/feature-flags";
import { inngest } from "@/lib/inngest/client";
import { log } from "@/lib/logging";
import { prisma } from "@/lib/prisma";
import { calculateCompositeGrade } from "@/lib/scoring/composite-grade";

/**
 * Phase F.1 governance module orchestrator.
 *
 * Listens for `scan.module.requested` events filtered on
 * `event.data.module == "GOVERNANCE"` (Inngest-side filter; we don't
 * re-check in the handler). Lifecycle steps are extracted into pure
 * helpers below so they can be unit-tested without spinning up
 * Inngest's full executor (deferred to Phase H per implementation.md).
 *
 * Idempotency model:
 *   - mark-running compare-and-sets on status='QUEUED' → 'RUNNING'.
 *     A duplicate event for an already-running scan short-circuits.
 *   - mark-complete compare-and-sets on status='RUNNING' → terminal.
 *     A retry that lands after a successful previous run is a no-op.
 *
 * Defensive: individual detector exceptions log + continue (partial
 * results beat no results). Module-level errors (snapshot capture,
 * persistence) mark FAILED with errorMessage capture so the audit
 * trail records the cause.
 */

type AnyPrismaClient = typeof prisma | Prisma.TransactionClient;

export interface MarkModuleRunningResult {
  skipped: boolean;
}

/**
 * Compare-and-set ModuleRun.status QUEUED → RUNNING. Returns
 * `skipped: true` when zero rows matched (concurrent processing,
 * retry after completion, or missing ModuleRun row).
 */
export async function markModuleRunning(
  client: AnyPrismaClient,
  scanId: string,
  inngestEventId: string | undefined,
): Promise<MarkModuleRunningResult> {
  const updated = await client.moduleRun.updateMany({
    where: {
      scanId,
      module: "GOVERNANCE",
      status: "QUEUED",
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
      inngestEventId: inngestEventId ?? null,
      inngestRunId: inngestEventId ?? null,
    },
  });
  return { skipped: updated.count === 0 };
}

export interface MarkModuleSkippedDisabledResult {
  marked: number;
}

/**
 * Mark the QUEUED ModuleRun row as SKIPPED with the feature-flag
 * reason. Used when `isGovernanceModuleEnabled()` returns false.
 */
export async function markModuleSkippedDisabled(
  client: AnyPrismaClient,
  scanId: string,
): Promise<MarkModuleSkippedDisabledResult> {
  const updated = await client.moduleRun.updateMany({
    where: {
      scanId,
      module: "GOVERNANCE",
      status: "QUEUED",
    },
    data: {
      status: "SKIPPED",
      completedAt: new Date(),
      errorMessage: "Governance module disabled via feature flag",
    },
  });
  return { marked: updated.count };
}

export interface ScanContext {
  protocolAddress: string;
  declaredMultisigAddresses: string[];
}

/**
 * Load the scan row + protocol info needed for snapshot capture.
 * Throws when the scan or its protocol relation is missing — the
 * orchestrator turns that into a FAILED ModuleRun with the error
 * message in the audit trail.
 *
 * `Protocol.knownMultisigs` is a Json column. We accept either an
 * array of strings (the documented shape) or an empty/missing value
 * (falls back to `[]`); anything else gets filtered to strings only
 * so a malformed JSON payload can't poison `detectSafe()` downstream.
 */
export async function loadScanContext(
  client: AnyPrismaClient,
  scanId: string,
): Promise<ScanContext> {
  const scan = await client.scan.findUnique({
    where: { id: scanId },
    select: {
      id: true,
      protocol: {
        select: {
          primaryContractAddress: true,
          knownMultisigs: true,
        },
      },
    },
  });

  if (!scan || !scan.protocol) {
    throw new Error(
      `[execute-governance-module] Scan ${scanId} not found or missing protocol`,
    );
  }

  const raw = scan.protocol.knownMultisigs as unknown;
  const declaredMultisigAddresses: string[] = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === "string")
    : [];

  return {
    protocolAddress: scan.protocol.primaryContractAddress,
    declaredMultisigAddresses,
  };
}

export interface DetectorRunResult {
  findings: GovernanceFindingInput[];
  skippedDetectorIds: string[];
  errorDetectorIds: string[];
}

/**
 * Run all registered governance detectors against `snapshot`.
 *
 * Detectors are called in registry order. Disabled detectors (per the
 * caller-supplied `isDisabled` predicate, normally bound to
 * `isDetectorDisabled` from feature-flags) are skipped. Detectors that
 * throw are caught + recorded in `errorDetectorIds` so the module can
 * surface them later without aborting the whole run.
 */
export function runDetectors(
  snapshot: GovernanceSnapshotData,
  isDisabled: (detectorId: string) => boolean,
  options?: {
    onDetectorError?: (id: string, err: unknown) => void;
    registry?: DetectorRegistry;
  },
): DetectorRunResult {
  const findings: GovernanceFindingInput[] = [];
  const skippedDetectorIds: string[] = [];
  const errorDetectorIds: string[] = [];

  const registry = options?.registry ?? GOVERNANCE_DETECTORS;
  for (const { id, detector } of registry) {
    if (isDisabled(id)) {
      skippedDetectorIds.push(id);
      continue;
    }

    try {
      findings.push(...detector(snapshot));
    } catch (err) {
      errorDetectorIds.push(id);
      options?.onDetectorError?.(id, err);
    }
  }

  return { findings, skippedDetectorIds, errorDetectorIds };
}

export interface PersistResult {
  snapshot: GovernanceSnapshot;
  findingCount: number;
}

/**
 * Persist the snapshot + findings atomically within a single
 * transaction. The Finding rows are linked to the existing ModuleRun
 * row for this scan + module (looked up inside the same tx so a
 * concurrent retry can't observe a stale id).
 *
 * I.1 FIX 1 (BLOCKER, spec §4.6 idempotency contract):
 * delete-then-insert for findings. Without the delete step,
 * `finding.createMany` is NOT idempotent — an Inngest step replay
 * after a committed transaction but before the durable checkpoint
 * would double-insert. The snapshot upsert via `persistGovernanceSnapshot`
 * is already idempotent (Prisma upsert keyed on scanId). The
 * deleteMany scope (scanId + module=GOVERNANCE) is safe because the
 * ModuleRun unique constraint (`@@unique([scanId, module])` on
 * schema L249) guarantees at most one GOVERNANCE ModuleRun per scan.
 *
 * I.1 FIX 2: persist ModuleRun.findingsCount in the same transaction.
 * The field is in the schema + ModuleRunResponse + event payload but
 * was never written. Doing it here (where findings.length is known
 * and we already hold the moduleRun.id) keeps the writes atomic
 * with the Finding rows themselves — a replay that re-runs this tx
 * lands a consistent findingsCount that matches the new Finding rows.
 */
export async function persistSnapshotAndFindings(
  tx: Prisma.TransactionClient,
  scanId: string,
  snapshot: GovernanceSnapshotData,
  findings: GovernanceFindingInput[],
): Promise<PersistResult> {
  const persistedSnapshot = await persistGovernanceSnapshot(
    { scanId, snapshot },
    tx,
  );

  const moduleRun = await tx.moduleRun.findFirst({
    where: { scanId, module: "GOVERNANCE" },
    select: { id: true },
  });
  if (!moduleRun) {
    throw new Error(
      `[execute-governance-module] ModuleRun not found for scan ${scanId} during finding persistence`,
    );
  }

  // I.1 FIX 1: idempotent delete-then-insert. The delete fires
  // unconditionally — even when `findings.length === 0` — so a replay
  // that observes a prior partial commit's findings is cleared first.
  await tx.finding.deleteMany({
    where: { scanId, module: "GOVERNANCE" },
  });

  if (findings.length > 0) {
    await tx.finding.createMany({
      data: findings.map((f) => ({
        scanId,
        moduleRunId: moduleRun.id,
        module: "GOVERNANCE" as const,
        detectorId: f.detectorId,
        detectorVersion: f.detectorVersion,
        severity: f.severity,
        publicTitle: f.publicTitle,
        title: f.title,
        description: f.description,
        evidence: f.evidence as Prisma.InputJsonValue,
        affectedComponent: f.affectedComponent ?? "",
        references: f.references as unknown as Prisma.InputJsonValue,
        remediationHint: f.remediationHint,
        remediationDetailed: f.remediationDetailed,
        publicRank: f.publicRank,
        snapshotBlockNumber: snapshot.blockNumber,
      })),
    });
  }

  // I.1 FIX 2: write findingsCount in the same tx as the Finding
  // rows. Atomic with delete-then-insert above so a replayed tx
  // ends with consistent (findingsCount, actual rows) state.
  await tx.moduleRun.update({
    where: { id: moduleRun.id },
    data: { findingsCount: findings.length },
  });

  return { snapshot: persistedSnapshot, findingCount: findings.length };
}

export type TerminalModuleStatus = Extract<
  ModuleStatus,
  "COMPLETE" | "FAILED"
>;

export interface MarkModuleCompleteResult {
  finalized: boolean;
}

/**
 * Compare-and-set RUNNING → terminal status. `finalized: false` means
 * the row was no longer RUNNING (e.g., concurrent termination); the
 * caller should treat this as already-finalized and not re-emit the
 * scan.module.completed event.
 *
 * F.4.2 closes plan exit-gate L3156 ("ModuleRun carries grade + score")
 * by persisting per-module grade + score on the terminal transition.
 * Callers pass null/null for FAILED/SKIPPED — consistent with the
 * F.3 Option 1 contract for the Scan-side composite (partial findings
 * on a non-COMPLETE run don't represent a meaningful assessment).
 */
export async function markModuleComplete(
  client: AnyPrismaClient,
  scanId: string,
  status: TerminalModuleStatus,
  errorMessage: string | null,
  grade: Grade | null,
  score: number | null,
): Promise<MarkModuleCompleteResult> {
  const updated = await client.moduleRun.updateMany({
    where: {
      scanId,
      module: "GOVERNANCE",
      status: "RUNNING",
    },
    data: {
      status,
      completedAt: new Date(),
      errorMessage,
      grade,
      score,
    },
  });
  return { finalized: updated.count > 0 };
}

/**
 * Compute module-level executionMs with the same non-negative clamp
 * F.4.1 applied scan-side. `startedAt` is the `Date.now()` capture from
 * the top of the Inngest handler; clock skew during durable replay
 * (NTP correction, container migration) could otherwise emit a
 * negative duration on scan.module.completed.
 */
export function computeModuleExecutionMs(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

export const executeGovernanceModule = inngest.createFunction(
  {
    id: "execute-governance-module",
    name: "Execute Governance Module",
    retries: 2,
  },
  {
    event: "scan.module.requested",
    if: 'event.data.module == "GOVERNANCE"',
  },
  async ({ event, step }) => {
    const { scanId } = event.data;
    const startedAt = Date.now();

    // Step 1: feature-flag short-circuit.
    // F.5 I1: gate the emit on the compare-and-set result. Without
    // this gate an Inngest retry of the same scan.module.requested
    // event would re-emit scan.module.completed every replay, which
    // breaks idempotency for executeScan's waitForEvent on the scan
    // side (it would wake on stale completion events).
    if (!isGovernanceModuleEnabled()) {
      const skipResult = await step.run("mark-skipped-module-disabled", () =>
        markModuleSkippedDisabled(prisma, scanId),
      );
      if (skipResult.marked === 0) {
        log({
          event: "module.already_terminal",
          scanId,
          module: "GOVERNANCE",
          stage: "skip",
        });
        return {
          scanId,
          module: "GOVERNANCE",
          status: "skipped",
          reason: "already_terminal",
        } as const;
      }
      await step.sendEvent("emit-module-completed-skipped", {
        name: "scan.module.completed",
        data: {
          scanId,
          module: "GOVERNANCE",
          status: "SKIPPED",
          findingsCount: 0,
          grade: null,
          executionMs: computeModuleExecutionMs(startedAt),
        },
      });
      log({
        event: "module.completed",
        scanId,
        module: "GOVERNANCE",
        status: "SKIPPED",
        findingCount: 0,
        skippedDetectorCount: 0,
      });
      return {
        scanId,
        module: "GOVERNANCE",
        status: "SKIPPED",
        reason: "module_disabled",
      } as const;
    }

    // Step 2: compare-and-set QUEUED → RUNNING
    const markRunning = await step.run("mark-running", () =>
      markModuleRunning(prisma, scanId, event.id),
    );
    if (markRunning.skipped) {
      log({
        event: "module.skip_not_queued",
        scanId,
        module: "GOVERNANCE",
      });
      return {
        scanId,
        module: "GOVERNANCE",
        status: "skipped",
        reason: "not_queued",
      } as const;
    }

    // Step 3: load protocol context for snapshot capture
    const context = await step.run("load-scan-context", () =>
      loadScanContext(prisma, scanId),
    );

    // Step 4: capture snapshot → run detectors → persist (atomic).
    // F.4.2: compute the per-module grade + score inside the same step
    // closure that has the findings array in scope, so we don't have
    // to leak finding objects across Inngest step boundaries (Inngest
    // serialises step results to JSON for retry replay).
    const moduleResult = await step.run("capture-detect-persist", async () => {
      try {
        const snapshot = await captureGovernanceSnapshot({
          protocolAddress: context.protocolAddress,
          declaredMultisigAddresses: context.declaredMultisigAddresses,
        });

        const { findings, skippedDetectorIds, errorDetectorIds } =
          runDetectors(snapshot, isDetectorDisabled, {
            onDetectorError: (id, err) => {
              log({
                event: "detector.error",
                scanId,
                detectorId: id,
                error: err instanceof Error ? err.message : String(err),
              });
            },
          });

        await prisma.$transaction((tx) =>
          persistSnapshotAndFindings(tx, scanId, snapshot, findings),
        );

        const compositeGrade = calculateCompositeGrade(findings);

        return {
          status: "COMPLETE" as const,
          findingCount: findings.length,
          skippedDetectorCount: skippedDetectorIds.length,
          errorDetectorCount: errorDetectorIds.length,
          errorMessage: null as string | null,
          grade: compositeGrade.grade as Grade | null,
          score: compositeGrade.score as number | null,
        };
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : String(err);
        log({
          event: "module.execution_error",
          scanId,
          module: "GOVERNANCE",
          error: errorMessage,
        });
        return {
          status: "FAILED" as const,
          findingCount: 0,
          skippedDetectorCount: 0,
          errorDetectorCount: 0,
          errorMessage,
          grade: null as Grade | null,
          score: null as number | null,
        };
      }
    });

    // Step 5: compare-and-set RUNNING → terminal status (with grade + score).
    // F.5 I1: capture finalized flag; gate Step 6's emit on it. A retry
    // that finds the row already terminal must not re-emit
    // scan.module.completed (executeScan's waitForEvent would otherwise
    // wake spuriously on a duplicate completion).
    const completeResult = await step.run("mark-complete", () =>
      markModuleComplete(
        prisma,
        scanId,
        moduleResult.status,
        moduleResult.errorMessage,
        moduleResult.grade,
        moduleResult.score,
      ),
    );

    if (!completeResult.finalized) {
      log({
        event: "module.already_terminal",
        scanId,
        module: "GOVERNANCE",
        stage: "complete",
      });
      return {
        scanId,
        module: "GOVERNANCE",
        status: "already_terminal",
      } as const;
    }

    // Step 6: emit terminal event with the computed per-module grade
    await step.sendEvent("emit-module-completed", {
      name: "scan.module.completed",
      data: {
        scanId,
        module: "GOVERNANCE",
        status: moduleResult.status,
        findingsCount: moduleResult.findingCount,
        grade: moduleResult.grade,
        executionMs: computeModuleExecutionMs(startedAt),
      },
    });

    log({
      event: "module.completed",
      scanId,
      module: "GOVERNANCE",
      status: moduleResult.status,
      findingCount: moduleResult.findingCount,
      skippedDetectorCount: moduleResult.skippedDetectorCount,
    });

    return {
      scanId,
      module: "GOVERNANCE",
      status: moduleResult.status,
      findingCount: moduleResult.findingCount,
    } as const;
  },
);
