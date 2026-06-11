// @vitest-environment node
/**
 * Plan 05 Fase 1.1 — synthetic-star backfill unit tests.
 *
 * Pure edge-builder + DI-orchestrator tests. NO database — the IO is
 * injected (`StarBackfillDeps`) and exercised against an in-memory edge
 * store so the orchestration behaviour (per-scan star construction,
 * idempotency, dry-run no-write) is asserted on resulting state, not mock
 * call counts. The real Prisma wiring lives in
 * `backfill-synthetic-star-edges.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  buildStarEdgesForScan,
  runStarBackfill,
  type PersistResult,
  type ScanForBackfill,
  type StarBackfillDeps,
  type StarEdgeInput,
} from "../backfill-synthetic-star-edges.logic";

function scan(
  scanId: string,
  protocolId: string,
  contracts: { id: string; isPrimary: boolean }[],
): ScanForBackfill {
  return { scanId, protocolId, contracts };
}

describe("buildStarEdgesForScan", () => {
  it("emits one primary->sibling edge per non-primary contract", () => {
    const edges = buildStarEdgesForScan(
      scan("s1", "p1", [
        { id: "c-primary", isPrimary: true },
        { id: "c-a", isPrimary: false },
        { id: "c-b", isPrimary: false },
        { id: "c-c", isPrimary: false },
      ]),
    );
    expect(edges).toEqual([
      { protocolId: "p1", fromContractId: "c-primary", toContractId: "c-a" },
      { protocolId: "p1", fromContractId: "c-primary", toContractId: "c-b" },
      { protocolId: "p1", fromContractId: "c-primary", toContractId: "c-c" },
    ]);
  });

  it("emits no edges for a primary-only scan", () => {
    expect(
      buildStarEdgesForScan(scan("s1", "p1", [{ id: "c-primary", isPrimary: true }])),
    ).toEqual([]);
  });

  it("emits no edges for a scan with no contracts", () => {
    expect(buildStarEdgesForScan(scan("s1", "p1", []))).toEqual([]);
  });

  it("falls back to the first contract as primary when no isPrimary flag is set (mirrors buildStarGraph)", () => {
    const edges = buildStarEdgesForScan(
      scan("s1", "p1", [
        { id: "c-0", isPrimary: false },
        { id: "c-1", isPrimary: false },
      ]),
    );
    expect(edges).toEqual([
      { protocolId: "p1", fromContractId: "c-0", toContractId: "c-1" },
    ]);
  });
});

// ─── DI orchestrator against an in-memory edge store ───────────────────────

function makeWorld() {
  const store = new Set<string>(); // `${from}|${to}` keys (edgeKind fixed)
  const key = (e: StarEdgeInput) => `${e.fromContractId}|${e.toContractId}`;
  const logs: string[] = [];

  function batches(scans: ScanForBackfill[]): StarBackfillDeps["scanBatches"] {
    return async function* () {
      yield scans; // single batch is enough for the orchestration assertions
    };
  }

  const makeDeps = (scans: ScanForBackfill[]): StarBackfillDeps => ({
    scanBatches: batches(scans),
    async persistEdges(edges, dryRun): Promise<PersistResult> {
      if (dryRun) {
        const pending = edges.filter((e) => !store.has(key(e))).length;
        return { created: 0, skipped: 0, pending };
      }
      let created = 0;
      let skipped = 0;
      for (const e of edges) {
        if (store.has(key(e))) skipped += 1;
        else {
          store.add(key(e));
          created += 1;
        }
      }
      return { created, skipped, pending: 0 };
    },
    log: (line) => logs.push(line),
  });

  return { store, makeDeps, logs };
}

const SCANS: ScanForBackfill[] = [
  scan("s1", "p1", [
    { id: "s1-primary", isPrimary: true },
    { id: "s1-a", isPrimary: false },
    { id: "s1-b", isPrimary: false },
  ]),
  scan("s2", "p2", [
    { id: "s2-primary", isPrimary: true },
    { id: "s2-a", isPrimary: false },
  ]),
];

describe("runStarBackfill (orchestrator)", () => {
  it("creates every scan's synthetic-star edges", async () => {
    const w = makeWorld();
    const summary = await runStarBackfill(w.makeDeps(SCANS), {});

    expect(summary.scansEvaluated).toBe(2);
    expect(summary.edgesPlanned).toBe(3); // 2 + 1
    expect(summary.edgesCreated).toBe(3);
    expect(summary.edgesSkipped).toBe(0);
    expect(w.store.size).toBe(3);
    expect(w.store.has("s1-primary|s1-a")).toBe(true);
    expect(w.store.has("s2-primary|s2-a")).toBe(true);
  });

  it("is idempotent — a second run creates nothing and skips all", async () => {
    const w = makeWorld();
    await runStarBackfill(w.makeDeps(SCANS), {});
    const second = await runStarBackfill(w.makeDeps(SCANS), {});

    expect(second.edgesCreated).toBe(0);
    expect(second.edgesSkipped).toBe(3);
    expect(w.store.size).toBe(3); // no duplicates
  });

  it("dry-run writes nothing and reports what it would create", async () => {
    const w = makeWorld();
    const summary = await runStarBackfill(w.makeDeps(SCANS), { dryRun: true });

    expect(summary.edgesPending).toBe(3);
    expect(summary.edgesCreated).toBe(0);
    expect(w.store.size).toBe(0); // no writes
  });

  it("counts a primary-only scan as evaluated with zero planned edges", async () => {
    const w = makeWorld();
    const summary = await runStarBackfill(
      w.makeDeps([scan("s3", "p3", [{ id: "s3-primary", isPrimary: true }])]),
      {},
    );
    expect(summary.scansEvaluated).toBe(1);
    expect(summary.edgesPlanned).toBe(0);
    expect(summary.edgesCreated).toBe(0);
  });
});
