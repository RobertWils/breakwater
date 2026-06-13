import type { ContractResponse } from "@/lib/scan-response"

interface ProtocolGraphDisclaimerProps {
  /**
   * Plan 05 Fase 1.6 — the scan's contracts. Supplied vs auto-discovered is
   * derived from each contract's `discoverySource` (AUTO = discovered), NOT
   * hardcoded. Absent discoverySource is treated as supplied (MANUAL).
   */
  contracts: ReadonlyArray<Pick<ContractResponse, "discoverySource">>
  /** True when a discovery source failed — surfaced so we never imply full coverage. */
  discoveryDegraded?: boolean
}

/**
 * Plan 05 Fase 1.6 — Protocol Graph disclaimer, rewritten for live discovery.
 *
 * Honesty norm (security product): the old copy claimed "you supplied" for all
 * contracts and "auto-discovery is on the roadmap" — both now false, since
 * discovery runs and some contracts are auto-discovered. This states what was
 * actually scanned (supplied + discovered, data-driven), what discovery does
 * this phase (proxy implementations + direct structural dependencies, depth 1),
 * what it does NOT yet do (transitive/multi-hop), and flags a degraded scan.
 */
export function ProtocolGraphDisclaimer({
  contracts,
  discoveryDegraded,
}: ProtocolGraphDisclaimerProps) {
  const discovered = contracts.filter((c) => c.discoverySource === "AUTO").length
  const supplied = contracts.length - discovered

  const suppliedPhrase = `${supplied} contract${supplied === 1 ? "" : "s"} you supplied`
  const discoveredPhrase =
    discovered > 0
      ? ` plus ${discovered} automatically discovered ${
          discovered === 1 ? "dependency" : "dependencies"
        }`
      : ""

  return (
    <aside
      role="note"
      aria-label="Scan scope notice"
      className="space-y-2 rounded-lg border border-sonar/15 border-l-4 border-l-sonar bg-sonar/5 px-4 py-3 text-sm text-sonar-muted"
    >
      <p>
        Breakwater scanned {suppliedPhrase}
        {discoveredPhrase} for this protocol.
      </p>
      <p>
        Automatic discovery follows proxy implementations and direct structural
        dependencies (storage slots and on-chain getters), one level deep.
        Transitive (multi-hop) dependency discovery is not yet included.
      </p>
      {discovered === 0 && (
        <p>
          Automatic discovery added no further contracts; you can also submit
          related contracts manually to expand the graph.
        </p>
      )}
      {discoveryDegraded && (
        <p className="font-medium" style={{ color: "var(--amber)" }}>
          A discovery source did not complete for this scan, so the dependency
          set below may be incomplete.
        </p>
      )}
    </aside>
  )
}
