import { ScanForm } from "./ScanForm"

export function HeroSection() {
  return (
    <section id="hero" className="min-h-[80vh] flex items-center py-20 lg:py-32">
      <div className="container mx-auto px-6 max-w-5xl">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="space-y-6">
            <p className="font-mono text-sm text-teal uppercase tracking-wider">
              DeFi Security Monitoring
            </p>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-sans font-semibold [letter-spacing:-0.02em] text-primary">
              We catch the attacks before they reach shore
            </h1>
            <p className="text-lg md:text-xl text-muted max-w-xl">
              The governance, oracle, signer, and frontend patterns behind $600M+ in 2026 DeFi hacks — detected continuously.
            </p>
          </div>
          <div className="lg:pl-8">
            <ScanForm />
          </div>
        </div>
      </div>
    </section>
  )
}
