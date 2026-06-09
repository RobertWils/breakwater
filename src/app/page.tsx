import { prisma } from "@/lib/prisma"
import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { ShoreWater } from "@/components/shell/ShoreWater"
import { SonarHeader } from "@/components/shell/SonarHeader"
import { SonarLanding, type RealCounts } from "@/components/landing/SonarLanding"

/**
 * Plan 04 — the home page is the full sonar/contagion landing page.
 * Server component: it loads the REAL platform counts for the rotating stats
 * and hands them to the client composition.
 *
 * Fully STATIC: the page is rendered once at build time, so the Prisma counts
 * are fetched at build and frozen until the next deploy (no per-request query,
 * no ISR revalidation). It uses no dynamic request APIs, so force-static is
 * safe; the build needs the database (Railway PostgreSQL) reachable to read
 * the counts. There is intentionally NO fallback — if the build can't read the
 * counts, getCounts throws and the build fails loudly rather than freezing a
 * fabricated/placeholder number into a static page.
 */
export const dynamic = "force-static"

async function getCounts(): Promise<RealCounts> {
  const [contracts, detectorRuns, scans] = await Promise.all([
    prisma.contract.count(),
    prisma.moduleRun.count(),
    prisma.scan.count(),
  ])
  return { contracts, detectorRuns, scans }
}

export default async function HomePage() {
  const counts = await getCounts()
  return (
    <div className="sonar-theme relative min-h-screen overflow-x-hidden">
      <AbyssBackground />
      <ShoreWater />
      <SonarHeader />
      <SonarLanding counts={counts} />
    </div>
  )
}
