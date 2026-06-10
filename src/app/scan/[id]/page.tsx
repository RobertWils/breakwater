import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import type { Metadata } from "next"
import { authOptions } from "@/lib/auth"
import { getScan } from "@/lib/scan-response"
import { UUID_REGEX } from "@/lib/uuid"
import { Footer } from "@/components/landing/Footer"
import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { ShoreWater } from "@/components/shell/ShoreWater"
import { SonarHeader } from "@/components/shell/SonarHeader"
import { ScanShell } from "@/components/scan/ScanShell"

interface PageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ unlock?: string }>
}

export default async function ScanPage({ params }: PageProps) {
  const { id } = await params

  if (!UUID_REGEX.test(id)) {
    notFound()
  }

  const session = await getServerSession(authOptions)
  const tier = session?.user?.id ? "email" : "unauth"

  const scan = await getScan({ scanId: id, tier })

  if (!scan) {
    notFound()
  }

  return (
    <div className="sonar-theme relative min-h-screen overflow-x-hidden">
      <AbyssBackground />
      <ShoreWater />
      <SonarHeader />
      {/* pt-28 clears the fixed SonarHeader (same offset as home / /scan/new). */}
      <main className="relative z-10 px-5 pb-20 pt-28">
        <div className="container mx-auto max-w-5xl">
          <ScanShell scan={scan} tier={tier} />
        </div>
      </main>
      <div className="relative z-10 bg-abyss">
        <Footer />
      </div>
    </div>
  )
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params

  if (!UUID_REGEX.test(id)) {
    return {
      title: "Scan — Breakwater",
      robots: "noindex, nofollow",
    }
  }

  const scan = await getScan({ scanId: id, tier: "unauth" })

  if (!scan) {
    return {
      title: "Scan not found — Breakwater",
      robots: "noindex, nofollow",
    }
  }

  return {
    title: `${scan.protocol.displayName} scan — Breakwater`,
    description: `Security scan for ${scan.protocol.displayName} on ${scan.protocol.chain}`,
    robots: "noindex, nofollow",
  }
}
