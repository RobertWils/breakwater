#!/usr/bin/env tsx
/**
 * Plan 05 Fase 1.2 — no-op verification harness (READ-ONLY).
 *
 * Runs the NEW reachability-aware `rollupProtocolComposite` over every
 * finalised scan in the DB and diffs its output against the grades already
 * PERSISTED on each Scan (compositeGrade, worstContractScore,
 * averageContractScore, isPartialGrade, isPartialCoverage). Over today's
 * pure-star data the diff MUST be empty for every scan — that is the
 * bit-identical guarantee from Plan 05 §5.4. A non-empty diff means a
 * reconciliation bug (or unexpected non-star data, which the recon ruled
 * out).
 *
 * IMPORTANT (per the recon): we compare against the PERSISTED Scan grades —
 * we do NOT re-run the old scorer (that would require duplicating the
 * per-contract status derivation). Per-contract grade/score are read from
 * the persisted Contract rows; per-contract status is derived with the
 * SHARED `deriveContractStatus` helper (reused, not duplicated). The rollup
 * is fed no explicit edges, so it synthesises the same star the scans were
 * originally scored over.
 *
 * READ-ONLY: this script never writes. It is the same operational shape as
 * the backfill scripts — Robert runs it by hand against the target DB:
 *
 *   pnpm verify-scorer-noop
 *
 * Exits non-zero if ANY scan diffs, so it can gate a deploy.
 */

import { PrismaClient } from "@prisma/client";

import { deriveContractStatus } from "@/lib/inngest/functions/execute-scan";
import {
  rollupProtocolComposite,
  type ProtocolRollupContract,
} from "@/lib/scoring/protocol-rollup";

import {
  diffRollupVsPersisted,
  type PersistedScanGrades,
} from "./verify-scorer-noop.logic";

const prisma = new PrismaClient();

const BATCH_SIZE = 100;

interface Summary {
  scansChecked: number;
  scansMatched: number;
  scansMismatched: number;
  /**
   * Rows where worstContractScore was EXCLUDED from the diff for the legacy
   * reason (graded scan finalised before the column existed). Reported so an
   * exclusion is visible, not a silently swallowed mismatch.
   */
  legacyFieldsSkipped: number;
  // Coverage diagnostics (Plan 05 F1.2 point 4 — the 11-vs-26 question):
  /** All scans, any status (to reconcile against the checked count). */
  totalScans: number;
  /**
   * Graded scans (compositeGrade non-null) that have NO completedAt and so
   * fall OUTSIDE the completedAt filter. markComplete writes grade +
   * completedAt atomically, so this is expected to be 0; a positive value is
   * a SECOND gap — scans-with-grades the harness would skip.
   */
  gradedButNotCompleted: number;
}

