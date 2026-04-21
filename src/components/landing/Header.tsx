import Link from "next/link"
import { Logo } from "@/components/brand/Logo"
import { Wordmark } from "@/components/brand/Wordmark"

export function Header() {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-md bg-base/60 border-b border-subtle">
      <div className="container mx-auto px-6 py-4 max-w-5xl">
        <Link href="/" className="flex items-center gap-3 w-fit">
          <Logo variant="color" size={32} />
          <Wordmark variant="solid" size="sm" />
        </Link>
      </div>
    </header>
  )
}
