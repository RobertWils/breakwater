import Link from "next/link"
import { Footer } from "@/components/landing/Footer"
import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { ShoreWater } from "@/components/shell/ShoreWater"
import { SonarHeader } from "@/components/shell/SonarHeader"

export default function ScanNotFound() {
  return (
    <div className="sonar-theme relative min-h-screen overflow-x-hidden">
      <AbyssBackground />
      <ShoreWater />
      <SonarHeader />
      <main className="relative z-10 px-5 pb-20 pt-28">
        <div className="container mx-auto max-w-2xl text-center">
          <div className="sonar-card p-12 space-y-6">
            <p className="sonar-eyebrow">Scan not found</p>
            <h1 className="font-display text-3xl font-semibold text-foam">
              This scan doesn&apos;t exist or has been removed
            </h1>
            <p className="text-sonar-muted">
              The scan ID may be incorrect, or the scan may have
              expired (scans are retained for 30 days).
            </p>
            <Link
              href="/"
              className="sonar-btn inline-block rounded-lg px-6 py-3 font-bold"
            >
              ← Back to home
            </Link>
          </div>
        </div>
      </main>
      <div className="relative z-10 bg-abyss">
        <Footer />
      </div>
    </div>
  )
}
