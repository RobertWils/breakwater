import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import type { Metadata } from "next"
import { Header } from "@/components/landing/Header"
import { Footer } from "@/components/landing/Footer"

const CURATED_SLUGS = [
  "aave-v3-ethereum",
  "uniswap-v3-ethereum",
  "drift-solana",
] as const

type CuratedSlug = (typeof CURATED_SLUGS)[number]

const PROTOCOL_GRADIENTS: Record<CuratedSlug, string> = {
  "aave-v3-ethereum": "linear-gradient(135deg, var(--accent-teal), var(--accent-sky))",
  "uniswap-v3-ethereum": "linear-gradient(135deg, var(--accent-teal), var(--accent-sky))",
  "drift-solana": "linear-gradient(135deg, var(--sev-critical), var(--accent-sky))",
}

const PROTOCOL_INITIALS: Record<CuratedSlug, string> = {
  "aave-v3-ethereum": "AV3",
  "uniswap-v3-ethereum": "UV3",
  "drift-solana": "DRIFT",
}

export function generateStaticParams() {
  return CURATED_SLUGS.map((slug) => ({ slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const protocol = await prisma.protocol.findUnique({ where: { slug } })
  if (!protocol || protocol.ownershipStatus !== "CURATED") {
    return {
      title: "Not found — Breakwater",
    }
  }
  return {
    title: `${protocol.displayName} — Breakwater demo`,
    description:
      "Demo protocol page — full scan results ship in a future release.",
  }
}

export default async function DemoProtocolPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params

  if (!(CURATED_SLUGS as readonly string[]).includes(slug)) {
    notFound()
  }

  const protocol = await prisma.protocol.findUnique({
    where: { slug },
  })

  if (!protocol || protocol.ownershipStatus !== "CURATED") {
    notFound()
  }

  const curatedSlug = slug as CuratedSlug
  const gradient =
    PROTOCOL_GRADIENTS[curatedSlug] ?? "var(--bg-elevated)"
  const initials = PROTOCOL_INITIALS[curatedSlug] ?? "?"

  return (
    <>
      <Header />
      <main className="min-h-screen py-20">
      <div className="container mx-auto px-6 max-w-3xl">
        <div className="glass-card p-8 space-y-8">
          {/* 96×96 header tile */}
          <div className="flex items-center gap-6">
            <div
              className="w-24 h-24 rounded-lg flex items-center justify-center border border-subtle flex-shrink-0"
              style={{ background: gradient }}
            >
              <span className="font-mono font-semibold text-primary text-lg">
                {initials}
              </span>
            </div>
            <div>
              <p className="font-mono text-sm text-teal uppercase tracking-wider">
                Demo protocol
              </p>
              <h1 className="text-4xl font-semibold text-primary mt-2">
                {protocol.displayName}
              </h1>
            </div>
          </div>

          {/* Post-mortem banner for Drift */}
          {slug === "drift-solana" && (
            <p className="font-mono text-sm text-sev-critical/80">
              Post-mortem demo — what Breakwater would have caught
            </p>
          )}

          {/* Protocol details */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <dt className="font-mono text-xs text-muted uppercase tracking-wider">
                Chain
              </dt>
              <dd className="mt-1 text-primary font-semibold">
                {protocol.chain.charAt(0) + protocol.chain.slice(1).toLowerCase()}
              </dd>
            </div>

            {protocol.domain && (
              <div>
                <dt className="font-mono text-xs text-muted uppercase tracking-wider">
                  Domain
                </dt>
                <dd className="mt-1 text-primary font-semibold">
                  {protocol.domain}
                </dd>
              </div>
            )}

            <div className="sm:col-span-2">
              <dt className="font-mono text-xs text-muted uppercase tracking-wider">
                Primary contract
              </dt>
              <dd className="mt-1 font-mono text-sm text-primary break-all">
                {protocol.primaryContractAddress}
              </dd>
            </div>
          </dl>

          {/* Coming soon placeholder — content discipline §7.2 */}
          <div className="border-t border-subtle pt-6">
            <p className="text-muted text-sm leading-relaxed">
              Full scan results coming soon. Our detectors are under active
              development — this protocol will show graded findings in a
              future release.
            </p>
          </div>
        </div>
      </div>
    </main>
    <Footer />
    </>
  )
}
