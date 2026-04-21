import { ScrollReveal } from "./ScrollReveal"

const STEPS = [
  {
    number: "01",
    title: "Submit contracts + domain.",
    body: "Paste the protocol address (and optionally a frontend domain). Chain auto-detected. No signup, no wallet.",
  },
  {
    number: "02",
    title: "We scan 4 attack surfaces in parallel.",
    body: "Governance, Oracle/Bridge, Signer, and Frontend — each with dedicated detectors. Findings graded per OWASP-DeFi severity.",
  },
  {
    number: "03",
    title: "Get graded findings in under 60 seconds.",
    body: "Free scan returns severity-capped summary. Paid tiers unlock remediation detail and continuous monitoring.",
  },
]

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="py-24 border-t border-subtle">
      <div className="container mx-auto px-6 max-w-5xl">
        <ScrollReveal>
          <div className="text-center mb-12 space-y-3">
            <p className="font-mono text-sm text-teal uppercase tracking-wider">
              Process
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold text-primary">
              How it works
            </h2>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {STEPS.map((step, index) => (
            <ScrollReveal key={step.number} delay={index * 0.1}>
              <div className="glass-card p-6 space-y-3 h-full">
                <span className="font-mono text-xs text-teal">{step.number}</span>
                <h3 className="font-semibold text-primary">{step.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{step.body}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>

        <ScrollReveal delay={0.3}>
          <div className="mt-12 text-center">
            <a
              href="#hero"
              className="text-sky underline-offset-4 hover:underline transition-all duration-150"
            >
              Scan your protocol →
            </a>
          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
