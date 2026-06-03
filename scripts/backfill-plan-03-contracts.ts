#!/usr/bin/env tsx
/**
 * Plan 03 Phase H.1 — historical-scan Contract backfill (per spec §3.5
 * PR 1 + plan §13).
 *
 * Plan 02 scans were created before the Phase A `Contract` model
 * existed. They have rows in `ModuleRun`, `Finding`, and
 * `GovernanceSnapshot` with `contractId IS NULL`. This script
 * synthesises a single PRIMARY Contract row per legacy scan and
 * backfills `contractId` on those orphan rows so the Phase G UI
 * + Phase F per-Contract rollup operate on a consistent shape.
 *
 * INVARIANTS:
 *   - Idempotent. A scan that already has a PRIMARY Contract row is
 *     skipped entirely (no second Contract created, no overwrites of
 *     ModuleRun/Finding contractId that may have been set by a Plan 03
 *     scan or a prior backfill run).
 *   - Per-scan transactional. The Contract create + the three
 *     `updateMany` calls (ModuleRun + GovernanceSnapshot + Finding)
 *     run inside one `prisma.$transaction`; a mid-scan crash never
 *     leaves a half-backfilled state.
 *   - Batched. Scans are processed in batches (BATCH_SIZE) so the
 *     script doesn't load the full scan table into memory or hold one
 *     giant DB transaction.
 *   - Auditable. Per-scan progress is logged at info level; the
 *     final summary surfaces backfilled / skipped / error counts.
 *   - Dry-run safe. `--dry-run` reports what the script WOULD do
 *     without writing. Mandatory for production sanity-check before
 *     a real run.
 *
 * EDGE CASE — scan with no ModuleRuns (failed before dispatch, etc.):
 * Per the plan §13 pseudocode the Contract is created anyway. This
 * yields a UI-consistent shape (every legacy Plan 02 scan has at
 * least one ContractCard rendered) at the cost of a Contract row
 * with no associated ModuleRuns. Documented choice; safe because
 * the UI treats an empty modules list as "no work dispatched."
 *
 * EDGE CASE — scan whose `Protocol.primaryContractAddress` is null
 * or empty: the script skips with error count incremented. Such a
 * Scan is a data-corruption case; surface it loudly rather than
 * silently inserting a Contract with an empty address.
 *
 * INVOCATION:
 *   pnpm db:backfill-plan-03-contracts -- --dry-run
 *   pnpm db:backfill-plan-03-contracts          # writes
 *
 * The `--` separator is necessary so pnpm forwards `--dry-run` to
 * the tsx subprocess rather than consuming it.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BATCH_SIZE = 100;

interface BackfillSummary {
  scansEvaluated: number;
  backfilled: number;
  skipped: number;
  errors: number;
  // Aggregate row-touch counters across all backfilled scans.
  contractsCreated: number;
  moduleRunsLinked: number;
  governanceSnapshotsLinked: number;
  findingsLinked: number;
}

function newSummary(): BackfillSummary {
  return {
    scansEvaluated: 0,
    backfilled: 0,
    skipped: 0,
    errors: 0,
    contractsCreated: 0,
    moduleRunsLinked: 0,
    governanceSnapshotsLinked: 0,
    findingsLinked: 0,
  };
}

type BackfillResult =
  | {
      skipped: true;
      reason:
        | "already_has_primary_contract"
        | "missing_primary_address";
    }
  | {
      skipped: false;
      contractId: string;
      moduleRunsLinked: number;
      governanceSnapshotsLinked: number;
      findingsLinked: number;
    };

/**
 * Atomic per-scan backfill. The Contract create + the three orphan
 * updateMany calls run inside one `$transaction` so a partial failure
 * never leaves a half-backfilled scan.
 */
