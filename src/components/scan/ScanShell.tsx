"use client"

import type { ScanResponse, VisibilityTier } from "@/lib/scan-response"
import { useScanPolling } from "@/hooks/useScanPolling"

import { ScanHero } from "./ScanHero"
import { ProtocolGraphDisclaimer } from "./ProtocolGraphDisclaimer"
import { CompositePanel } from "./CompositePanel"
import { ModuleCard } from "./ModuleCard"
import { FindingsList } from "./FindingsList"
import { UnlockCTA } from "./UnlockCTA"

interface ScanShellProps {
  scan: ScanResponse
  tier: VisibilityTier
}

/**
 * Phase G.3: client wrapper around the scan results layout. Drives
 * live status updates via `useScanPolling`, which calls
 * `router.refresh()` on terminal transitions so the server-rendered
 * snapshot (findings, grade) refreshes once detection completes.
 *
 * Composite + module status copy keys off `currentStatus` (polled
 * value) for the brief window between "polling sees COMPLETE" and
 * "server refresh delivers the grade." Grade letters and findings
 * still come from the server snapshot — never invented client-side.
 */
export function ScanShell({ scan, tier }: ScanShellProps) {
  const { currentStatus, errorCount } = useScanPolling(scan.id, scan.status)

  return (
    <div className="space-y-6">
      <ScanHero scan={scan} />

      <ProtocolGraphDisclaimer />

      <CompositePanel scan={scan} currentStatus={currentStatus} />

      <section aria-labelledby="modules-heading">
        <h2 id="modules-heading" className="sr-only">
          Scan modules
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scan.modules.map((module) => (
            <ModuleCard key={module.id} module={module} />
          ))}
        </div>
      </section>

      <FindingsList
        findings={scan.findings}
        tier={tier}
        hasAnyHiddenFindings={scan.modules.some(
          (m) => (m.hiddenFindingsCount ?? 0) > 0,
        )}
      />

      {tier === "unauth" && <UnlockCTA scanId={scan.id} />}

      {errorCount > 0 && (
        <p
          role="status"
          aria-live="polite"
          className="text-center text-xs font-mono text-sev-medium"
        >
          Connection issues detected. Retrying…
        </p>
      )}
    </div>
  )
}
