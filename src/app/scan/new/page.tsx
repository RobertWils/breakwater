import type { Metadata } from "next"
import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { ShoreWater } from "@/components/shell/ShoreWater"
import { SonarHeader } from "@/components/shell/SonarHeader"

/**
 * Plan 04 Phase D.1 — multi-contract scan input, route + page shell only.
 *
 * Sonar-styled standalone page (its own SonarHeader + abyss/shore shell, NOT
 * the shared Header). This is just the frame: a centered content column with a
 * placeholder .sonar-card where the multi-contract input goes in D.2. No
 * fields, no submission logic yet. Lives at /scan/new — the static segment
 * takes precedence over the dynamic /scan/[id] results route, and scan ids are
 * UUIDs so they never collide with "new".
 */
export const metadata: Metadata = {
  title: "Scan a protocol — Breakwater",
  description:
    "Scan a protocol's whole graph — the core contract and the contracts it depends on — together.",
}

export default function ScanNewPage() {
  return (
    <div className="sonar-theme relative min-h-screen overflow-x-hidden">
      <AbyssBackground />
      <ShoreWater />
      <SonarHeader />

      {/* pt-20 clears the fixed SonarHeader (same offset as the home <main>). */}
      <main className="relative z-10 px-5 pb-28 pt-28">
        <div className="mx-auto max-w-2xl">
          <p className="sonar-eyebrow mb-3">Multi-contract scan</p>
          <h1 className="font-display mb-3 text-4xl font-bold leading-[1.08] [letter-spacing:-0.01em] text-foam md:text-5xl">
            Scan a full protocol
          </h1>
          <p className="font-data mb-8 max-w-xl text-[13px] leading-relaxed text-sonar-muted">
            A protocol is never one contract. Add your core contract and the
            ones it depends on — proxy, timelock, guardian, bridge — and
            Breakwater scores the whole graph together, worst-wins.
          </p>

          {/* Placeholder input container — the multi-contract form mounts here
              in D.2. Empty by design for now. */}
          <div className="sonar-card flex min-h-[280px] items-center justify-center p-8 text-center">
            <p className="label-mono text-sonar-muted">
              Multi-contract input · coming next
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
