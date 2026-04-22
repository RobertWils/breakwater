import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import "./globals.css"
import "../styles/tokens.css"

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://breakwater.vercel.app"

export const metadata: Metadata = {
  title: "Breakwater — DeFi Security Monitoring",
  description: "We catch the attacks before they reach shore. The governance, oracle, signer, and frontend patterns behind $600M+ in 2026 DeFi hacks — detected continuously.",
  metadataBase: new URL(siteUrl),
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "Breakwater — DeFi Security Monitoring",
    description: "Continuous security monitoring for DeFi protocols",
    url: siteUrl,
    siteName: "Breakwater",
    images: [
      {
        url: "/og-default.png",
        width: 1200,
        height: 630,
        alt: "Breakwater — Continuous security monitoring for DeFi protocols",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Breakwater — DeFi Security Monitoring",
    description: "Continuous security monitoring for DeFi protocols",
    images: ["/og-default.png"],
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
