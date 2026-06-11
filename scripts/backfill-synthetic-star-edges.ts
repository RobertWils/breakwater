#!/usr/bin/env tsx
/**
 * Plan 05 Fase 1.1 — synthetic-star edge backfill (data migration).
 *
 * WHAT THIS DOES
 * --------------
 * For every existing Scan, creates one `ContractEdge` primary->sibling per
 * non-primary Contract — the exact star `buildStarGraph` synthesises today
 * (`src/components/scan/scan-to-radar.ts`). Persisting that star is what
 * keeps each existing protocol's grade BIT-IDENTICAL once a later scope
 * runs the graph scorer over these edges instead of the synthetic star
 * (Plan 05 §5.4). This is the ONLY edge creation in Fase 1 and is
 * star-shaped by construction (only primary->sibling).
 *
 * PURELY ADDITIVE: nothing reads `ContractEdge` yet, so this changes no
 * scan / scoring / UI behaviour. The schema lands in the companion
 * migration `20260611120000_plan_05_f1_1_discovery_foundations`; this
 * script is the separate, idempotent, dry-runnable data step (same
 * schema-only-migration / data-only-backfill split as Plan 03's
 * backfill-plan-03-contracts.ts).
 *
 * IDEMPOTENT: edges are inserted with `createMany({ skipDuplicates: true })`
 * against the `@@unique([fromContractId, toContractId, edgeKind])`
 * constraint, so a repeated run creates no duplicates. The decision +
 * orchestration logic is unit-tested in backfill-synthetic-star-edges.logic.ts.
 *
 * INVOCATION
 * ----------
 *   pnpm db:backfill-synthetic-star-edges -- --dry-run   # preview, no writes
 *   pnpm db:backfill-synthetic-star-edges                # writes (idempotent)
 *
 * The `--` separator makes pnpm forward `--dry-run` to the tsx subprocess.
 * Mirrors backfill-plan-03-contracts.ts ergonomics (write by default,
 * `--dry-run` to preview); the run targets whatever `DATABASE_URL` points
 * at and is Robert's hand on the keyboard, not an automatic migrate-deploy
 * step.
 */

import { PrismaClient, Prisma } from "@prisma/client";

import {
  buildStarEdgesForScan,
  runStarBackfill,
  type ScanForBackfill,
  type StarBackfillDeps,
  type StarEdgeInput,
} from "./backfill-synthetic-star-edges.logic";

const prisma = new PrismaClient();

const BATCH_SIZE = 100;

// The fixed provenance + classification for a synthetic-star edge. STRUCTURAL
// because the star is the (trivially correct) one-hop structure; observed-
// Active is false because it is synthesised, not observed live.
const SYNTHETIC_STAR_PROVENANCE = {
  source: "SYNTHETIC_STAR",
  detail: "Plan 05 Fase 1.1 synthetic-star backfill",
} as const;

function toCreateRow(edge: StarEdgeInput): Prisma.ContractEdgeCreateManyInput {
  return {
    protocolId: edge.protocolId,
    fromContractId: edge.fromContractId,
    toContractId: edge.toContractId,
    edgeKind: "DEPENDS_ON",
    confidence: "STRUCTURAL",
    status: "ACTIVE",
    observedActive: false,
    provenance: SYNTHETIC_STAR_PROVENANCE,
  };
}

function makeLiveDeps(): StarBackfillDeps {
  return {
    async *scanBatches() {
      let cursor: string | undefined;
      for (;;) {
        const batch = await prisma.scan.findMany({
          select: {
            id: true,
            protocolId: true,
            contracts: { select: { id: true, isPrimary: true } },
          },
          orderBy: { id: "asc" },
          take: BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
        if (batch.length === 0) return;

        const mapped: ScanForBackfill[] = batch.map((s) => ({
          scanId: s.id,
          protocolId: s.protocolId,
          contracts: s.contracts,
        }));
        yield mapped;

        if (batch.length < BATCH_SIZE) return;
        cursor = batch[batch.length - 1]!.id;
      }
    },

    async persistEdges(edges, dryRun) {
      if (dryRun) {
        // Count how many of these edges already exist so the dry-run reports
        // the true would-create number (mirrors the skipDuplicates outcome).
        const existing = await prisma.contractEdge.findMany({
          where: {
            edgeKind: "DEPENDS_ON",
            OR: edges.map((e) => ({
              fromContractId: e.fromContractId,
              toContractId: e.toContractId,
            })),
          },
          select: { fromContractId: true, toContractId: true },
        });
        const have = new Set(
          existing.map((e) => `${e.fromContractId}|${e.toContractId}`),
        );
        const pending = edges.filter(
          (e) => !have.has(`${e.fromContractId}|${e.toContractId}`),
        ).length;
        return { created: 0, skipped: 0, pending };
      }

      const res = await prisma.contractEdge.createMany({
        data: edges.map(toCreateRow),
        skipDuplicates: true,
      });
      return {
        created: res.count,
        skipped: edges.length - res.count,
        pending: 0,
      };
    },

    log(line) {
      console.log(`[star-backfill] ${line}`);
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[star-backfill] DATABASE_URL is required — point it at the target DB.",
    );
    process.exit(1);
  }

  const dryRun = process.argv.includes("--dry-run");
  console.log(
    `[star-backfill] synthetic-star edge backfill — ${dryRun ? "DRY RUN" : "WRITE MODE"}`,
  );

  const summary = await runStarBackfill(makeLiveDeps(), { dryRun });

  console.log(`[star-backfill] complete: ${JSON.stringify(summary, null, 2)}`);
}

// Tests import the logic module directly; only run main() when invoked as a
// script. Re-export the pure builder for ad-hoc use.
export { buildStarEdgesForScan };

const invokedDirectly = process.argv[1]?.endsWith(
  "backfill-synthetic-star-edges.ts",
);
if (invokedDirectly) {
  main()
    .catch((e) => {
      console.error("[star-backfill] fatal error:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
