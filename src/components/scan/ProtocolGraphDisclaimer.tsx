/**
 * One-line scope-clarification banner above the composite panel.
 *
 * Plan 02 ships single-contract scanning of the submitted core address.
 * Protocol Graph discovery (bridges, OFTs / token contracts, related
 * multisigs, cross-chain deployments) is captured in NOTES.md as a
 * Plan 03+ standalone scope (~2–3 weeks). This component sets the
 * expectation up-front so users don't read the absence of related-
 * contract findings as a clean bill of health for the wider protocol.
 *
 * Styling: matches the existing `.glass-card` aesthetic with a thin
 * accent-sky left border instead of an icon (no icon library is
 * installed in Plan 02; introducing one for a single banner is
 * disproportionate).
 */

export function ProtocolGraphDisclaimer() {
  return (
    <aside
      role="note"
      aria-label="Scan scope notice"
      className="rounded-lg border border-subtle border-l-4 border-l-sky bg-elevated/30 px-4 py-3 text-sm text-muted"
    >
      Breakwater scans the submitted core contract address. Protocol-wide
      analysis (bridges, tokens, cross-chain deployments, related
      multisigs) is coming in a future release.
    </aside>
  );
}
