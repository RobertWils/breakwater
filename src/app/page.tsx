import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { ShoreWater } from "@/components/shell/ShoreWater"
import { SonarHeader } from "@/components/shell/SonarHeader"
import { HeroSection } from "@/components/landing/HeroSection"
import { StatsSection } from "@/components/landing/StatsSection"
import { VectorSection } from "@/components/landing/VectorSection"
import { DemoProtocolsSection } from "@/components/landing/DemoProtocolsSection"
import { HowItWorksSection } from "@/components/landing/HowItWorksSection"
import { Footer } from "@/components/landing/Footer"
import { FloatingScanCTA } from "@/components/landing/FloatingScanCTA"

/**
 * Plan 04 Phase A, Step 3: the home page adopts the Sonar shell — abyss
 * background + shore-water + sonar header + sonar typography (chrome only).
 * The existing landing sections still render as-is; the scroll-driven radar
 * story that replaces them is Phase B/C.
 */
export default function HomePage() {
  return (
    <div className="sonar-theme relative min-h-screen">
      <AbyssBackground />
      <ShoreWater />
      <SonarHeader />
      {/* z-10 lifts content above the abyss/shore layers; pt offsets the
          fixed header so the first section isn't hidden beneath it. */}
      <main className="relative z-10 pt-20">
        <HeroSection />
        <StatsSection />
        <VectorSection />
        <DemoProtocolsSection />
        <HowItWorksSection />
        <Footer />
      </main>
      <FloatingScanCTA />
    </div>
  )
}
