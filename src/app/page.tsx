import { Header } from "@/components/landing/Header"
import { HeroSection } from "@/components/landing/HeroSection"
import { StatsSection } from "@/components/landing/StatsSection"
import { VectorSection } from "@/components/landing/VectorSection"
import { DemoProtocolsSection } from "@/components/landing/DemoProtocolsSection"
import { HowItWorksSection } from "@/components/landing/HowItWorksSection"
import { Footer } from "@/components/landing/Footer"
import { FloatingScanCTA } from "@/components/landing/FloatingScanCTA"

export default function HomePage() {
  return (
    <>
      <Header />
      <HeroSection />
      <StatsSection />
      <VectorSection />
      <DemoProtocolsSection />
      <HowItWorksSection />
      <Footer />
      <FloatingScanCTA />
    </>
  )
}
