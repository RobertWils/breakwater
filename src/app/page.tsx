import { prisma } from "@/lib/prisma"
import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { ShoreWater } from "@/components/shell/ShoreWater"
import { SonarHeader } from "@/components/shell/SonarHeader"
import { SonarLanding, type RealCounts } from "@/components/landing/SonarLanding"

/**
 * Plan 04 Phase C — the home page is the full sonar/contagion landing page.
 * Server component: it loads the REAL platform counts for the rotating stats
 * and hands them to the client composition. ISR (revalidate) keeps the page
 * mostly static while the counts refresh periodically.
 */
export const revalidate = 600

async function getCounts(): Promise<RealCounts> {
  try {
    const [contracts, detectorRuns, scans] = await Promise.all([
      prisma.contract.count(),
      prisma.moduleRun.count(),
      prisma.scan.count(),
    ])
    return { contracts, detectorRuns, scans }
  } catch {
    // DB unavailable (e.g. at build with no connection): the affected stats
    // render as marked placeholders rather than failing the page.
    return { contracts: null, detectorRuns: null, scans: null }
  }
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
