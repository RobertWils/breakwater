import type { ScanResponse } from "@/lib/scan-response"

interface CompositePanelProps {
  scan: ScanResponse
  /**
   * Optional client-side status override (Plan 02 G.3, carried over).
   * Used by `ScanShell` to feed the latest polling result so the
   * status-copy lookup reflects the current state without waiting for
   * the server-side snapshot refresh. Grade rendering still keys off
   * `scan.compositeGrade` (server data); the override only affects
   * the status-text fallback shown when no grade is present yet.
   */
  currentStatus?: string
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

/**
 * Protocol-level composite display. Renders two lines:
 *   1. Protocol grade letter (worst-grade-wins across ELIGIBLE
 *      Contracts; Phase F.1 §6.2).
 *   2. Protocol score: X/100 — the worst-wins number (global minimum
 *      composite score across eligible Contracts; Scan.worstContractScore,
 *      Plan 04 §2).
 *
 * Plan 04 §2: the number is worst-wins, so it can never tell a kinder
 * story than the letter. The Plan 03 "average contract score" line was
 * removed — surfacing the mean alongside a worst-wins letter let one
 * F-contract hide behind several A's (F + 75), which the §2 model
 * forbids. `Scan.averageContractScore` is retained as honest backend
 * data but is no longer surfaced here.
 *
 * Partial affordance: appended when isPartialGrade OR
 * isPartialCoverage is true (spec §6.3 two-clause partial semantics).
 * Reason text in the title attribute differentiates the two clauses
 * for a curious user.
 */
export function CompositePanel({ scan, currentStatus }: CompositePanelProps) {
  const effectiveStatus = currentStatus ?? scan.status
  const statusInfo = STATUS_COPY[effectiveStatus] ?? STATUS_COPY.QUEUED
  const hasGrade = scan.compositeGrade !== null

  const partialReason = derivePartialReason(scan)

  return (
    <section
      aria-labelledby="composite-heading"
      className="glass-card p-8 md:p-12 text-center"
    >
      <h2 id="composite-heading" className="sr-only">
        Protocol composite scan result
      </h2>

      {hasGrade ? (
        <div>
          <p className="font-mono text-xs uppercase tracking-wider text-muted mb-3">
            Protocol grade
          </p>
          <p
            className="text-8xl md:text-9xl font-semibold [letter-spacing:-0.04em]"
            style={{ color: `var(--grade-${scan.compositeGrade!.toLowerCase()})` }}
          >
            {scan.compositeGrade}
          </p>
          {scan.worstContractScore !== null && (
            <dl className="mt-6 max-w-md mx-auto text-left">
              <div>
                <dt className="font-mono text-xs uppercase tracking-wider text-muted">
                  Protocol score
                </dt>
                <dd className="font-mono text-sm text-primary">
                  {scan.worstContractScore}/100
                </dd>
              </div>
            </dl>
          )}
          {partialReason && (
            <p
              className="text-xs text-sev-medium mt-4"
              title={partialReason.tooltip}
            >
              {partialReason.label}
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

/**
 * Spec §6.3 two-clause partial semantics surface together: the UI
 * shows one badge with both reasons in the tooltip. If both flags
 * are true, the badge calls out coverage gap first (more impactful
 * to scan-grade interpretation) and the tooltip mentions both.
 */
function derivePartialReason(
  scan: ScanResponse,
): { label: string; tooltip: string } | null {
  if (scan.isPartialCoverage && scan.isPartialGrade) {
    return {
      label: "Partial — coverage gap + detector errors",
      tooltip:
        "Some Contracts failed and were excluded from the protocol grade; some modules also had detector errors.",
    }
  }
  if (scan.isPartialCoverage) {
    return {
      label: "Partial coverage — some contracts failed",
      tooltip:
        "One or more Contracts failed and were excluded from the protocol grade. The grade is honest about the contracts that did finish.",
    }
  }
  if (scan.isPartialGrade) {
    return {
      label: "Partial grade — detector errors",
      tooltip:
        "At least one module had detector errors. The grade is real but coverage is incomplete.",
    }
  }
  return null
}
