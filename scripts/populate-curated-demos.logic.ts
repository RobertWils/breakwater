/**
 * Plan 04 Scope F — pure logic + DI orchestrator for the curated-demo
 * populate step.
 *
 * This module is IO-free by design: it imports only the curated graph
 * data, the submission schema, and Prisma *types*. All side effects
 * (DB reads/writes, submitScan, Inngest, polling) are injected via
 * `PopulateDeps`, so the decision + orchestration logic is unit-testable
 * without a database, Inngest runtime, or live RPC. The real wiring lives
 * in `populate-curated-demos.ts`.
 *
 * Why an orchestrator at all (instead of a plain `submitScan` call):
 *   1. CURATED gate — `submitScan` rejects any protocol with
 *      `ownershipStatus: CURATED` (scan-submission.ts step 6). The seeded
 *      demos are CURATED, so the orchestrator transiently flips the
 *      protocol to UNCLAIMED to open the gate, then restores CURATED.
 *   2. Async execution — `submitScan` only enqueues a `scan.queued`
 *      Inngest event and returns 202; detectors run later in the Inngest
 *      workers. The orchestrator therefore waits for the scan to reach a
 *      terminal state before publishing it.
 *   3. Publish invariant (spec §8.2) — each curated demo points at exactly
 *      one published scan via `Protocol.latestDemoScanId`. Publishing sets
 *      that pointer and restores CURATED atomically.
 *
 * NO FABRICATION: the orchestrator never writes findings/snapshots. It
 * only drives the real scan pipeline and links its real output. If the
 * pipeline cannot run (no DB / no Inngest / no RPC), nothing is published.
 */

import type { OwnershipStatus, ScanStatus } from "@prisma/client";

import {
  ScanSubmissionSchema,
  type ScanSubmission,
} from "@/lib/schemas/scan";

import type { CuratedDemo } from "../prisma/curated-demos";
import { CURATED_DEMO_GRAPHS } from "../prisma/curated-demos";

/**
 * Scan statuses that count as a publishable demo result — both carry a
 * composite grade + real findings. FAILED / EXPIRED / in-flight states
 * are not publishable.
 */
const PUBLISHED_SCAN_STATUSES: ReadonlySet<ScanStatus> = new Set<ScanStatus>([
  "COMPLETE",
  "PARTIAL_COMPLETE",
]);

/** PRIMARY row + one row per related contract in the curated graph. */
export function expectedContractCount(demo: CuratedDemo): number {
  return 1 + demo.relatedContracts.length;
}

/**
 * Map a curated graph to a `submitScan` input. Parsing through
 * `ScanSubmissionSchema` is intentional: it validates the related-contract
 * roles (a curated entry mistakenly carrying the PRIMARY role is rejected,
 * since PRIMARY is not a submittable related role) and applies the public
 * scan-form's `modulesEnabled` default — so a demo is a faithful copy of
 * what a real user submission produces, not a special-cased shape.
 */
export function buildScanSubmissionInput(demo: CuratedDemo): ScanSubmission {
  return ScanSubmissionSchema.parse({
    chain: demo.chain,
    primaryContractAddress: demo.primaryContractAddress,
    domain: demo.domain,
    relatedContracts: demo.relatedContracts.map((rc) => ({
      address: rc.address,
      role: rc.role,
      label: rc.label,
    })),
  });
}

export interface DemoProtocolState {
  exists: boolean;
  ownershipStatus: OwnershipStatus | null;
  latestDemoScanId: string | null;
  /** Status of the scan `latestDemoScanId` points at (null if no pointer). */
  linkedScanStatus: ScanStatus | null;
  /** Contract-row count on that linked scan (null if no pointer). */
  linkedScanContractCount: number | null;
}

export type DemoPlan =
  | { action: "skip"; reason: "already_published" }
  | {
      action: "populate";
      reason: "no_demo_scan" | "demo_scan_unpublished" | "contract_count_mismatch";
    }
  | { action: "error"; reason: "protocol_missing" };

/**
 * Pure idempotency decision. A demo is "already published" only when its
 * `latestDemoScanId` points at a publishable scan whose contract count
 * matches the curated graph — so a re-run after a successful populate is a
 * no-op, while a missing / failed / drifted link triggers a fresh populate.
 */
export function planDemoAction(
  demo: CuratedDemo,
  state: DemoProtocolState,
): DemoPlan {
  if (!state.exists) {
    return { action: "error", reason: "protocol_missing" };
  }
  if (!state.latestDemoScanId) {
    return { action: "populate", reason: "no_demo_scan" };
  }
  if (!state.linkedScanStatus || !PUBLISHED_SCAN_STATUSES.has(state.linkedScanStatus)) {
    return { action: "populate", reason: "demo_scan_unpublished" };
  }
  if (state.linkedScanContractCount !== expectedContractCount(demo)) {
    return { action: "populate", reason: "contract_count_mismatch" };
  }
  return { action: "skip", reason: "already_published" };
}

/**
 * Injected side effects. The real implementations (DB + submitScan +
 * Inngest poll) live in `populate-curated-demos.ts`; tests pass in-memory
 * fakes.
 */
