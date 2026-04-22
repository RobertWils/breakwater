import Image from "next/image"

interface LogoProps {
  variant?: "color" | "mono-dark" | "mono-light"
  size?: number // height in px, width auto-scales by 2:1 ratio
  className?: string
}

const sources = {
  "color": "/logo.svg",
  "mono-dark": "/logo-mono-dark.svg",
  "mono-light": "/logo-mono-light.svg",
}

export function Logo({
  variant = "color",
  size = 32,
  className = "",
}: LogoProps) {
  return (
    <Image
      src={sources[variant]}
      alt="Breakwater"
      width={size * 2}
      height={size}
      className={className}
      priority
    />
  )
}