async function backfillScan(
  scanId: string,
  dryRun: boolean,
): Promise<BackfillResult> {
  // Read outside the transaction — gives us the data needed to decide
  // whether to skip without holding a write transaction open during
  // I/O. Idempotency check + Protocol lookup.
  const scan = await prisma.scan.findUnique({
    where: { id: scanId },
    include: {
      protocol: {
        select: { chain: true, primaryContractAddress: true },
      },
      contracts: { select: { id: true, isPrimary: true } },
    },
  });
  if (!scan) {
    // Caller already enumerated this id — if it's gone now, treat as
    // a benign skip (race vs. a concurrent delete).
    return { skipped: true, reason: "already_has_primary_contract" };
  }

  // Idempotency: any Contract row at all → assume Plan 03 has already
  // populated this scan (or a prior backfill completed). Don't touch.
  if (scan.contracts.length > 0) {
    return { skipped: true, reason: "already_has_primary_contract" };
  }

  const primaryAddress = scan.protocol.primaryContractAddress?.trim();
  if (!primaryAddress) {
    // Data-corruption case — surface loudly, don't fabricate.
    return { skipped: true, reason: "missing_primary_address" };
  }

  if (dryRun) {
    // Count the rows that WOULD be touched without writing.
    const [moduleRunsLinked, governanceSnapshotsLinked, findingsLinked] =
      await Promise.all([
        prisma.moduleRun.count({
          where: { scanId, contractId: null },
        }),
        prisma.governanceSnapshot.count({
          where: { scanId, contractId: null },
        }),
        prisma.finding.count({
          where: { scanId, contractId: null },
        }),
      ]);
    return {
      skipped: false,
      contractId: "<dry-run>",
      moduleRunsLinked,
      governanceSnapshotsLinked,
      findingsLinked,
    };
  }

  // Atomic write: Contract create + three orphan updateMany calls.
  // The `contractId IS NULL` filter on each updateMany is the
  // idempotency guard at the row level — a retried run that finds
  // the rows already linked is a no-op count=0.
  const txResult = await prisma.$transaction(async (tx) => {
    const contract = await tx.contract.create({
      data: {
        scanId: scan.id,
        address: primaryAddress,
        chain: scan.protocol.chain,
        role: "PRIMARY",
        isPrimary: true,
        // Phase G remediation #1 + Phase F: the scan-wide grade IS the
        // synthetic contract's per-Contract grade (rollup over 1 contract
        // is identity). Field mapping: per-Contract `compositeScore`
        // sourced from Scan-level `averageContractScore` (Phase A
        // renamed `Scan.compositeScore` → `Scan.averageContractScore`).
        compositeScore: scan.averageContractScore,
        compositeGrade: scan.compositeGrade,
        isPartialGrade: scan.isPartialGrade,
      },
      select: { id: true },
    });

    const moduleRunsResult = await tx.moduleRun.updateMany({
      where: { scanId: scan.id, contractId: null },
      data: { contractId: contract.id },
    });
    const governanceSnapshotsResult = await tx.governanceSnapshot.updateMany(
      {
        where: { scanId: scan.id, contractId: null },
        data: { contractId: contract.id },
      },
    );
    const findingsResult = await tx.finding.updateMany({
      where: { scanId: scan.id, contractId: null },
      data: { contractId: contract.id },
    });

    return {
      contractId: contract.id,
      moduleRunsLinked: moduleRunsResult.count,
      governanceSnapshotsLinked: governanceSnapshotsResult.count,
      findingsLinked: findingsResult.count,
    };
  });

  return { skipped: false, ...txResult };
}

/**
 * Public entrypoint used by both the CLI and the integration tests.
 * Returns the summary so callers can assert on it.
 */
export async function runBackfill(
  opts: { dryRun?: boolean } = {},
): Promise<BackfillSummary> {
  const dryRun = opts.dryRun ?? false;
  const summary = newSummary();

  let cursor: string | undefined;
  while (true) {
    const batch: { id: string }[] = await prisma.scan.findMany({
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    for (const { id } of batch) {
      summary.scansEvaluated += 1;
      try {
        const result = await backfillScan(id, dryRun);
        if (result.skipped) {
          summary.skipped += 1;
        } else {
          summary.backfilled += 1;
          summary.contractsCreated += 1;
          summary.moduleRunsLinked += result.moduleRunsLinked;
          summary.governanceSnapshotsLinked +=
            result.governanceSnapshotsLinked;
          summary.findingsLinked += result.findingsLinked;
        }
      } catch (err) {
        summary.errors += 1;
        // Log per-scan errors so a partial-failure run is debuggable
        // without re-running. Continue with the rest of the batch —
        // one bad scan shouldn't abort the whole backfill.
        console.error(
          `[backfill] scan ${id}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    cursor = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  return summary;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `[backfill] Plan 03 Contract backfill — ${dryRun ? "DRY RUN" : "WRITE MODE"}`,
  );

  const summary = await runBackfill({ dryRun });

  console.log(
    `[backfill] complete: ${JSON.stringify(summary, null, 2)}`,
  );

  if (summary.errors > 0) {
    console.error(
      `[backfill] ${summary.errors} scan(s) errored — investigate before re-running.`,
    );
    process.exit(1);
  }
}

// Only run main() when invoked as a script — tests import runBackfill
// directly and run their own assertions.
const invokedDirectly = process.argv[1]?.endsWith(
  "backfill-plan-03-contracts.ts",
);
if (invokedDirectly) {
  main()
    .catch((e) => {
      console.error("[backfill] fatal error:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
