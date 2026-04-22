import Link from "next/link"

export function Footer() {
  return (
    <footer className="py-12 border-t border-subtle">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="text-sm text-muted">
              A{" "}
              <a
                href="https://singularityventurehub.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal hover:underline"
              >
                Singularity Venture Hub
              </a>{" "}
              venture
            </p>
            <p className="text-xs text-muted/60 font-mono mt-1">
              © 2026 Breakwater
            </p>
          </div>

          <nav aria-label="Legal links">
            <ul className="flex gap-6 text-sm">
              <li>
                <Link
                  href="/privacy"
                  className="text-muted hover:text-primary transition-colors"
                >
                  Privacy
                </Link>
              </li>
              <li>
                <Link
                  href="/terms"
                  className="text-muted hover:text-primary transition-colors"
                >
                  Terms
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </div>
    </footer>
  )
}
