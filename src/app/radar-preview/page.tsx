"use client"

import { useState } from "react"
import { AbyssBackground } from "@/components/shell/AbyssBackground"
import { Radar } from "@/components/radar/Radar"
import { exampleGraph, HEAL_PHASE } from "@/components/radar/exampleGraph"

/**
 * TEMPORARY — Plan 04 Phase B isolated preview.
 *
 * Renders the data-driven <Radar> with the G1f example graph and manual
 * phase / size controls so the component can be reviewed standalone before
 * Phase C composes the scroll-driven landing page. This route is REMOVED (or
 * gated) in Phase C — it is not part of the product surface. Not linked from
 * anywhere; not indexed.
 */

const PHASE_CAPTIONS: Record<number, { step: string; line: string }> = {
  1: { step: "Your protocol", line: "You run a tight ship." },
  2: { step: "The graph", line: "A protocol is never one contract." },
  3: { step: "The graph", line: "And the graph keeps growing." },
  4: { step: "The contagion", line: "You're safe. But are they?" },
  5: { step: "The breakwater", line: "We catch it before it reaches shore." },
}

const PHASES = [1, 2, 3, 4, 5]

export default function RadarPreviewPage() {
  const [phase, setPhase] = useState(1)
  const [size, setSize] = useState<"lg" | "sm">("lg")
  const caption = PHASE_CAPTIONS[phase]

  return (
    <div className="sonar-theme relative min-h-screen overflow-hidden">
      <AbyssBackground />

      <div className="relative z-10 flex min-h-screen flex-col items-center gap-6 px-6 py-10">
        <div className="rounded-md border border-amber/40 bg-amber/10 px-4 py-2 text-center">
          <p className="font-data text-xs uppercase tracking-[0.12em] text-amber">
            Temporary · Phase B radar preview · removed in Phase C
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <div className="flex gap-2">
            {PHASES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPhase(p)}
                className={`font-data rounded border px-3 py-1.5 text-xs uppercase tracking-[0.1em] transition-colors ${
                  phase === p
                    ? "border-sonar bg-sonar/15 text-sonar"
                    : "border-sonar-muted/30 text-sonar-muted hover:text-sonar"
                }`}
              >
                Phase {p}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            {(["lg", "sm"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSize(s)}
                className={`font-data rounded border px-3 py-1.5 text-xs uppercase tracking-[0.1em] transition-colors ${
                  size === s
                    ? "border-sonar bg-sonar/15 text-sonar"
                    : "border-sonar-muted/30 text-sonar-muted hover:text-sonar"
                }`}
              >
                {s === "lg" ? "Desktop" : "Mobile"}
              </button>
            ))}
          </div>
        </div>

        {/* Caption */}
        {caption && (
          <div className="text-center">
            <p className="sonar-eyebrow mb-1">{caption.step}</p>
            <p className="font-display text-xl font-semibold text-foam">{caption.line}</p>
          </div>
        )}

        {/* The radar under test */}
        <div className="flex flex-1 items-center justify-center">
          <Radar graph={exampleGraph} phase={phase} healPhase={HEAL_PHASE} size={size} />
        </div>
      </div>
    </div>
  )
}
