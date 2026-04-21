const VECTORS = [
  {
    title: "Governance",
    summary: "Proposal hijacks, timelock gaps, admin-key takeovers.",
    example: "Drift post-mortem",
    detectorIds: ["GOV-001", "GOV-003", "GOV-008"],
  },
  {
    title: "Oracle & Bridge",
    summary: "Stale feeds, decimals mismatches, cross-chain message replay.",
    example: "Kelp DAO post-mortem",
    detectorIds: ["ORC-001", "ORC-004", "ORC-012"],
  },
  {
    title: "Signer Trace",
    summary: "Multisig compromise, hot-wallet leaks, upgrade-key abuse.",
    example: "Step Finance post-mortem",
    detectorIds: ["SIG-001", "SIG-002", "SIG-007"],
  },
  {
    title: "Frontend Monitor",
    summary: "Domain hijacks, injected scripts, malicious approvals.",
    example: "CoW Swap post-mortem",
    detectorIds: ["FRO-001", "FRO-003", "FRO-005"],
  },
]

export function VectorSection() {
  return (
    <section id="vector" className="py-24 border-t border-subtle">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="text-center mb-12 space-y-3">
          <p className="font-mono text-sm text-teal uppercase tracking-wider">
            Attack surface coverage
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold text-primary">
            Four vectors. One continuous scan.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {VECTORS.map((v) => (
            <div key={v.title} className="glass-card p-6 space-y-4 group">
              <h3 className="text-lg font-semibold text-primary">{v.title}</h3>
              <p className="text-sm text-muted leading-relaxed">{v.summary}</p>
              <p className="font-mono text-xs text-teal">{v.example}</p>
              <div className="flex flex-wrap gap-1.5">
                {v.detectorIds.map((id) => (
                  <span
                    key={id}
                    className="font-mono text-xs text-muted opacity-100 md:opacity-40 md:group-hover:opacity-100 transition-opacity duration-200 bg-elevated px-1.5 py-0.5 rounded"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
