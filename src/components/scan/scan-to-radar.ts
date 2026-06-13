import type { RadarGraph, RadarNode, RadarScore } from "@/components/radar/types"
import type { ContractResponse } from "@/lib/scan-response"
import { isGradedContract } from "@/lib/scoring/protocol-rollup"
import { isKnownInfra } from "@/lib/scoring/known-infra"

/**
 * Plan 04 Phase E.1 — map a real ScanResponse to the radar's RadarGraph: the
 * primary contract at the centre, every other (related) contract on a ring.
 * Edge direction follows the component convention (`from` leans on `to`;
 * contagion flows `to → from`).
 *
 * Plan 05 Fase 1.3 — edges are now READ from the scan's persisted ACTIVE
 * depends-on edges (the synthetic-star rows Scope 1 backfilled, mapped 1-to-1:
 * ContractEdge.fromContractId → RadarEdge.from, toContractId → to; RadarNode.id
 * = Contract row id). The mapper no longer synthesises the star as its primary
 * path — it reads the real graph, which resolveContagion already consumes.
 *
 * Fallback: when a scan has NO persisted ACTIVE edges (a scan created after the
 * Scope-1 backfill — submitScan doesn't write edges until Fase 2 — or an N=1
 * scan with no siblings) the mapper SYNTHESISES the star, exactly as before.
 * The backfilled synthetic-star edges are byte-identical to that synthesis, so
 * an existing scan renders the same nodes + edges + grade before and after the
 * swap; the fallback guarantees correctness for scans that don't yet have edges.
 */

const RING_RADIUS = 32 // percent of the scope, from the centre

/**
 * compositeGrade letter → radar score. Grades are A/B/C/D/F (no E). Mapping is
 * monotonic with severity so the worst grade always yields the worst radar
 * score — the property the star-contagion ≡ worst-wins equivalence relies on:
 *   A, B → safe (green)
 *   C, D → moderate (amber)
 *   F    → unsafe (red)
 *   null / unknown (SKIPPED / FAILED / not-yet-graded) → null
 */
export function gradeToRadarScore(grade: string | null | undefined): RadarScore {
  switch (grade) {
    case "A":
    case "B":
      return "safe"
    case "C":
    case "D":
      return "moderate"
    case "F":
      return "unsafe"
    default:
      return null
  }
}

/**
 * A contract's radar score, gated by the SAME eligibility rule the protocol
 * rollup uses (`isGradedContract`): a colour (safe/moderate/unsafe) only when
 * both grade AND score are non-null; otherwise null (neutral). This keeps the
 * radar's eligibility set identical to rollupProtocolComposite's, so the
 * star-contagion can never show a worse colour than the scoring concludes.
 */
function contractRadarScore(c: ContractResponse): RadarScore {
  // Plan 05 Fase 1.2 — KNOWN_INFRA nodes contribute no own-score to the
  // contagion fold (the SAME `isKnownInfra` hook the rollup uses, so the
  // radar and the persisted scorer exclude exactly the same nodes). Empty
  // allowlist today ⇒ no-op ⇒ unchanged radar.
  if (isKnownInfra(c.address)) return null
  return isGradedContract(c) ? gradeToRadarScore(c.compositeGrade) : null
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** Evenly space related nodes on a ring around the centre (start at the top). */
function ringPosition(index: number, count: number): { x: number; y: number } {
  if (count <= 0) return { x: 50, y: 50 }
  const angle = (2 * Math.PI * index) / count - Math.PI / 2
  return {
    x: 50 + RING_RADIUS * Math.cos(angle),
    y: 50 + RING_RADIUS * Math.sin(angle),
  }
}

export function buildStarGraph(scan: {
  contracts: ContractResponse[]
  /** Persisted ACTIVE depends-on edges (Contract.id → Contract.id). */
  edges?: { from: string; to: string }[]
}): RadarGraph {
  const contracts = scan.contracts
  const primary = contracts.find((c) => c.isPrimary) ?? contracts[0]

  const nodes: RadarNode[] = []

  if (!primary) return { nodes, edges: [] }

  nodes.push({
    id: primary.id,
    label: shortAddress(primary.address),
    sublabel: primary.role,
    role: primary.role,
    score: contractRadarScore(primary),
    position: { x: 50, y: 50 },
    isPrimary: true,
  })

  const related = contracts.filter((c) => c.id !== primary.id)
  related.forEach((c, i) => {
    // Plan 05 Fase 1.6 — label every node so a discovered sibling (an
    // implementation, oracle, …) is identifiable on the radar, not a bare dot:
    // label = short address (like the primary's), sublabel = role. An
    // AUTO-discovered node gets a "· auto" provenance hint. Desktop renders the
    // label+sublabel; mobile keeps only the primary's tag (Radar handles that),
    // so the busy radar stays readable on small screens.
    const isAuto = c.discoverySource === "AUTO"
    nodes.push({
      id: c.id,
      label: shortAddress(c.address),
      sublabel: isAuto ? `${c.role} · auto` : c.role,
      role: c.role,
      score: contractRadarScore(c),
      position: ringPosition(i, related.length),
      small: true,
    })
  })

  // Plan 05 Fase 1.3 — read the persisted ACTIVE edges (1-to-1 map); fall back
  // to synthesising the star ONLY when none exist. The backfilled synthetic
  // star is `primary → each related`, byte-identical to the fallback, so an
  // existing scan is unchanged. resolveContagion ignores edges that reference
  // ids outside the node set, so the mapping needs no extra filtering.
  const edges: RadarGraph["edges"] =
    scan.edges && scan.edges.length > 0
      ? scan.edges.map((e) => ({ from: e.from, to: e.to }))
      : related.map((c) => ({ from: primary.id, to: c.id }))

  return { nodes, edges }
}
