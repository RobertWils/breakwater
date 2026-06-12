"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Footer } from "@/components/landing/Footer"
import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { ShoreWater } from "@/components/shell/ShoreWater"
import { SonarHeader } from "@/components/shell/SonarHeader"

export default function ScanError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[scan-page] Error rendering scan:", error)
  }, [error])

  return (
    <div className="sonar-theme relative min-h-screen overflow-x-hidden">
      <AbyssBackground />
      <ShoreWater />
      <SonarHeader />
      <main className="relative z-10 px-5 pb-20 pt-28">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="sonar-card p-12 space-y-6">
            <p className="font-data text-sm text-red uppercase tracking-wider">
              Error loading scan
            </p>
            <h1 className="font-display text-3xl font-semibold text-foam">
              Something went wrong
            </h1>
            <p className="text-sonar-muted">
              We couldn&apos;t load this scan. This may be a temporary issue.
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={reset}
                className="sonar-btn rounded-lg px-6 py-3 font-bold"
              >
                Try again
              </button>
              <Link
                href="/"
                className="rounded-lg border border-sonar/30 px-6 py-3 font-data text-sm uppercase tracking-[0.08em] text-sonar-muted transition-colors hover:text-sonar"
              >
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
      <div className="relative z-10 bg-abyss">
        <Footer />
      </div>
    </div>
  )
}
