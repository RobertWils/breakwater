import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import "./globals.css"
import "../styles/tokens.css"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://breakwater.vercel.app"

export const metadata = {
  title: "Breakwater — DeFi Security Monitoring",
  description: "Continuous security monitoring for DeFi protocols. Governance, oracle, signer, and frontend patterns behind $600M+ in 2026 hacks.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    url: siteUrl,
    title: "Breakwater — DeFi Security Monitoring",
    description: "Continuous security monitoring for DeFi protocols.",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body>{children}</body>
    </html>
  )
}
