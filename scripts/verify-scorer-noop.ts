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

// Only scans that markComplete actually finalised carry computed grades.
const FINALISED = ["COMPLETE", "PARTIAL_COMPLETE", "FAILED"] as const;

interface Summary {
  scansChecked: number;
  scansMatched: number;
  scansMismatched: number;
}

async function run(): Promise<Summary> {
  const summary: Summary = {
    scansChecked: 0,
    scansMatched: 0,
    scansMismatched: 0,
  };

  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.scan.findMany({
      where: { status: { in: [...FINALISED] } },
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

      const diffs = diffRollupVsPersisted(computed, persisted);
      if (diffs.length === 0) {
        summary.scansMatched += 1;
      } else {
        summary.scansMismatched += 1;
        console.error(
          `[verify-scorer-noop] MISMATCH scan ${scan.id}:\n` +
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

  if (summary.scansMismatched > 0) {
    console.error(
      `[verify-scorer-noop] ${summary.scansMismatched} scan(s) DIFFER — the reconciliation is NOT a no-op. Investigate before merge.`,
    );
    process.exit(1);
  }
  console.log(
    `[verify-scorer-noop] OK — all ${summary.scansMatched} finalised scans are bit-identical.`,
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
