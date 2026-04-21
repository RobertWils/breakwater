import sharp from "sharp"
import { readFileSync } from "fs"

const svg = readFileSync("./public/favicon.svg")

const sizes = [
  { size: 16, name: "favicon-16.png" },
  { size: 32, name: "favicon-32.png" },
  { size: 180, name: "apple-touch-icon.png" },
  { size: 192, name: "favicon-192.png" },
  { size: 512, name: "favicon-512.png" },
]

for (const { size, name } of sizes) {
  await sharp(svg)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(`./public/${name}`)
  console.log(`Generated ${name}`)
}
