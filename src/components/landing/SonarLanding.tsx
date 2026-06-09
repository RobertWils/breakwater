"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { Radar } from "@/components/radar/Radar"
import {
  exampleGraph,
  exampleGraphMobile,
  HEAL_PHASE,
  HEAL_PHASE_MOBILE,
} from "@/components/radar/exampleGraph"
import { ScanForm } from "./ScanForm"
import { Footer } from "./Footer"

/**
 * Plan 04 Phase C — the sonar/contagion landing page (spec §1).
 *
 * Composes the Phase A shell + Phase B radar into the approved scroll-driven
 * story. Desktop = G1f cockpit (sticky radar left, scan card + rotating stats
 * right, 5 beats). Mobile = mobile-radar-story.html (scan card top, ONE sticky
 * radar on its own layer that the beats scroll behind, 4 beats). Both layouts
 * are in the DOM; CSS shows one per breakpoint, and a single
 * IntersectionObserver maps the active beat → radar `phase`.
 *
 * Real platform counts are passed in from the server page; stats without a
 * real backing source are rendered as marked placeholders (never invented).
 */

export interface RealCounts {
  contracts: number | null
  detectorRuns: number | null
  scans: number | null
}

interface Stat {
  value: string
  label: string
  tone: "" | "warn" | "danger"
  placeholder: boolean
}

interface Beat {
  phase: number
  step: string
  tone: "" | "danger"
  headline: ReactNode
  body: ReactNode
  stat: Stat
}

const fmt = (n: number | null): string | null =>
  n == null ? null : n.toLocaleString("en-US")

function realStat(value: string | null, label: string, tone: "" | "warn" | "danger" = ""): Stat {
  return value == null
    ? { value: "—", label: `${label} · syncing`, tone, placeholder: true }
    : { value, label, tone, placeholder: false }
}

function placeholderStat(label: string, tone: "" | "warn" | "danger" = ""): Stat {
  return { value: "—", label: `${label} · coming soon`, tone, placeholder: true }
}

// "< 60s to a full read" is an existing product claim (already on the form
// foot), not a fabricated metric — rendered as a real, non-placeholder stat.
const speedStat: Stat = {
  value: "< 60s",
  label: "to a full protocol read",
  tone: "",
  placeholder: false,
}

// Sourced external figure — rolling-12-month DeFi hack losses, ≈$1.1B per
// OpenZeppelin / CoinDesk (27 May 2026). A cited external number, not an
// invented metric; do NOT inflate it. Amber (loss/warning) tone.
const lossStat: Stat = {
  value: "$1.1B+",
  label: "lost to DeFi hacks · past 12 months",
  tone: "warn",
  placeholder: false,
}

function desktopBeats(c: RealCounts): Beat[] {
  return [
    {
      phase: 1,
      step: "Your protocol",
      tone: "",
      headline: (
        <>
          You run a <em>tight ship</em>.
        </>
      ),
      body: "Audited. Clean. On its own, your protocol looks solid — and it probably is.",
      stat: realStat(fmt(c.contracts), "contracts scanned"),
    },
    {
      phase: 2,
      step: "The graph",
      tone: "",
      headline: (
        <>
          But a protocol is <em>never one contract</em>.
        </>
      ),
      body: "Proxy, timelock, guardian — every contract you depend on is part of your real attack surface.",
      stat: realStat(fmt(c.detectorRuns), "detector checks run"),
    },
    {
      phase: 3,
      step: "The graph",
      tone: "",
      headline: (
        <>
          And the graph <em>keeps growing</em>.
        </>
      ),
      body: "Each of those leans on others. Your surface reaches far beyond the code you wrote.",
      stat: realStat(fmt(c.scans), "protocols scanned"),
    },
    {
      phase: 4,
      step: "The contagion",
      tone: "danger",
      headline: (
        <>
          You&apos;re safe. But are <span className="text-red">they</span>?
        </>
      ),
      body: "You inherit the worst score in your graph. One unsafe dependency, and your protocol is unsafe too — no matter how clean your own code is.",
      stat: placeholderStat("hacks indexed", "danger"),
    },
    {
      phase: 5,
      step: "The breakwater",
      tone: "",
      headline: (
        <>
          We catch it before it reaches <em>shore</em>.
        </>
      ),
      body: "Breakwater scans your whole graph, scores every connection, and clears what's dangerous — before it ever reaches you.",
      stat: lossStat,
    },
  ]
}

