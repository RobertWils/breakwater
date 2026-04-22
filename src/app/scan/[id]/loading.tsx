import { Header } from "@/components/landing/Header"
import { Footer } from "@/components/landing/Footer"

export default function ScanLoading() {
  return (
    <>
      <Header />
      <main className="min-h-screen py-12 md:py-16">
        <div className="container mx-auto px-6 max-w-5xl space-y-6">
          <div className="glass-card p-8 animate-pulse">
            <div className="h-4 bg-elevated/50 rounded w-32 mb-3" />
            <div className="h-8 bg-elevated/50 rounded w-64" />
          </div>

          <div className="glass-card p-12 animate-pulse text-center">
            <div className="h-20 bg-elevated/50 rounded w-32 mx-auto mb-4" />
            <div className="h-4 bg-elevated/50 rounded w-48 mx-auto" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="glass-card p-6 animate-pulse">
                <div className="h-5 bg-elevated/50 rounded w-24 mb-3" />
                <div className="h-4 bg-elevated/50 rounded w-full" />
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
