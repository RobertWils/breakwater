import { Footer } from "@/components/landing/Footer"
import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { ShoreWater } from "@/components/shell/ShoreWater"
import { SonarHeader } from "@/components/shell/SonarHeader"

export default function ScanLoading() {
  return (
    <div className="sonar-theme relative min-h-screen overflow-x-hidden">
      <AbyssBackground />
      <ShoreWater />
      <SonarHeader />
      <main className="relative z-10 px-5 pb-20 pt-28">
        <div className="container mx-auto max-w-5xl space-y-6">
          <div className="sonar-card p-8 animate-pulse">
            <div className="h-4 bg-sonar/10 rounded w-32 mb-3" />
            <div className="h-8 bg-sonar/10 rounded w-64" />
          </div>

          <div className="sonar-card p-12 animate-pulse text-center">
            <div className="h-20 bg-sonar/10 rounded w-32 mx-auto mb-4" />
            <div className="h-4 bg-sonar/10 rounded w-48 mx-auto" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="sonar-card p-6 animate-pulse">
                <div className="h-5 bg-sonar/10 rounded w-24 mb-3" />
                <div className="h-4 bg-sonar/10 rounded w-full" />
              </div>
            ))}
          </div>
        </div>
      </main>
      <div className="relative z-10 bg-abyss">
        <Footer />
      </div>
    </div>
  )
}
