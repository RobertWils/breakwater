import type { ScanResponse } from "@/lib/scan-response"

interface CompositePanelProps {
  scan: ScanResponse
}

const STATUS_COPY: Record<string, { label: string; description: string; color: string }> = {
  QUEUED: {
    label: "Queued",
    description: "Your scan is in queue. Detection begins when our modules go live.",
    color: "var(--text-muted)",
  },
  RUNNING: {
    label: "Running",
    description: "Detectors are analyzing your protocol.",
    color: "var(--accent-sky)",
  },
  PARTIAL_COMPLETE: {
    label: "Partial results",
    description: "Some modules completed. Others are still running.",
    color: "var(--accent-sky)",
  },
  COMPLETE: {
    label: "Complete",
    description: "All modules finished. Review your findings below.",
    color: "var(--accent-teal)",
  },
  FAILED: {
    label: "Failed",
    description: "One or more modules encountered errors.",
    color: "var(--sev-critical)",
  },
  EXPIRED: {
    label: "Expired",
    description: "This scan is older than 30 days. Submit a new scan for current results.",
    color: "var(--text-muted)",
  },
}

export function CompositePanel({ scan }: CompositePanelProps) {
  const statusInfo = STATUS_COPY[scan.status] ?? STATUS_COPY.QUEUED
  const hasGrade = scan.compositeGrade !== null

  return (
    <section
      aria-labelledby="composite-heading"
      className="glass-card p-8 md:p-12 text-center"
    >
      <h2 id="composite-heading" className="sr-only">
        Composite scan result
      </h2>

      {hasGrade ? (
        <div>
          <p
            className="text-8xl md:text-9xl font-semibold [letter-spacing:-0.04em]"
            style={{ color: `var(--grade-${scan.compositeGrade!.toLowerCase()})` }}
          >
            {scan.compositeGrade}
          </p>
          {scan.compositeScore !== null && (
            <p className="font-mono text-sm text-muted mt-2">
              Score: {scan.compositeScore}/100
            </p>
          )}
          {scan.isPartialGrade && (
            <p className="text-xs text-sev-medium mt-2">
              Partial grade — some modules skipped
            </p>
          )}
        </div>
      ) : (
        <div className="py-8">
          <p
            className="font-mono text-sm uppercase tracking-wider mb-3"
            style={{ color: statusInfo.color }}
          >
            {statusInfo.label}
          </p>
          <p className="text-2xl md:text-3xl font-semibold text-primary max-w-2xl mx-auto">
            {statusInfo.description}
          </p>
        </div>
      )}
    </section>
  )
}
