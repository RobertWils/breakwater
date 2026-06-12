import type {
  ContractResponse,
  FindingResponse,
  VisibilityTier,
} from "@/lib/scan-response"

interface FindingsListProps {
  findings: FindingResponse[]
  /**
   * Plan 03 §7.4 — per-Contract grouping. FindingsList renders one
   * section per Contract that has findings; the contract header
   * provides label + role + truncated address. Pass the contracts
   * from the response (already sorted by the response builder).
   */
  contracts: ContractResponse[]
  tier: VisibilityTier
  /**
   * Current scan status (Plan 02 G.5 N2 carry-over). Drives the
   * empty-state copy so a COMPLETE scan with zero findings reads
   * "No findings detected" rather than the stale "queued" wording.
   */
  status: string
  hasAnyHiddenFindings: boolean
}

const ROLE_LABELS: Record<ContractResponse["role"], string> = {
  PRIMARY: "Primary",
  PROXY_IMPLEMENTATION: "Proxy implementation",
  DECLARED_MULTISIG: "Multisig",
  TIMELOCK: "Timelock",
  TOKEN_CONTRACT: "Token contract",
  DECLARED_BRIDGE: "Bridge",
  RELATED: "Related",
}

function truncateAddress(address: string): string {
  if (address.length <= 14) return address
  return `${address.slice(0, 8)}…${address.slice(-4)}`
}

function emptyStateMessage(status: string): string {
  if (status === "COMPLETE") return "No findings detected."
  if (status === "FAILED") return "Scan failed. Findings unavailable."
  if (status === "EXPIRED")
    return "This scan has expired. Findings are no longer available."
  return "Results will appear here when detection completes."
}

const SEVERITY_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  CRITICAL: {
    label: "Critical",
    color: "var(--sev-critical)",
    bg: "rgba(239, 68, 68, 0.12)",
  },
  HIGH: {
    label: "High",
    color: "var(--sev-high)",
    bg: "rgba(249, 115, 22, 0.12)",
  },
  MEDIUM: {
    label: "Medium",
    color: "var(--sev-medium)",
    bg: "rgba(245, 158, 11, 0.12)",
  },
  LOW: {
    label: "Low",
    color: "var(--sev-low)",
    bg: "rgba(96, 165, 250, 0.12)",
  },
  INFO: {
    label: "Info",
    color: "var(--sev-info)",
    bg: "rgba(148, 163, 184, 0.12)",
  },
}

/**
 * Plan 02 G.4 — narrow on the `tier` discriminator. Email + Paid share
 * the full-shape rendering today; PAID-specific surfacing of
 * `remediationDetailed` lands when Plan 07+ wires the Subscription
 * route boundary (see NOTES.md).
 */
function hasFullShape(
  f: FindingResponse,
): f is Extract<FindingResponse, { id: string }> {
  return f.tier === "EMAIL" || f.tier === "PAID"
}

