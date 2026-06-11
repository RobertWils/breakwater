/**
 * Plan 05 Fase 1.1 — pure logic + DI orchestrator for the synthetic-star
 * edge backfill.
 *
 * IO-free by design: the only side effects (scan enumeration, edge
 * persistence, logging) are injected via `StarBackfillDeps`, so the
 * orchestration is unit-testable without a database. The real Prisma
 * wiring lives in `backfill-synthetic-star-edges.ts`.
 *
 * WHAT IT DOES: for every existing Scan, create one `ContractEdge`
 * primary->sibling per non-primary Contract — i.e. the exact star
 * `buildStarGraph` synthesises today (`src/components/scan/scan-to-radar.ts`).
 * Persisting that star makes each existing protocol's grade BIT-IDENTICAL
 * once a later scope runs the graph scorer over these edges instead of the
 * synthetic star (Plan 05 §5.4). This is the ONLY edge creation in Fase 1
 * and is star-shaped by construction (only primary->sibling).
 *
 * Primary selection MIRRORS `buildStarGraph` exactly (`find(isPrimary) ??
 * contracts[0]`) so the persisted edges equal the synthesised ones — the
 * bit-identical guarantee depends on this.
 */

export interface ScanForBackfill {
  scanId: string;
  protocolId: string;
  contracts: { id: string; isPrimary: boolean }[];
}

export interface StarEdgeInput {
  protocolId: string;
  /** The primary (the dependent). Contagion flows `to -> from`. */
  fromContractId: string;
  /** A sibling the primary leans on. */
  toContractId: string;
}

/**
 * The synthetic-star edges for one scan: primary -> each non-primary
 * contract. Empty when the scan has zero or one contract. Mirrors
 * `buildStarGraph`'s primary selection so the persisted star is identical
 * to the rendered one.
 */
export function buildStarEdgesForScan(scan: ScanForBackfill): StarEdgeInput[] {
  const { contracts } = scan;
  const primary = contracts.find((c) => c.isPrimary) ?? contracts[0];
  if (!primary) return [];
  return contracts
    .filter((c) => c.id !== primary.id)
    .map((c) => ({
      protocolId: scan.protocolId,
      fromContractId: primary.id,
      toContractId: c.id,
    }));
}

export interface PersistResult {
  /** Edges newly inserted (write mode). */
  created: number;
  /** Edges that already existed and were skipped (write mode, idempotency). */
  skipped: number;
  /** Edges a dry-run would create (dry-run only; 0 in write mode). */
  pending: number;
}

/**
 * Injected side effects. The real implementations (Prisma cursor
 * enumeration + `createMany skipDuplicates`) live in the script; tests
 * pass an in-memory edge store.
 */
export interface StarBackfillDeps {
  /** Enumerate all scans in batches (cursor-paginated in the real impl). */
  scanBatches(): AsyncIterable<ScanForBackfill[]>;
  /**
   * Persist a scan's star edges. Idempotent: edges that already exist are
   * skipped (real impl relies on the `(from, to, edgeKind)` unique +
   * `skipDuplicates`). In dry-run, writes nothing and reports `pending`.
   */
  persistEdges(edges: StarEdgeInput[], dryRun: boolean): Promise<PersistResult>;
  log(line: string): void;
}

export interface StarBackfillOptions {
  dryRun?: boolean;
}

export interface StarBackfillSummary {
  scansEvaluated: number;
  edgesPlanned: number;
  edgesCreated: number;
  edgesSkipped: number;
  /** Dry-run: edges that would be created. */
  edgesPending: number;
}

function newSummary(): StarBackfillSummary {
  return {
    scansEvaluated: 0,
    edgesPlanned: 0,
    edgesCreated: 0,
    edgesSkipped: 0,
    edgesPending: 0,
  };
}

/**
 * Backfill synthetic-star edges across every scan. Idempotent (re-running
 * creates no duplicates), dry-runnable, auditable. Returns a summary for
 * the CLI and tests.
 */
export async function runStarBackfill(
  deps: StarBackfillDeps,
  opts: StarBackfillOptions = {},
): Promise<StarBackfillSummary> {
  const dryRun = opts.dryRun ?? false;
  const summary = newSummary();

  for await (const batch of deps.scanBatches()) {
    for (const scan of batch) {
      summary.scansEvaluated += 1;

      const edges = buildStarEdgesForScan(scan);
      if (edges.length === 0) {
        deps.log(`[${scan.scanId}] no related contracts — 0 star edges`);
        continue;
      }

      summary.edgesPlanned += edges.length;
      const res = await deps.persistEdges(edges, dryRun);
      summary.edgesCreated += res.created;
      summary.edgesSkipped += res.skipped;
      summary.edgesPending += res.pending;

      deps.log(
        dryRun
          ? `[${scan.scanId}] would create ${res.pending}/${edges.length} star edges`
          : `[${scan.scanId}] created ${res.created}, skipped ${res.skipped} (already present)`,
      );
    }
  }

  return summary;
}
