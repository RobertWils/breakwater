"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Header } from "@/components/landing/Header"
import { Footer } from "@/components/landing/Footer"

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
    <>
      <Header />
      <main className="min-h-screen py-24">
        <div className="container mx-auto px-6 max-w-2xl text-center">
          <div className="glass-card p-12 space-y-6">
            <p className="font-mono text-sm text-sev-critical uppercase tracking-wider">
              Error loading scan
            </p>
            <h1 className="text-3xl font-semibold text-primary">
              Something went wrong
            </h1>
            <p className="text-muted">
              We couldn&apos;t load this scan. This may be a temporary issue.
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={reset}
                className="px-6 py-3 bg-teal text-[#0C1C3A] font-semibold rounded-lg hover:bg-teal/90 transition-colors"
              >
                Try again
              </button>
              <Link
                href="/"
                className="px-6 py-3 bg-elevated/50 text-primary border border-subtle rounded-lg hover:bg-elevated transition-colors"
              >
                Back to home
              </Link>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
