import { Header } from "@/components/landing/Header"
import { Footer } from "@/components/landing/Footer"

export const metadata = {
  title: "Terms of Service — Breakwater",
}

export default function TermsPage() {
  return (
    <>
      <Header />
      <main className="min-h-screen py-24">
        <div className="container mx-auto px-6 max-w-3xl">
          <div className="glass-card p-10 text-center space-y-4">
            <h1 className="text-3xl font-semibold text-primary">
              Terms of Service
            </h1>
            <p className="text-muted">
              Our Terms of Service are being finalized and will be published soon.
            </p>
            <p className="text-sm text-muted/60">
              For questions in the meantime, contact{" "}
              <a
                href="mailto:security@breakwater.xyz"
                className="text-teal hover:underline"
              >
                security@breakwater.xyz
              </a>{" "}
              (domain and mailbox confirmation pending).
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
