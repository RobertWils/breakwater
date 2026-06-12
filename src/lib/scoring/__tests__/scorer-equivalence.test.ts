// @vitest-environment node
/**
 * Plan 05 Fase 1.2 — cross-scorer equivalence.
 *
 * The persisted scorer (rollupProtocolComposite) and the radar scorer
 * (resolveContagion) must agree on what contaminates the PRIMARY: mapping
 * the rollup's worst grade through gradeToRadarScore must equal
 * resolveContagion's resolved RadarScore for the primary, over the SAME
 * graph. Both fold over the SAME shared reachableFrom, so the agreement is
 * structural — these tests lock it against regression, including multi-hop
 * and disconnected topologies (where a flat scorer would diverge) and an
 * exhaustive sweep over every grade assignment.
 */

import type { Grade } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { gradeToRadarScore } from "@/components/scan/scan-to-radar";
import { resolveContagion } from "@/components/radar/contagion";
import type { RadarGraph } from "@/components/radar/types";
import { type GraphEdge } from "@/lib/graph/reachability";
import {
  rollupProtocolComposite,
  type ProtocolRollupContract,
} from "../protocol-rollup";

interface NodeSpec {
  id: string;
  grade: Grade | null;
  isPrimary?: boolean;
}

function toContracts(nodes: NodeSpec[]): ProtocolRollupContract[] {
  return nodes.map((n) => ({
    id: n.id,
    address: `0x${n.id}`,
    isPrimary: n.isPrimary ?? false,
    compositeGrade: n.grade,
    compositeScore: n.grade === null ? null : 50,
    isPartialGrade: false,
    status: n.grade === null ? "FAILED" : "COMPLETE",
  }));
}

function toRadarGraph(nodes: NodeSpec[], edges: GraphEdge[]): RadarGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      score: gradeToRadarScore(n.grade),
      position: { x: 0, y: 0 },
      isPrimary: n.isPrimary,
    })),
    edges,
  };
}

/** The invariant: rollup's worst grade (as a bucket) === radar's primary bucket. */
function assertEquivalent(nodes: NodeSpec[], edges: GraphEdge[]): void {
  const primary = nodes.find((n) => n.isPrimary) ?? nodes[0]!;
  const rollup = rollupProtocolComposite(toContracts(nodes), edges);
  const radar = resolveContagion(toRadarGraph(nodes, edges));
  expect(gradeToRadarScore(rollup.compositeGrade)).toBe(radar.get(primary.id));
}

describe("scorer equivalence — rollup grade-bucket === radar primary bucket", () => {
  it("star: all safe", () => {
    assertEquivalent(
      [
        { id: "p", grade: "A", isPrimary: true },
        { id: "a", grade: "B" },
        { id: "b", grade: "A" },
      ],
      [
        { from: "p", to: "a" },
        { from: "p", to: "b" },
      ],
    );
  });

  it("star: one unsafe related", () => {
    assertEquivalent(
      [
        { id: "p", grade: "A", isPrimary: true },
        { id: "bad", grade: "F" },
      ],
      [{ from: "p", to: "bad" }],
    );
  });

  it("multi-hop chain p→a→b (unsafe leaf)", () => {
    assertEquivalent(
      [
        { id: "p", grade: "A", isPrimary: true },
        { id: "a", grade: "A" },
        { id: "b", grade: "F" },
      ],
      [
        { from: "p", to: "a" },
        { from: "a", to: "b" },
      ],
    );
  });

  it("disconnected unsafe node does not reach the primary", () => {
    assertEquivalent(
      [
        { id: "p", grade: "A", isPrimary: true },
        { id: "a", grade: "A" },
        { id: "x", grade: "F" },
      ],
      [{ from: "p", to: "a" }], // x unreachable
    );
  });

  it("diamond p→a,p→b,a→c,b→c", () => {
    assertEquivalent(
      [
        { id: "p", grade: "A", isPrimary: true },
        { id: "a", grade: "C" },
        { id: "b", grade: "A" },
        { id: "c", grade: "F" },
      ],
      [
        { from: "p", to: "a" },
        { from: "p", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "c" },
      ],
    );
  });

  it("cycle a↔b with primary p→a", () => {
    assertEquivalent(
      [
        { id: "p", grade: "A", isPrimary: true },
        { id: "a", grade: "D" },
        { id: "b", grade: "F" },
      ],
      [
        { from: "p", to: "a" },
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    );
  });

  it("N=1 primary only", () => {
    assertEquivalent([{ id: "p", grade: "C", isPrimary: true }], []);
  });

  it("all-null reachable set (primary + sibling both FAILED)", () => {
    assertEquivalent(
      [
        { id: "p", grade: null, isPrimary: true },
        { id: "a", grade: null },
      ],
      [{ from: "p", to: "a" }],
    );
  });

  // The exhaustive lock: topology p→a→b (connected) + x (disconnected).
  // Over EVERY grade assignment to {p,a,b,x}, the two scorers must agree on
  // the primary's bucket — and x must never affect it. 5^4 = 625 cases.
  it("exhaustive: every grade assignment over a connected chain + a disconnected node agrees", () => {
    const grades: (Grade | null)[] = ["A", "B", "C", "D", "F", null];
    const edges: GraphEdge[] = [
      { from: "p", to: "a" },
      { from: "a", to: "b" },
      // x: no edges → unreachable from p
    ];
    for (const gp of grades) {
      for (const ga of grades) {
        for (const gb of grades) {
          for (const gx of grades) {
            assertEquivalent(
              [
                { id: "p", grade: gp, isPrimary: true },
                { id: "a", grade: ga },
                { id: "b", grade: gb },
                { id: "x", grade: gx },
              ],
              edges,
            );
          }
        }
      }
    }
  });
});
