import type {
  ContractRole as ContractRoleType,
  Grade,
  GovernanceSnapshot,
  ModuleStatus,
  Prisma,
} from "@prisma/client";
import { ContractRole } from "@prisma/client";

// Re-export the type so external consumers can keep using the
// existing alias if they were importing via @prisma/client.
export type { ContractRoleType };

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
/**
 * Plan 03 Phase E.1: compare-and-set QUEUED → RUNNING scoped to the
 * specific (scanId, module, contractId) row. Plan 02's scan-wide
 * updateMany transitioned ALL the scan's ModuleRuns in one shot;
 * Phase E narrows so each invocation only touches its own row.
 * Spec §5.3.1 idempotency invariant: every persistence + CAS scoped
 * by the full composite key.
 */
export async function markModuleRunning(
  client: AnyPrismaClient,
  scanId: string,
  contractId: string,
  inngestEventId: string | undefined,
): Promise<MarkModuleRunningResult> {
  const updated = await client.moduleRun.updateMany({
    where: {
      scanId,
      module: "GOVERNANCE",
      contractId,
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
 * Plan 03 Phase E.1: mark THIS Contract's QUEUED ModuleRun row as
 * SKIPPED with the feature-flag reason. Plan 02 scoped this scan-wide;
 * Phase E narrows to (scanId, module, contractId). When the feature
 * flag is off for a multi-Contract scan, each invocation of
 * executeGovernanceModule marks its own row SKIPPED independently —
 * no scan-wide updateMany collisions across siblings.
 */
export async function markModuleSkippedDisabled(
  client: AnyPrismaClient,
  scanId: string,
  contractId: string,
): Promise<MarkModuleSkippedDisabledResult> {
  const updated = await client.moduleRun.updateMany({
    where: {
      scanId,
      module: "GOVERNANCE",
      contractId,
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

export interface ContractContext {
  contractId: string;
  contractAddress: string;
  role: ContractRole;
  /**
   * PRIMARY role only: address of a sibling Contract row with role
   * DECLARED_MULTISIG, when one exists in the same scan. Spec §5.1.1
   * row 1 — Plan 02's `declaredMultisigAddresses` array (sourced from
   * `Protocol.knownMultisigs`) is replaced by per-scan sibling
   * lookups in Plan 03. Undefined for non-PRIMARY roles and for
   * PRIMARY scans with no sibling multisig.
   */
  declaredMultisigCandidate: string | undefined;
  /**
   * PRIMARY role only: address of a sibling Contract row with role
   * TIMELOCK, when one exists. Same lookup pattern as multisig.
   */
  timelockCandidate: string | undefined;
}

/**
 * Plan 03 Phase E.1 — load the Contract row for this invocation plus
 * any sibling-role hints needed by spec §5.1.1's role-aware capture
 * switch. Replaces Plan 02's `loadScanContext` (which loaded the
 * scan's primary address + `Protocol.knownMultisigs`).
 *
 * Throws when:
 *   - the Contract row is missing (e.g., manual DB intervention deleted
 *     it after the dispatcher fired)
 *   - the Contract belongs to a different scanId than expected
 *     (defense-in-depth against an event payload tampered to point at
 *     another scan's Contract id — the orchestrator turns this into a
 *     FAILED ModuleRun with the error in the audit trail).
 */
export async function loadContractContext(
  client: AnyPrismaClient,
  scanId: string,
  contractId: string,
): Promise<ContractContext> {
  const contract = await client.contract.findUnique({
    where: { id: contractId },
    select: { id: true, address: true, role: true, scanId: true },
  });

  if (!contract) {
    throw new Error(
      `[execute-governance-module] Contract ${contractId} not found`,
    );
  }
  if (contract.scanId !== scanId) {
    throw new Error(
      `[execute-governance-module] Contract ${contractId} belongs to scan ${contract.scanId}, not ${scanId}`,
    );
  }

  // Sibling-hint lookup: PRIMARY contracts pick up the scan's sibling
  // DECLARED_MULTISIG / TIMELOCK addresses (if any) as candidate hints
  // for the role-aware capture switch (spec §5.1.1 row 1). Non-PRIMARY
  // roles ignore the hints — their capture paths don't read them.
  let declaredMultisigCandidate: string | undefined;
  let timelockCandidate: string | undefined;
  if (contract.role === ContractRole.PRIMARY) {
    const siblings = await client.contract.findMany({
      where: {
        scanId,
        id: { not: contractId },
        role: { in: [ContractRole.DECLARED_MULTISIG, ContractRole.TIMELOCK] },
      },
      select: { address: true, role: true },
    });
    declaredMultisigCandidate = siblings.find(
      (c) => c.role === ContractRole.DECLARED_MULTISIG,
    )?.address;
    timelockCandidate = siblings.find(
      (c) => c.role === ContractRole.TIMELOCK,
    )?.address;
  }

  return {
    contractId: contract.id,
    contractAddress: contract.address,
    role: contract.role,
    declaredMultisigCandidate,
    timelockCandidate,
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
 * row for this scan + module + contractId (looked up inside the same
 * tx so a concurrent retry can't observe a stale id).
 *
 * Plan 03 §5.3.1 idempotency invariant (Codex spec review IMPORTANT 3):
 * delete-then-insert for findings is scoped by the FULL composite key
 * (scanId, module, contractId). Plan 02's I.1 FIX 1 used
 * deleteMany({ scanId, module }) — scan-wide — which was safe under
 * the Plan 02 `@@unique([scanId, module])` invariant (one GOVERNANCE
 * row per scan). Plan 03 has N GOVERNANCE rows per scan (one per
 * Contract), so scan-wide deleteMany would erase sibling Contracts'
 * findings on retry. The contractId scope makes retry safe per row.
 *
 * I.1 FIX 1 (BLOCKER, spec §4.6 idempotency contract): delete-then-
 * insert. Without the delete step, `finding.createMany` is NOT
 * idempotent — an Inngest step replay after a committed transaction
 * but before the durable checkpoint would double-insert.
 * persistGovernanceSnapshot is already idempotent (Plan 03 Phase E.2
 * keys it on contractId; pre-Phase-E versions used scanId).
 *
 * I.1 FIX 2: persist ModuleRun.findingsCount in the same transaction.
 * I.1 FIX 3: persist errorDetectorCount in the same transaction.
 */
export async function persistSnapshotAndFindings(
  tx: Prisma.TransactionClient,
  scanId: string,
  contractId: string,
  snapshot: GovernanceSnapshotData,
  findings: GovernanceFindingInput[],
  errorDetectorCount: number = 0,
): Promise<PersistResult> {
  const persistedSnapshot = await persistGovernanceSnapshot(
    { scanId, contractId, snapshot },
    tx,
  );

  const moduleRun = await tx.moduleRun.findFirst({
    where: { scanId, module: "GOVERNANCE", contractId },
    select: { id: true },
  });
  if (!moduleRun) {
    throw new Error(
      `[execute-governance-module] ModuleRun not found for scan ${scanId} contract ${contractId} during finding persistence`,
    );
  }

  // Plan 03 §5.3.1 (IMPORTANT 3): the deleteMany scope is the full
  // composite (scanId, module, contractId) — without contractId, this
  // would erase sibling Contracts' findings on retry. Plan 03 Phase E.3
  // adds an integration test that explicitly verifies this scope.
  // The delete fires unconditionally — even when findings.length === 0
  // — so a replay that observes a prior partial commit's findings
  // is cleared first.
  await tx.finding.deleteMany({
    where: { scanId, module: "GOVERNANCE", contractId },
  });

  if (findings.length > 0) {
    await tx.finding.createMany({
      data: findings.map((f) => ({
        scanId,
        contractId,
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

  // I.1 FIX 2 + FIX 3: write findingsCount AND errorDetectorCount in
  // the same tx as the Finding rows. Atomic with delete-then-insert
  // above so a replayed tx ends with consistent (findingsCount,
  // errorDetectorCount, actual rows) state.
  await tx.moduleRun.update({
    where: { id: moduleRun.id },
    data: {
      findingsCount: findings.length,
      errorDetectorCount,
    },
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
  contractId: string,
  status: TerminalModuleStatus,
  errorMessage: string | null,
  grade: Grade | null,
  score: number | null,
): Promise<MarkModuleCompleteResult> {
  // Plan 03 Phase E.1 + spec §5.3.1: scoped to (scanId, module,
  // contractId). Plan 02's scan-wide updateMany would have transitioned
  // ALL the scan's RUNNING ModuleRuns to terminal in one shot — which
  // for multi-Contract scans masked per-Contract isolation. The
  // narrower scope is also what makes the mark-module-timeout +
  // markModuleComplete race safe per-Contract: each row's compare-and-
  // set on RUNNING is independent of siblings.
  const updated = await client.moduleRun.updateMany({
    where: {
      scanId,
      module: "GOVERNANCE",
      contractId,
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
    // Plan 03 §4.3: every scan.module.requested event carries
    // contractId + contractAddress (required after Codex Review #3
    // IMPORTANT 3 type tightening — see commit abdc0e8) so this
    // function operates per-Contract.
    const { scanId, contractId, contractAddress } = event.data;
    const startedAt = Date.now();

    // Step 1: feature-flag short-circuit (per-Contract).
    // F.5 I1 gate preserved: the emit is gated on the compare-and-set
    // result so an Inngest retry that finds the row already terminal
    // doesn't re-emit a stale completion event. Plan 03 Phase E.1:
    // the mark-skipped + emit are now scoped to this contractId, so
    // sibling Contracts' rows are unaffected (Plan 02 used scan-wide
    // updateMany here, masking per-Contract semantics).
    if (!isGovernanceModuleEnabled()) {
      const skipResult = await step.run("mark-skipped-module-disabled", () =>
        markModuleSkippedDisabled(prisma, scanId, contractId),
      );
      if (skipResult.marked === 0) {
        log({
          event: "module.already_terminal",
          scanId,
          contractId,
          module: "GOVERNANCE",
          stage: "skip",
        });
        return {
          scanId,
          contractId,
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
          contractId,
          contractAddress,
          status: "SKIPPED",
          findingsCount: 0,
          grade: null,
          executionMs: computeModuleExecutionMs(startedAt),
        },
      });
      log({
        event: "module.completed",
        scanId,
        contractId,
        module: "GOVERNANCE",
        status: "SKIPPED",
        findingCount: 0,
        skippedDetectorCount: 0,
      });
      return {
        scanId,
        contractId,
        module: "GOVERNANCE",
        status: "SKIPPED",
        reason: "module_disabled",
      } as const;
    }

    // Step 2: compare-and-set QUEUED → RUNNING (per-Contract).
    const markRunning = await step.run("mark-running", () =>
      markModuleRunning(prisma, scanId, contractId, event.id),
    );
    if (markRunning.skipped) {
      log({
        event: "module.skip_not_queued",
        scanId,
        contractId,
        module: "GOVERNANCE",
      });
      return {
        scanId,
        contractId,
        module: "GOVERNANCE",
        status: "skipped",
        reason: "not_queued",
      } as const;
    }

    // Step 3: load Contract row + sibling-role hints for the role-aware
    // capture switch (spec §5.1.1).
    const context = await step.run("load-contract-context", () =>
      loadContractContext(prisma, scanId, contractId),
    );

    // Step 4: capture snapshot → run detectors → persist (atomic).
    // F.4.2: compute the per-module grade + score inside the same step
    // closure that has the findings array in scope, so we don't have
    // to leak finding objects across Inngest step boundaries (Inngest
    // serialises step results to JSON for retry replay).
    const moduleResult = await step.run("capture-detect-persist", async () => {
      try {
        // Plan 03 Phase E.1: the contract's REAL role drives the
        // §5.1.1 capture switch — no longer hardcoded to PRIMARY.
        // The sibling-hint addresses come from the scan's other
        // Contract rows (declaredMultisigCandidate from a sibling
        // DECLARED_MULTISIG; timelockCandidate from a sibling TIMELOCK)
        // — see loadContractContext.
        const snapshot = await captureGovernanceSnapshot({
          contractAddress: context.contractAddress,
          role: context.role,
          declaredMultisigCandidate: context.declaredMultisigCandidate,
          timelockCandidate: context.timelockCandidate,
        });

        const { findings, skippedDetectorIds, errorDetectorIds } =
          runDetectors(snapshot, isDetectorDisabled, {
            onDetectorError: (id, err) => {
              log({
                event: "detector.error",
                scanId,
                contractId,
                detectorId: id,
                error: err instanceof Error ? err.message : String(err),
              });
            },
          });

        await prisma.$transaction((tx) =>
          persistSnapshotAndFindings(
            tx,
            scanId,
            contractId,
            snapshot,
            findings,
            errorDetectorIds.length,
          ),
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
          contractId,
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

    // Step 5: compare-and-set RUNNING → terminal status (per-Contract).
    // F.5 I1: capture finalized flag; gate Step 6's emit on it. A retry
    // that finds the row already terminal must not re-emit
    // scan.module.completed (executeScan's waitForEvent would otherwise
    // wake spuriously on a duplicate completion).
    const completeResult = await step.run("mark-complete", () =>
      markModuleComplete(
        prisma,
        scanId,
        contractId,
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
        contractId,
        module: "GOVERNANCE",
        stage: "complete",
      });
      return {
        scanId,
        contractId,
        module: "GOVERNANCE",
        status: "already_terminal",
      } as const;
    }

    // Step 6: emit terminal event with the computed per-module grade.
    // Plan 03 §4.3: contractId + contractAddress echoed so the
    // per-(module, contractId) waiter in execute-scan can match this
    // specific row.
    await step.sendEvent("emit-module-completed", {
      name: "scan.module.completed",
      data: {
        scanId,
        module: "GOVERNANCE",
        contractId,
        contractAddress,
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
