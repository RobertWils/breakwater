import fs from "fs/promises"
import path from "path"
import { marked } from "marked"
import { Header } from "@/components/landing/Header"
import { Footer } from "@/components/landing/Footer"

export const metadata = {
  title: "Privacy Policy — Breakwater",
  description: "How Breakwater handles your data and scan submissions.",
}

export default async function PrivacyPage() {
  const mdPath = path.join(process.cwd(), "PRIVACY.md")
  const mdContent = await fs.readFile(mdPath, "utf-8")
  const htmlContent = await marked(mdContent)

  return (
    <>
      <Header />
      <main className="min-h-screen py-24">
        <div className="container mx-auto px-6 max-w-3xl">
          <div className="glass-card p-10">
            <article
              className="prose prose-invert max-w-none
                prose-headings:font-semibold
                prose-h1:text-4xl prose-h1:mb-6
                prose-h2:text-2xl prose-h2:mt-8 prose-h2:mb-4
                prose-h3:text-xl prose-h3:mt-6
                prose-p:text-muted prose-p:leading-relaxed
                prose-a:text-teal prose-a:no-underline hover:prose-a:underline
                prose-strong:text-primary
                prose-code:text-sky prose-code:bg-elevated/40 prose-code:px-1 prose-code:py-0.5 prose-code:rounded
                prose-ul:text-muted prose-li:my-1"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          </div>
        </div>
      </main>
      <Footer />
    </>
  )
}
