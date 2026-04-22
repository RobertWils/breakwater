import Link from "next/link"
import { Header } from "@/components/landing/Header"
import { Footer } from "@/components/landing/Footer"

export default function ScanNotFound() {
  return (
    <>
      <Header />
      <main className="min-h-screen py-24">
        <div className="container mx-auto px-6 max-w-2xl text-center">
          <div className="glass-card p-12 space-y-6">
            <p className="font-mono text-sm text-teal uppercase tracking-wider">
              Scan not found
            </p>
            <h1 className="text-3xl font-semibold text-primary">
              This scan doesn&apos;t exist or has been removed
            </h1>
            <p className="text-muted">
              The scan ID may be incorrect, or the scan may have
              expired (scans are retained for 30 days).
            </p>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-teal text-[#0C1C3A] font-semibold rounded-lg hover:bg-teal/90 transition-colors"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
