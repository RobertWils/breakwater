/**
 * Plan 04 Sonar shell (spec §1) — the fixed abyss background layer.
 * Reproduces the mockups' `.bg`: a teal radial glow over a deep diagonal
 * gradient. Sits at z-0 behind all content; purely decorative.
 *
 * The radial origin differs desktop vs mobile in the mockups (30% 45% vs
 * 50% 28%); the shared default here is the desktop value. Phase B/C can pass
 * a variant if the mobile composition needs the higher origin.
 */
export function AbyssBackground() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 z-0"
      style={{ background: "var(--sonar-bg)" }}
    />
  )
}
