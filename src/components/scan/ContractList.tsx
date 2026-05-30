import type { ContractResponse } from "@/lib/scan-response"

import { ContractCard } from "./ContractCard"

interface ContractListProps {
  contracts: ContractResponse[]
}

/**
 * Plan 03 §7.4 — renders one ContractCard per scan Contract. The
 * response builder (`scan-response.ts`) already sorts the contracts
 * (PRIMARY first, then role priority, then address); ContractList
 * just iterates in the supplied order so the sort is one place not
 * two.
 *
 * Hidden when contracts is empty — the FindingsList empty-state and
 * CompositePanel already explain a results-pending scan; an empty
 * ContractList section would just add noise.
 */
export function ContractList({ contracts }: ContractListProps) {
  if (contracts.length === 0) return null

  return (
    <section
      aria-labelledby="contracts-heading"
      className="space-y-4"
    >
      <h2
        id="contracts-heading"
        className="text-lg font-semibold text-primary"
      >
        Contracts ({contracts.length})
      </h2>
      <div className="space-y-4">
        {contracts.map((c) => (
          <ContractCard key={c.id} contract={c} />
        ))}
      </div>
    </section>
  )
}
