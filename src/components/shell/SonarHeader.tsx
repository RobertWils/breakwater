import Link from "next/link"
import { Logo } from "@/components/brand/Logo"
import { Wordmark } from "@/components/brand/Wordmark"

/**
 * Plan 04 Sonar shell (spec §1) — the header in the new style. Reuses the
 * existing brand Logo + Wordmark (the mark is not reinvented) inside the
 * mockup's header chrome: a top gradient fading to transparent, mono nav
 * tracked + uppercased, hover → sonar.
 *
 * `fixed` per the mockup — the gradient-fade header floats over the abyss.
 * Surfaces that use it offset their content (e.g. top padding) so the first
 * section isn't hidden beneath it.
 *
 * NAV TARGETS ARE PLACEHOLDERS: the mockup nav (Product / Detectors / Docs /
 * Pricing) points at `#`; those routes don't exist yet. Wired to real
 * destinations when the pages are built. Flagged, not silently shipped.
 */
const NAV_ITEMS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Product", href: "#" },
  { label: "Detectors", href: "#" },
  { label: "Docs", href: "#" },
  { label: "Pricing", href: "#" },
]

export function SonarHeader() {
  return (
    <header className="fixed top-0 left-0 z-50 w-full bg-gradient-to-b from-abyss/90 to-transparent">
      <div className="flex items-center justify-between px-5 py-4 md:px-11 md:py-5">
        <Link href="/" className="flex w-fit items-center gap-3">
          <Logo variant="color" size={26} />
          <Wordmark variant="solid" size="sm" />
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="font-data text-[13px] uppercase tracking-[0.08em] text-sonar-muted transition-colors hover:text-sonar"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  )
}
