"use client"

import { useEffect, useRef, useState } from "react"
import { useInView, useMotionValue, animate } from "framer-motion"
import { ScrollReveal } from "./ScrollReveal"

function CountUp({ to, duration = 1.5 }: { to: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "-20%" })
  const mv = useMotionValue(0)
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!inView) return
    const controls = animate(mv, to, { duration, ease: "easeOut" })
    const unsub = mv.on("change", (v) => setDisplay(Math.round(v)))
    return () => {
      controls.stop()
      unsub()
    }
  }, [inView, to, duration, mv])

  return <span ref={ref}>{display}</span>
}

export function StatsSection() {
  return (
    <section id="stats" className="py-24 border-t border-subtle">
      <div className="container mx-auto px-6 max-w-4xl">
        <ScrollReveal>
          <div className="text-center space-y-4">
            <h2 className="text-4xl md:text-5xl font-semibold text-primary">
              $<CountUp to={600} />M+ lost to DeFi hacks in 2026
            </h2>
            <p className="text-lg text-muted">
              4 attack patterns dominate the losses
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={0.2}>
          <div className="mt-10 flex justify-center">
            <div className="glass-card p-6 w-full max-w-2xl">
            <p className="font-mono text-sm text-teal">
              How we arrived at $600M+
            </p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-subtle">
                    <th className="text-left py-2 pr-4 font-mono text-xs text-muted uppercase tracking-wider">Protocol</th>
                    <th className="text-right py-2 pr-4 font-mono text-xs text-muted uppercase tracking-wider">Amount</th>
                    <th className="text-left py-2 pr-4 font-mono text-xs text-muted uppercase tracking-wider">Date</th>
                    <th className="text-left py-2 font-mono text-xs text-muted uppercase tracking-wider">Vector</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
                  <tr>
                    <td className="py-2 pr-4 font-mono text-primary">Kelp DAO</td>
                    <td className="py-2 pr-4 text-right font-mono text-sev-critical">$292M</td>
                    <td className="py-2 pr-4 text-muted">Apr 2026</td>
                    <td className="py-2 text-muted">LayerZero bridge exploit — Oracle/Bridge</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-primary">Drift</td>
                    <td className="py-2 pr-4 text-right font-mono text-sev-critical">$285M</td>
                    <td className="py-2 pr-4 text-muted">Apr 2026</td>
                    <td className="py-2 text-muted">Governance / social engineering</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-primary">Step Finance</td>
                    <td className="py-2 pr-4 text-right font-mono text-sev-critical">~$27M</td>
                    <td className="py-2 pr-4 text-muted">Jan 2026</td>
                    <td className="py-2 text-muted">Multisig compromise — Governance/Signer</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-primary">Truebit</td>
                    <td className="py-2 pr-4 text-right font-mono text-sev-critical">$26M</td>
                    <td className="py-2 pr-4 text-muted">Jan 2026</td>
                    <td className="py-2 text-muted">Legacy contract bug — Governance/Signer</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 font-mono text-primary">CoW Swap</td>
                    <td className="py-2 pr-4 text-right font-mono text-sev-critical">$1.2M</td>
                    <td className="py-2 pr-4 text-muted">Apr 2026</td>
                    <td className="py-2 text-muted">Domain hijack — Frontend</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-4 font-mono text-xs text-muted">
                Sum of named hacks: ~$631M. Headline rounded conservatively to $600M+.
              </p>
            </div>
          </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  )
}
