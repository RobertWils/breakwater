import type { ModuleRunResponse } from "@/lib/scan-response"

interface ModuleCardProps {
  module: ModuleRunResponse
}

const MODULE_LABELS: Record<string, string> = {
  GOVERNANCE: "Governance",
  ORACLE: "Oracle & Bridge",
  SIGNER: "Signer Trace",
  FRONTEND: "Frontend Monitor",
}

const STATUS_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  QUEUED: {
    label: "Queued",
    color: "var(--text-muted)",
    bg: "rgba(165, 180, 205, 0.1)",
  },
  RUNNING: {
    label: "Running",
    color: "var(--accent-sky)",
    bg: "rgba(56, 189, 248, 0.1)",
  },
  COMPLETE: {
    label: "Complete",
    color: "var(--accent-teal)",
    bg: "rgba(20, 184, 166, 0.1)",
  },
  FAILED: {
    label: "Failed",
    color: "var(--sev-critical)",
    bg: "rgba(239, 68, 68, 0.1)",
  },
  SKIPPED: {
    label: "Skipped",
    color: "var(--text-muted)",
    bg: "rgba(165, 180, 205, 0.05)",
  },
}

export function ModuleCard({ module }: ModuleCardProps) {
  const label = MODULE_LABELS[module.module] ?? module.module
  const status = STATUS_STYLES[module.status] ?? STATUS_STYLES.QUEUED
  const hasGrade = module.grade !== null

  return (
    <article className="glass-card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <h3 className="text-lg font-semibold text-primary">
          {label}
        </h3>
        <span
          className="text-xs font-mono uppercase tracking-wider px-2 py-1 rounded"
          style={{ color: status.color, backgroundColor: status.bg }}
        >
          {status.label}
        </span>
      </div>

      {hasGrade ? (
        <div className="flex items-baseline gap-4 pt-2">
          <span
            className="text-5xl font-semibold [letter-spacing:-0.02em]"
            style={{ color: `var(--grade-${module.grade!.toLowerCase()})` }}
          >
            {module.grade}
          </span>
          {module.score !== null && (
            <span className="font-mono text-sm text-muted">
              {module.score}/100
            </span>
          )}
          {module.findingsCount !== null && module.findingsCount > 0 && (
            <span className="text-sm text-muted ml-auto">
              {module.findingsCount} finding{module.findingsCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      ) : module.status === "SKIPPED" ? (
        <p className="text-sm text-muted">
          Not included in this scan
        </p>
      ) : (
        <p className="text-sm text-muted">
          Awaiting detection
        </p>
      )}

      {module.errorMessage && (
        <p
          role="alert"
          className="text-xs p-3 rounded"
          style={{ color: "var(--sev-critical)", backgroundColor: "rgba(239, 68, 68, 0.1)" }}
        >
          {module.errorMessage}
        </p>
      )}
    </article>
  )
}
