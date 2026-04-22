import type { ScanResponse, VisibilityTier } from "@/lib/scan-response"
import { ScanHero } from "./ScanHero"
import { CompositePanel } from "./CompositePanel"
import { ModuleCard } from "./ModuleCard"
import { FindingsList } from "./FindingsList"
import { UnlockCTA } from "./UnlockCTA"

interface ScanShellProps {
  scan: ScanResponse
  tier: VisibilityTier
}

export function ScanShell({ scan, tier }: ScanShellProps) {
  return (
    <div className="space-y-6">
      <ScanHero scan={scan} />
      <CompositePanel scan={scan} />

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
        hasAnyHiddenFindings={scan.modules.some((m) => (m.hiddenFindingsCount ?? 0) > 0)}
      />

      {tier === "unauth" && <UnlockCTA scanId={scan.id} />}

      <section className="glass-card p-6 text-center">
        <p className="text-sm text-muted">
          Our detectors are under active development. Your scan is
          stored and will be processed when detection goes live.
        </p>
      </section>
    </div>
  )
}
