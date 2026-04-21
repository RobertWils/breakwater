import { Header } from "@/components/landing/Header"
import { HeroSection } from "@/components/landing/HeroSection"
import { StatsSection } from "@/components/landing/StatsSection"
import { VectorSection } from "@/components/landing/VectorSection"
import { DemoProtocolsSection } from "@/components/landing/DemoProtocolsSection"
import { HowItWorksSection } from "@/components/landing/HowItWorksSection"
import { FooterSection } from "@/components/landing/FooterSection"

export default function HomePage() {
  return (
    <>
      <Header />
      <HeroSection />
      <StatsSection />
      <VectorSection />
      <DemoProtocolsSection />
      <HowItWorksSection />
      <FooterSection />
    </>
  )
}
