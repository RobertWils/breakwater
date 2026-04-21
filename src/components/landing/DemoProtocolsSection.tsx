import Link from "next/link"

const DEMO_PROTOCOLS = [
  {
    slug: "aave-v3-ethereum",
    displayName: "Aave V3",
    chain: "Ethereum",
    initials: "AV3",
    gradient: "linear-gradient(135deg, var(--accent-teal), var(--accent-sky))",
    label: "Live production protocol",
  },
  {
    slug: "uniswap-v3-ethereum",
    displayName: "Uniswap V3",
    chain: "Ethereum",
    initials: "UV3",
    gradient: "linear-gradient(135deg, var(--accent-teal), var(--accent-sky))",
    label: "Live production protocol",
  },
  {
    slug: "drift-solana",
    displayName: "Drift",
    chain: "Solana",
    initials: "DRIFT",
    gradient: "linear-gradient(135deg, var(--sev-critical), var(--accent-sky))",
    label: "Post-mortem demo — what Breakwater would have caught",
  },
]

export function DemoProtocolsSection() {
  return (
    <section id="demo-protocols" className="py-24 border-t border-subtle">
      <div className="container mx-auto px-6 max-w-5xl">
        <div className="text-center mb-12 space-y-3">
          <p className="font-mono text-sm text-teal uppercase tracking-wider">
            Demo protocols
          </p>
          <h2 className="text-3xl md:text-4xl font-semibold text-primary">
            Run it on a real protocol
          </h2>
          <p className="text-muted max-w-xl mx-auto">
            Three demo protocols across Ethereum and Solana. Full scan results ship with Plan 03.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {DEMO_PROTOCOLS.map((p) => (
            <Link key={p.slug} href={`/demo/${p.slug}`}>
              <div className="glass-card p-6 space-y-3 hover:border-teal-glow transition-colors duration-200 h-full">
                <div
                  className="w-12 h-12 rounded-lg flex items-center justify-center border border-subtle"
                  style={{ background: p.gradient }}
                >
                  <span className="font-mono font-semibold text-primary text-sm">
                    {p.initials}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-primary">{p.displayName}</p>
                  <p className="font-mono text-xs text-muted mt-0.5">{p.chain}</p>
                </div>
                <p className="font-mono text-xs text-muted leading-snug">
                  {p.label}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
