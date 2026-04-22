import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import type { Metadata } from "next"
import { authOptions } from "@/lib/auth"
import { getScan } from "@/lib/scan-response"
import { UUID_REGEX } from "@/lib/uuid"
import { Header } from "@/components/landing/Header"
import { Footer } from "@/components/landing/Footer"
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
    <>
      <Header />
      <main className="min-h-screen py-12 md:py-16">
        <div className="container mx-auto px-6 max-w-5xl">
          <ScanShell scan={scan} tier={tier} />
        </div>
      </main>
      <Footer />
    </>
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
