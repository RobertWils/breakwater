/**
 * Plan 04 Sonar shell (spec §1) — animated shore-water at the bottom edge.
 * Reproduces the mockups' `.sea`: two faint sonar-coloured wave layers
 * (opacity 5% / 7%) drifting in opposite directions at different speeds.
 *
 * Each SVG is 200% wide and its path repeats once at the 1440-unit midpoint,
 * so a `translateX(-50%)` tide drift loops seamlessly. Decorative only
 * (aria-hidden, pointer-events-none); restraint per spec — opacity stays low.
 *
 * `height` lets a surface tune the band (desktop mockup 18vh, mobile 12vh).
 */
export function ShoreWater({ height = "18vh" }: { height?: string }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed bottom-0 left-0 z-[1] w-full overflow-hidden"
      style={{ height }}
    >
      <svg
        className="absolute bottom-0 left-0 h-full w-[200%] animate-tide-slow opacity-[0.05]"
        viewBox="0 0 1440 200"
        preserveAspectRatio="none"
      >
        <path
          fill="var(--sonar)"
          d="M0,110 C240,160 480,60 720,110 C960,160 1200,60 1440,110 L1440,200 L0,200 Z M1440,110 C1680,160 1920,60 2160,110 C2400,160 2640,60 2880,110 L2880,200 L1440,200 Z"
        />
      </svg>
      <svg
        className="absolute bottom-0 left-0 h-full w-[200%] animate-tide-fast opacity-[0.07]"
        viewBox="0 0 1440 200"
        preserveAspectRatio="none"
      >
        <path
          fill="var(--sonar)"
          d="M0,130 C360,80 720,170 1080,120 C1260,95 1350,130 1440,130 L1440,200 L0,200 Z M1440,130 C1800,80 2160,170 2520,120 C2700,95 2790,130 2880,130 L2880,200 L1440,200 Z"
        />
      </svg>
    </div>
  )
}
