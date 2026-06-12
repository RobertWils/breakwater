import type { RadarGraph, RadarNode, RadarScore } from "@/components/radar/types"
import type { ContractResponse } from "@/lib/scan-response"
import { isGradedContract } from "@/lib/scoring/protocol-rollup"

/**
 * Plan 04 Phase E.1 — map a real ScanResponse to the radar's RadarGraph as a
 * STAR: the primary contract at the centre, every other (related) contract on
 * a ring, with one synthetic edge primary → related each. Edge direction
 * follows the component convention (`from` leans on `to`; contagion flows
 * `to → from`), so the primary inherits the worst related score — exactly the
 * existing worst-wins protocol scoring (see scan-to-radar.test).
 *
 * Edges do not exist in the scan data (E.0 recon); this star is honest about
 * that — it shows only the user-supplied contracts and the primary depending
 * on them, NOT multi-hop dependency analysis.
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

export function buildStarGraph(scan: { contracts: ContractResponse[] }): RadarGraph {
  const contracts = scan.contracts
  const primary = contracts.find((c) => c.isPrimary) ?? contracts[0]

  const nodes: RadarNode[] = []
  const edges: RadarGraph["edges"] = []

  if (!primary) return { nodes, edges }

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
    // Related blips are bare (no ATC label) to keep the star readable for many
    // contracts; the ContractList below carries the per-contract detail. Role
    // is retained for tooltips/future use but isn't rendered as a label.
    nodes.push({
      id: c.id,
      role: c.role,
      score: contractRadarScore(c),
      position: ringPosition(i, related.length),
      small: true,
    })
    // primary leans on each related → contagion flows related → primary.
    edges.push({ from: primary.id, to: c.id })
  })

  return { nodes, edges }
}