async function run(): Promise<Summary> {
  const summary: Summary = {
    scansChecked: 0,
    scansMatched: 0,
    scansMismatched: 0,
    legacyFieldsSkipped: 0,
    totalScans: 0,
    gradedButNotCompleted: 0,
  };

  // Coverage diagnostics first: does the completedAt filter drop any scan
  // that actually carries a grade? (Reconciles the 26-backfilled vs
  // 11-checked discrepancy: total − checked = scans without completedAt;
  // gradedButNotCompleted isolates whether any of those have grades.)
  summary.totalScans = await prisma.scan.count();
  summary.gradedButNotCompleted = await prisma.scan.count({
    where: { completedAt: null, compositeGrade: { not: null } },
  });

  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.scan.findMany({
      // "Carries persisted grades" ⟺ completedAt IS NOT NULL. markComplete is
      // the ONLY path that writes the five Scan grade fields, and it
      // co-writes completedAt in the same update — so this is the exact,
      // STATUS-AGNOSTIC marker (Codex finding 2). A status list would
      // silently skip any class the app considers terminal-with-grades that
      // isn't listed (e.g. a future EXPIRED that preserves grades), and would
      // wrongly include never-graded states. Keying on completedAt checks
      // every finalised scan regardless of status and excludes in-progress
      // ones (QUEUED/RUNNING/never-written-PARTIAL_COMPLETE) that have none.
      where: { completedAt: { not: null } },
      select: {
        id: true,
        compositeGrade: true,
        worstContractScore: true,
        averageContractScore: true,
        isPartialGrade: true,
        isPartialCoverage: true,
        contracts: {
          select: {
            id: true,
            address: true,
            isPrimary: true,
            compositeScore: true,
            compositeGrade: true,
            isPartialGrade: true,
            moduleRuns: { select: { status: true } },
          },
        },
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    for (const scan of batch) {
      summary.scansChecked += 1;

      const contracts: ProtocolRollupContract[] = scan.contracts.map((c) => ({
        id: c.id,
        address: c.address,
        isPrimary: c.isPrimary,
        compositeScore: c.compositeScore,
        compositeGrade: c.compositeGrade,
        isPartialGrade: c.isPartialGrade,
        status: deriveContractStatus(c.moduleRuns),
      }));

      // No explicit edges ⇒ synthesise the star the scan was scored over.
      const computed = rollupProtocolComposite(contracts);

      const persisted: PersistedScanGrades = {
        compositeGrade: scan.compositeGrade,
        worstContractScore: scan.worstContractScore,
        averageContractScore: scan.averageContractScore,
        isPartialGrade: scan.isPartialGrade,
        isPartialCoverage: scan.isPartialCoverage,
      };

      const { diffs, legacyWorstScoreSkipped } = diffRollupVsPersisted(
        computed,
        persisted,
      );
      if (legacyWorstScoreSkipped) summary.legacyFieldsSkipped += 1;

      if (diffs.length === 0) {
        // A legacy row still counts as matched on its four comparable fields
        // — the worstContractScore exclusion is reported via legacyFieldsSkipped.
        summary.scansMatched += 1;
      } else {
        summary.scansMismatched += 1;
        console.error(
          `[verify-scorer-noop] MISMATCH scan ${scan.id}${legacyWorstScoreSkipped ? " (legacy worstContractScore excluded)" : ""}:\n` +
            diffs
              .map(
                (d) =>
                  `    ${d.field}: computed=${JSON.stringify(d.computed)} persisted=${JSON.stringify(d.persisted)}`,
              )
              .join("\n"),
        );
      }
    }

    cursor = batch[batch.length - 1]!.id;
    if (batch.length < BATCH_SIZE) break;
  }

  return summary;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[verify-scorer-noop] DATABASE_URL is required — point it at the DB to verify.",
    );
    process.exit(1);
  }

  console.log("[verify-scorer-noop] read-only bit-identical check (Plan 05 §5.4)");
  const summary = await run();
  console.log(`[verify-scorer-noop] ${JSON.stringify(summary, null, 2)}`);

  // Sanity gate (Codex finding 2): zero scans checked is NOT a pass. An empty
  // fleet or a too-narrow filter must surface loudly, never read as a green
  // tick. "all 0 scans bit-identical" is meaningless.
  if (summary.scansChecked === 0) {
    console.error(
      "[verify-scorer-noop] checked 0 scans — nothing was verified (empty DB, or no scans carry persisted grades). This is NOT a pass.",
    );
    process.exit(1);
  }

  // Second-gap gate (point 4): graded scans without completedAt carry grades
  // but fall outside the filter. markComplete writes them atomically, so this
  // should be 0; a positive value means the harness silently skips
  // scans-with-grades and must be investigated before trusting an "OK".
  if (summary.gradedButNotCompleted > 0) {
    console.error(
      `[verify-scorer-noop] SECOND GAP: ${summary.gradedButNotCompleted} graded scan(s) have no completedAt — they carry grades but the filter skips them. Investigate the persist path before trusting this run.`,
    );
    process.exit(1);
  }

  if (summary.scansMismatched > 0) {
    console.error(
      `[verify-scorer-noop] ${summary.scansMismatched} scan(s) DIFFER — the reconciliation is NOT a no-op. Investigate before merge.`,
    );
    process.exit(1);
  }
  console.log(
    `[verify-scorer-noop] OK — ${summary.scansMatched} finalised scans bit-identical` +
      (summary.legacyFieldsSkipped > 0
        ? ` (${summary.legacyFieldsSkipped} legacy row(s) had worstContractScore excluded as a pre-field column — compared on the other four fields)`
        : "") +
      ".",
  );
}

const invokedDirectly = process.argv[1]?.endsWith("verify-scorer-noop.ts");
if (invokedDirectly) {
  main()
    .catch((e) => {
      console.error("[verify-scorer-noop] fatal error:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