export interface PopulateDeps {
  readProtocolState(demo: CuratedDemo): Promise<DemoProtocolState>;
  /** Set the demo protocol's ownership status (gate flip / restore). */
  setOwnership(demo: CuratedDemo, status: OwnershipStatus): Promise<void>;
  /** Submit the curated graph through the real `submitScan` path. */
  submit(demo: CuratedDemo): Promise<{ scanId: string }>;
  /** Wait until the scan reaches a terminal state; report status + count. */
  waitForScan(
    scanId: string,
  ): Promise<{ status: ScanStatus; contractCount: number }>;
  /**
   * Atomically point `Protocol.latestDemoScanId` at the scan AND restore
   * `ownershipStatus: CURATED` (the publish + restore is one transaction).
   */
  publishDemoScan(demo: CuratedDemo, scanId: string): Promise<void>;
  log(line: string): void;
}

export interface PopulateOptions {
  dryRun?: boolean;
  /** Override the demo set (tests / targeted re-runs). */
  demos?: CuratedDemo[];
}

export interface PopulateSummary {
  demosEvaluated: number;
  populated: number;
  skipped: number;
  /** Demos a dry-run would populate (write mode only acts on these). */
  wouldPopulate: number;
  errors: number;
}

function newSummary(): PopulateSummary {
  return {
    demosEvaluated: 0,
    populated: 0,
    skipped: 0,
    wouldPopulate: 0,
    errors: 0,
  };
}

/**
 * Orchestrate population of every curated multi-Contract demo. Returns a
 * summary so the CLI and tests can assert on the outcome.
 *
 * Per-demo guarantees:
 *   - Idempotent: `planDemoAction` skips demos already published.
 *   - Curated-gate safe: the protocol is flipped to UNCLAIMED only to open
 *     the `submitScan` gate, and is ALWAYS returned to CURATED (publish on
 *     success, restore in `finally` on every failure path).
 *   - No half-state: a scan that fails / drifts is never linked; the
 *     protocol stays CURATED + unlinked, so a later re-run retries cleanly.
 *   - Auditable: each decision + transition is logged via `deps.log`.
 */
export async function runPopulate(
  deps: PopulateDeps,
  opts: PopulateOptions = {},
): Promise<PopulateSummary> {
  const dryRun = opts.dryRun ?? false;
  const demos = opts.demos ?? Object.values(CURATED_DEMO_GRAPHS);
  const summary = newSummary();

  for (const demo of demos) {
    summary.demosEvaluated += 1;

    let state: DemoProtocolState;
    try {
      state = await deps.readProtocolState(demo);
    } catch (err) {
      summary.errors += 1;
      deps.log(`[${demo.slug}] ERROR reading protocol state: ${errMsg(err)}`);
      continue;
    }

    const plan = planDemoAction(demo, state);

    if (plan.action === "error") {
      summary.errors += 1;
      deps.log(
        `[${demo.slug}] ERROR ${plan.reason} — run \`pnpm db:seed\` first so the curated Protocol row exists.`,
      );
      continue;
    }

    if (plan.action === "skip") {
      summary.skipped += 1;
      deps.log(`[${demo.slug}] skip (${plan.reason})`);
      continue;
    }

    // plan.action === "populate"
    if (dryRun) {
      summary.wouldPopulate += 1;
      deps.log(
        `[${demo.slug}] DRY RUN would populate (${plan.reason}): submit ${expectedContractCount(
          demo,
        )} contracts, wait for completion, publish demo scan.`,
      );
      continue;
    }

    let published = false;
    try {
      deps.log(`[${demo.slug}] populate (${plan.reason}) — opening curated gate`);
      await deps.setOwnership(demo, "UNCLAIMED");

      const { scanId } = await deps.submit(demo);
      deps.log(`[${demo.slug}] submitted scan ${scanId}; waiting for completion`);

      const result = await deps.waitForScan(scanId);

      if (!PUBLISHED_SCAN_STATUSES.has(result.status)) {
        summary.errors += 1;
        deps.log(
          `[${demo.slug}] ERROR scan ${scanId} ended ${result.status} — not publishing.`,
        );
      } else if (result.contractCount !== expectedContractCount(demo)) {
        summary.errors += 1;
        deps.log(
          `[${demo.slug}] ERROR scan ${scanId} has ${result.contractCount} contracts, expected ${expectedContractCount(
            demo,
          )} — not publishing.`,
        );
      } else {
        await deps.publishDemoScan(demo, scanId);
        published = true;
        summary.populated += 1;
        deps.log(
          `[${demo.slug}] published demo scan ${scanId} (${result.status}) and restored CURATED`,
        );
      }
    } catch (err) {
      summary.errors += 1;
      deps.log(`[${demo.slug}] ERROR during populate: ${errMsg(err)}`);
    } finally {
      // Publish already restored CURATED atomically; otherwise make sure
      // the transient UNCLAIMED flip never outlives a failed populate.
      if (!published) {
        try {
          await deps.setOwnership(demo, "CURATED");
        } catch (err) {
          deps.log(
            `[${demo.slug}] WARN failed to restore CURATED after error: ${errMsg(err)}`,
          );
        }
      }
    }
  }

  return summary;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
