import type { FindingResponse, VisibilityTier } from "@/lib/scan-response"

interface FindingsListProps {
  findings: FindingResponse[]
  tier: VisibilityTier
  hasAnyHiddenFindings: boolean
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

function hasFullShape(
  f: FindingResponse,
): f is Extract<FindingResponse, { id: string }> {
  return "id" in f
}

export function FindingsList({ findings, tier, hasAnyHiddenFindings }: FindingsListProps) {
  if (findings.length === 0) {
    return (
      <section
        aria-labelledby="findings-heading"
        className="glass-card p-8 text-center"
      >
        <h2 id="findings-heading" className="text-lg font-semibold text-primary mb-2">
          Findings
        </h2>
        <p className="text-muted text-sm">
          No findings yet. Your scan is queued — results will appear here when detection completes.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="findings-heading"
      className="space-y-4"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="findings-heading" className="text-lg font-semibold text-primary">
          Findings ({findings.length})
        </h2>
        {tier === "unauth" && hasAnyHiddenFindings && (
          <p className="text-xs text-muted font-mono">
            Showing top finding per module. Enter email below to unlock all.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {findings.map((finding, idx) => {
          const severityInfo = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.INFO
          const fullShape = hasFullShape(finding)
          const key = fullShape ? finding.id : `${idx}-${finding.publicTitle}`

          return (
            <article
              key={key}
              className="glass-card p-6 space-y-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-primary">
                    {finding.publicTitle}
                  </h3>
                  {fullShape && (
                    <p className="text-xs font-mono text-muted/60 uppercase tracking-wider mt-1">
                      {finding.module} · {finding.detectorId}
                    </p>
                  )}
                </div>
                <span
                  className="text-xs font-mono uppercase tracking-wider px-2 py-1 rounded shrink-0"
                  style={{ color: severityInfo.color, backgroundColor: severityInfo.bg }}
                >
                  {severityInfo.label}
                </span>
              </div>

              {fullShape && finding.description && (
                <div className="pt-3 border-t border-subtle space-y-2">
                  <p className="text-sm text-muted leading-relaxed">
                    {finding.description}
                  </p>
                  {finding.evidence !== null && finding.evidence !== undefined && (
                    <div className="p-3 bg-elevated/30 rounded text-xs font-mono text-muted overflow-x-auto">
                      {typeof finding.evidence === "string"
                        ? finding.evidence
                        : JSON.stringify(finding.evidence, null, 2)}
                    </div>
                  )}
                </div>
              )}

              {finding.remediationHint && (
                <div className="pt-3 border-t border-subtle">
                  <p className="text-xs text-muted/60 uppercase tracking-wider font-mono mb-2">
                    Remediation
                  </p>
                  <p className="text-sm text-muted leading-relaxed">
                    {finding.remediationHint}
                  </p>
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
