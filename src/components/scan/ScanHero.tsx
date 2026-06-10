import type { ScanResponse } from "@/lib/scan-response"

interface ScanHeroProps {
  scan: ScanResponse
}

const CHAIN_LABELS: Record<string, string> = {
  ETHEREUM: "Ethereum",
  SOLANA: "Solana",
}

export function ScanHero({ scan }: ScanHeroProps) {
  const submittedAt = new Date(scan.createdAt)
  const chainLabel = CHAIN_LABELS[scan.protocol.chain] ?? scan.protocol.chain

  return (
    <section
      aria-labelledby="scan-title"
      className="sonar-card p-6 md:p-8"
    >
      <p className="sonar-eyebrow mb-3">Security scan</p>
      <h1
        id="scan-title"
        className="font-display text-2xl md:text-3xl font-semibold text-foam mb-4"
      >
        {scan.protocol.displayName}
      </h1>

      <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-sonar/15">
        <div>
          <dt className="label-mono mb-1">Chain</dt>
          <dd className="text-foam">{chainLabel}</dd>
        </div>

        <div>
          <dt className="label-mono mb-1">Domain</dt>
          <dd className="text-foam">{scan.protocol.domain ?? "—"}</dd>
        </div>

        <div>
          <dt className="label-mono mb-1">Submitted</dt>
          <dd className="text-foam">
            <time dateTime={scan.createdAt}>
              {submittedAt.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </time>
          </dd>
        </div>
      </dl>
    </section>
  )
}
