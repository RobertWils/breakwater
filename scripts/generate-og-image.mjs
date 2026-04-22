import sharp from "sharp"

const ogSvg = `
<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0C1C3A"/>
      <stop offset="100%" stop-color="#17306B"/>
    </linearGradient>
    <linearGradient id="teal-sky" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#14B8A6"/>
      <stop offset="100%" stop-color="#38BDF8"/>
    </linearGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Break Line logo (V2 asymmetric peaks), scaled (64x32 paths scaled 4x = 256x128) -->
  <!-- translate so 256x128 block is centered: x = (1200-256)/2 = 472, y = 192 -->
  <g transform="translate(472, 192)" stroke-linecap="butt" stroke-linejoin="miter">
    <g transform="scale(4)">
      <path d="M 2 26 L 11 4 L 17 18"
            stroke="url(#teal-sky)" stroke-width="3" fill="none"/>
      <line x1="21" y1="5" x2="21" y2="19"
            stroke="url(#teal-sky)" stroke-width="4"/>
      <path d="M 25 14 L 33 22 L 43 16 L 52 24 L 62 20"
            stroke="url(#teal-sky)" stroke-width="3" fill="none"/>
    </g>
  </g>

  <!-- Wordmark, centered horizontally, below logo -->
  <text x="600" y="400"
        text-anchor="middle"
        font-family="Geist Sans, system-ui, sans-serif"
        font-size="72"
        font-weight="600"
        letter-spacing="-0.72"
        fill="#F1F5F9">
    Breakwater
  </text>

  <!-- Tagline -->
  <text x="600" y="460"
        text-anchor="middle"
        font-family="Geist Sans, system-ui, sans-serif"
        font-size="28"
        font-weight="400"
        fill="#A5B4CD">
    Continuous security monitoring for DeFi protocols
  </text>

  <!-- SVH attribution — bottom-right corner per spec §8.6 -->
  <text x="1160" y="595"
        text-anchor="end"
        font-family="Geist Mono, monospace"
        font-size="18"
        fill="#A5B4CD"
        opacity="0.6">
    A Singularity Venture Hub venture
  </text>
</svg>
`

await sharp(Buffer.from(ogSvg))
  .png()
  .toFile("./public/og-default.png")

console.log("Generated og-default.png")