function mobileBeats(c: RealCounts): Beat[] {
  return [
    {
      phase: 1,
      step: "Your protocol",
      tone: "",
      headline: (
        <>
          You run a <em>tight ship</em>.
        </>
      ),
      body: "Audited. Clean. On its own, your protocol looks solid.",
      stat: realStat(fmt(c.contracts), "contracts scanned"),
    },
    {
      phase: 2,
      step: "The graph",
      tone: "",
      headline: (
        <>
          A protocol is <em>never one contract</em>.
        </>
      ),
      body: "Proxy, timelock, guardian — every contract you depend on is part of your real attack surface.",
      stat: realStat(fmt(c.scans), "protocols scanned"),
    },
    {
      phase: 3,
      step: "The contagion",
      tone: "danger",
      headline: (
        <>
          You&apos;re safe. But are <span className="text-red">they</span>?
        </>
      ),
      body: "You inherit the worst score in your graph. One unsafe dependency, and your protocol is unsafe too.",
      stat: placeholderStat("hacks indexed", "danger"),
    },
    {
      phase: 4,
      step: "The breakwater",
      tone: "",
      headline: (
        <>
          We catch it before it reaches <em>shore</em>.
        </>
      ),
      body: "Breakwater scans your whole graph, scores every connection, and clears what's dangerous — before it reaches you.",
      stat: speedStat,
    },
  ]
}

