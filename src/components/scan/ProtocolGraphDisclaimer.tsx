interface ProtocolGraphDisclaimerProps {
  /**
   * Plan 03 §7.4 — drives the two-variant copy. >= 2 contracts
   * renders the multi-Contract disclaimer ("Breakwater scanned N
   * contract(s) you supplied … auto-discovery on the roadmap"); 0 or
   * 1 renders the single-Contract nudge ("submit related contracts to
   * expand the graph"). The graceful adapter synthesises a single
   * contract for legacy scans, so contractCount is always >= 1 in
   * practice; the 0-fallback is defensive.
   */
  contractCount: number
}

/**
 * Plan 03 §7.4 — Protocol Graph disclaimer. Two-variant copy:
 *   - Multi-Contract (contractCount >= 2): explain that auto-discovery
 *     of related contracts (bridges, tokens, cross-chain twins) is on
 *     the roadmap.
 *   - Single-Contract (contractCount < 2): explain that the user can
 *     submit related contracts to expand the graph.
 *
 * Both variants stay non-alarming — subtle accent border, no icon —
 * since the message is informational. The component sits between
 * ScanHero and CompositePanel in ScanShell per spec.
 */
export function ProtocolGraphDisclaimer({ contractCount }: ProtocolGraphDisclaimerProps) {
  const isMulti = contractCount >= 2

  return (
    <aside
      role="note"
      aria-label="Scan scope notice"
      className="rounded-lg border border-sonar/15 border-l-4 border-l-sonar bg-sonar/5 px-4 py-3 text-sm text-sonar-muted"
    >
      {isMulti ? (
        <>
          Breakwater scanned {contractCount} contracts you supplied for this
          protocol. Automatic discovery of related contracts (bridges, token
          contracts, cross-chain twins) is on the roadmap.
        </>
      ) : (
        <>
          Breakwater scans the submitted core contract address. Submit related
          contracts (proxy implementations, multisigs, bridges) to expand the
          graph.
        </>
      )}
    </aside>
  )
}
