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
      className="glass-card p-6 md:p-8"
    >
      <p className="font-mono text-xs text-teal uppercase tracking-wider mb-3">
        Security scan
      </p>
      <h1
        id="scan-title"
        className="text-2xl md:text-3xl font-semibold text-primary mb-4"
      >
        {scan.protocol.displayName}
      </h1>

      <dl className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-subtle">
        <div>
          <dt className="text-xs text-muted uppercase tracking-wider font-mono mb-1">
            Chain
          </dt>
          <dd className="text-primary">{chainLabel}</dd>
        </div>

        <div>
          <dt className="text-xs text-muted uppercase tracking-wider font-mono mb-1">
            Domain
          </dt>
          <dd className="text-primary">{scan.protocol.domain ?? "—"}</dd>
        </div>

        <div>
          <dt className="text-xs text-muted uppercase tracking-wider font-mono mb-1">
            Submitted
          </dt>
          <dd className="text-primary">
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