export function SonarLanding({ counts }: { counts: RealCounts }) {
  const [phase, setPhase] = useState(1)
  const rootRef = useRef<HTMLDivElement>(null)

  // One observer for both layouts. Hidden-layout beats (display:none) have no
  // layout box, so only the active breakpoint's beats ever intersect.
  useEffect(() => {
    const beats = rootRef.current?.querySelectorAll<HTMLElement>("[data-beat-phase]")
    if (!beats || beats.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const p = Number(entry.target.getAttribute("data-beat-phase"))
            if (!Number.isNaN(p)) setPhase(p)
          }
        }
      },
      { threshold: 0.55 },
    )
    beats.forEach((b) => observer.observe(b))
    return () => observer.disconnect()
  }, [])

  const dBeats = desktopBeats(counts)
  const mBeats = mobileBeats(counts)
  const activeDesktopStat = dBeats.find((b) => b.phase === phase)?.stat ?? dBeats[0].stat

  return (
    // Natural document flow: the page follows its content height and the
    // footer sits directly after the last section (no flex push, no fixed
    // overlay) — so there's no dead band when content is shorter than the
    // viewport.
    <div ref={rootRef}>
      {/* ── Desktop cockpit ─────────────────────────────────────────────── */}
      <div className="hidden lg:block">
        {/* Fixed overlay: radar always left, scan card + stats always right. */}
        <div className="pointer-events-none fixed inset-0 z-[5] grid grid-cols-[1.15fr_0.85fr] items-center gap-8 px-11 pb-10 pt-20">
          <div className="flex h-full items-center justify-center">
            <Radar graph={exampleGraph} phase={phase} healPhase={HEAL_PHASE} size="lg" />
          </div>
          <div className="pointer-events-auto flex items-center">
            <div className="w-full max-w-[380px]">
              {/* G1f: the rotating stat lives INSIDE the card (after the foot
                  line), not as a loose block under it. */}
              <ScanForm
                idPrefix="d-"
                statSlot={
                  <div className="mt-5 min-h-[74px] border-t border-[rgba(30,224,176,0.15)] pt-5">
                    <StatLine stat={activeDesktopStat} phaseKey={phase} />
                  </div>
                }
              />
            </div>
          </div>
        </div>

        {/* Narrative beats drive the phase as they scroll past. This
            full-width wrapper sits above the fixed cockpit (z-10 > z-5), so it
            must itself be pointer-events-none — otherwise its empty area catches
            clicks meant for the scan card even though the sections inside are
            already pointer-events-none. The beat text re-enables pointer events
            on its own wrapper (descendant auto overrides ancestor none). */}
        <div className="pointer-events-none relative z-10">
          {dBeats.map((beat, i) => {
            // The last beat gets a compact, centered treatment: a shorter
            // min-height and items-center (vs items-end + pb-[16vh]) so its
            // text doesn't float at the bottom of a mostly-empty 80vh band
            // right above the footer — which read as a big black bar over the
            // card. Middle beats keep the tall bottom-aligned treatment.
            const isLast = i === dBeats.length - 1
            return (
              <section
                key={beat.phase}
                data-beat-phase={beat.phase}
                // pointer-events-none (G1f .beat): the beat sits over the fixed
                // cockpit, so it must let clicks through to the scan card
                // underneath (the text re-enables pointer-events in BeatInner).
                // min-h not full screen so each phase isn't preceded by an
                // empty screen. Scroll + IntersectionObserver are unaffected.
                className={
                  isLast
                    ? "pointer-events-none flex min-h-[60vh] items-center px-11"
                    : "pointer-events-none flex min-h-[80vh] items-end px-11 pb-[16vh]"
                }
              >
                <BeatInner beat={beat} active={phase === beat.phase} />
              </section>
            )
          })}
        </div>
      </div>

      {/* ── Mobile vertical ─────────────────────────────────────────────── */}
      <div className="lg:hidden">
        <section className="relative z-10 px-5 pb-7 pt-20">
          <p className="sonar-eyebrow mb-3 flex items-center gap-2">
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-sonar animate-pulse" />
            DeFi Security Monitoring
          </p>
          <h1 className="font-display mb-3 text-[33px] font-bold leading-[1.08] [letter-spacing:-0.01em] text-foam">
            We catch the attacks before they reach <em className="not-italic text-sonar">shore</em>
          </h1>
          <p className="mb-5 text-[14.5px] leading-relaxed text-sonar-muted">
            Scan a protocol&apos;s whole graph — contracts, bridges, dependencies — for the
            patterns behind the biggest DeFi losses.
          </p>
          <ScanForm idPrefix="m-" />
        </section>

        <section className="relative">
          {/* Sticky radar on its own opaque→transparent layer; text scrolls behind. */}
          <div
            className="sticky top-0 z-20 flex h-[46vh] items-center justify-center"
            style={{
              background:
                "linear-gradient(180deg, var(--abyss) 0%, var(--abyss) 55%, rgba(2,10,14,0.85) 80%, transparent 100%)",
            }}
          >
            <Radar
              graph={exampleGraphMobile}
              phase={phase}
              healPhase={HEAL_PHASE_MOBILE}
              size="sm"
            />
          </div>

          <div className="relative z-[11] -mt-[6vh]">
            {mBeats.map((beat) => (
              <div
                key={beat.phase}
                data-beat-phase={beat.phase}
                className="flex min-h-[80vh] items-center px-5"
              >
                <BeatInner beat={beat} active={phase === beat.phase} mobile />
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Shared footer: in normal flow, directly after the last section.
          Opaque (bg-abyss) so on desktop it cleanly covers the fixed cockpit
          at the end of the scroll instead of the radar bleeding through. */}
      <div className="relative z-10 bg-abyss">
        <Footer />
      </div>
    </div>
  )
}

function BeatInner({
  beat,
  active,
  mobile = false,
}: {
  beat: Beat
  active: boolean
  mobile?: boolean
}) {
  return (
    <div
      // Re-enable pointer events for the text itself (the parent section is
      // pointer-events-none); the text sits bottom-left, clear of the card.
      className={`pointer-events-auto max-w-[560px] transition-all duration-500 ${
        active ? "opacity-100 translate-y-0" : "opacity-20 translate-y-4"
      }`}
    >
      <p
        className={`sonar-eyebrow mb-3 ${beat.tone === "danger" ? "!text-red" : ""}`}
      >
        {beat.step}
      </p>
      <h2
        className={`font-display mb-3 font-bold leading-[1.08] [letter-spacing:-0.01em] text-foam ${
          mobile ? "text-[26px]" : "text-[clamp(30px,3.4vw,46px)]"
        }`}
      >
        {beat.headline}
      </h2>
      <p
        className={`leading-relaxed ${mobile ? "text-[14.5px] text-sonar-muted" : "text-[17px] text-foam"}`}
      >
        {beat.body}
      </p>
      {mobile && (
        <div className="mt-3.5 border-t border-sonar/12 pt-3">
          <StatLine stat={beat.stat} inline />
        </div>
      )}
    </div>
  )
}

function StatLine({
  stat,
  phaseKey,
  inline = false,
}: {
  stat: Stat
  phaseKey?: number
  inline?: boolean
}) {
  const valueColour = stat.placeholder
    ? "text-sonar-muted/50"
    : stat.tone === "danger"
      ? "text-red"
      : stat.tone === "warn"
        ? "text-amber"
        : "text-sonar"

  if (inline) {
    return (
      <p className="font-data text-[11px] text-sonar-muted">
        <span className={`font-display text-base font-bold ${valueColour}`}>{stat.value}</span>{" "}
        {stat.label}
      </p>
    )
  }

  return (
    <div key={phaseKey} className="stat-fade">
      {/* G1f: number = Chakra Petch bold 30px (tone-coloured); label = IBM
          Plex Mono 10.5px uppercase muted. */}
      <div className={`font-display text-[30px] font-bold leading-none ${valueColour}`}>
        {stat.value}
      </div>
      <div className="label-mono mt-2 text-[10.5px]">{stat.label}</div>
    </div>
  )
}
