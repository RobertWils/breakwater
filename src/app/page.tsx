import { Logo } from "@/components/brand/Logo"
import { Wordmark } from "@/components/brand/Wordmark"

export default function HomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-2xl glass-card-teal p-12 text-center space-y-6">
        <Logo variant="color" size={48} className="mx-auto" />
        <Wordmark variant="gradient" size="xl" />
        <p className="text-xl text-muted">
          Continuous security monitoring for DeFi protocols
        </p>
        <p className="font-mono text-sm text-muted">
          Landing page coming in Phase F
        </p>
      </div>
    </main>
  )
}