export function FindingsList({
  findings,
  contracts,
  tier,
  status,
  hasAnyHiddenFindings,
}: FindingsListProps) {
  if (findings.length === 0) {
    return (
      <section
        aria-labelledby="findings-heading"
        className="sonar-card p-8 text-center"
      >
        <h2 id="findings-heading" className="font-display text-lg font-semibold text-foam mb-2">
          Findings
        </h2>
        <p className="text-sonar-muted text-sm">{emptyStateMessage(status)}</p>
      </section>
    )
  }

  // Phase G.4: group findings by contractId per spec §7.4. The
  // response builder returns contracts pre-sorted (PRIMARY first → role
  // priority → address); preserve that order for the rendered sections.
  // Findings whose contractId doesn't match any contract in `contracts`
  // collapse into ONE "Other findings" section at the end (Phase G
  // remediation #2 / Codex Review #5 NTH 2 — multiple orphan buckets
  // previously produced duplicate `id="findings-unassoc-heading"` ARIA
  // labels, weakening the nested-region structure). Post-PR-2
  // (§3.5) Finding.contractId is NOT NULL, so this is purely defensive
  // (e.g. an id that doesn't resolve to a loaded contract); the `?? null`
  // bucket key below is kept as a harmless guard.
  const findingsByContractId = new Map<string | null, FindingResponse[]>()
  for (const f of findings) {
    const key = f.contractId ?? null
    const bucket = findingsByContractId.get(key) ?? []
    bucket.push(f)
    findingsByContractId.set(key, bucket)
  }

  const sections: { contract: ContractResponse | null; items: FindingResponse[] }[] = []
  for (const c of contracts) {
    const items = findingsByContractId.get(c.id)
    if (items && items.length > 0) {
      sections.push({ contract: c, items })
      findingsByContractId.delete(c.id)
    }
  }
  // Collapse all remaining buckets (orphan contractIds) into a single
  // "Other findings" section so the DOM never carries duplicate
  // headings, regardless of how many distinct orphan ids appear.
  const orphans: FindingResponse[] = []
  for (const [, items] of Array.from(findingsByContractId.entries())) {
    if (items.length > 0) orphans.push(...items)
  }
  if (orphans.length > 0) {
    sections.push({ contract: null, items: orphans })
  }

  return (
    <section
      aria-labelledby="findings-heading"
      className="space-y-4"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="findings-heading" className="font-display text-lg font-semibold text-foam">
          Findings ({findings.length})
        </h2>
        {tier === "unauth" && hasAnyHiddenFindings && (
          <p className="text-xs text-sonar-muted font-data">
            Showing top finding per module. Enter email below to unlock all.
          </p>
        )}
      </div>

      <div className="space-y-6">
        {sections.map((section) => (
          <FindingSection
            // Single orphan bucket → stable "orphan" key; no need for
            // an index because we never produce more than one orphan
            // section per render.
            key={section.contract?.id ?? "orphan"}
            contract={section.contract}
            findings={section.items}
          />
        ))}
      </div>
    </section>
  )
}

function FindingSection({
  contract,
  findings,
}: {
  contract: ContractResponse | null
  findings: FindingResponse[]
}) {
  const headingId = contract
    ? `findings-${contract.id}-heading`
    : "findings-other-heading"
  const roleLabel = contract
    ? ROLE_LABELS[contract.role] ?? contract.role
    : null

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-3"
    >
      <header className="pb-2 border-b border-sonar/15">
        <h3
          id={headingId}
          className="font-display text-sm font-semibold text-foam"
        >
          {contract?.label ?? roleLabel ?? "Other findings"}
        </h3>
        {contract && (
          <p className="text-xs font-data text-sonar-muted/70 mt-1">
            <span className="uppercase tracking-wider">{roleLabel}</span>
            <span aria-hidden="true"> · </span>
            <span title={contract.address}>{truncateAddress(contract.address)}</span>
          </p>
        )}
      </header>

      {findings.map((finding, idx) => {
        const severityInfo = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.INFO
        const fullShape = hasFullShape(finding)
        const key = fullShape ? finding.id : `${idx}-${finding.publicTitle}`

        return (
          <article
            key={key}
            className="sonar-card p-6 space-y-3"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h4 className="font-display text-base font-semibold text-foam">
                  {finding.publicTitle}
                </h4>
                {fullShape && (
                  <p className="text-xs font-data text-sonar-muted/60 uppercase tracking-wider mt-1">
                    {finding.module} · {finding.detectorId}
                  </p>
                )}
              </div>
              <span
                className="text-xs font-data uppercase tracking-wider px-2 py-1 rounded shrink-0"
                style={{ color: severityInfo.color, backgroundColor: severityInfo.bg }}
              >
                {severityInfo.label}
              </span>
            </div>

            {fullShape && finding.description && (
              <div className="pt-3 border-t border-sonar/15 space-y-2">
                <p className="text-sm text-sonar-muted leading-relaxed">
                  {finding.description}
                </p>
                {finding.evidence !== null && finding.evidence !== undefined && (
                  <div className="p-3 bg-sonar/5 rounded text-xs font-data text-sonar-muted overflow-x-auto">
                    {typeof finding.evidence === "string"
                      ? finding.evidence
                      : JSON.stringify(finding.evidence, null, 2)}
                  </div>
                )}
              </div>
            )}

            {finding.remediationHint && (
              <div className="pt-3 border-t border-sonar/15">
                <p className="text-xs text-sonar-muted/60 uppercase tracking-wider font-data mb-2">
                  Remediation
                </p>
                <p className="text-sm text-sonar-muted leading-relaxed">
                  {finding.remediationHint}
                </p>
              </div>
            )}
          </article>
        )
      })}
    </section>
  )
}
