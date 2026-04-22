interface WordmarkProps {
  variant?: "solid" | "gradient"
  size?: "sm" | "md" | "lg" | "xl"
  className?: string
}

const sizes = {
  sm: "text-xl",
  md: "text-2xl",
  lg: "text-4xl",
  xl: "text-6xl",
}

export function Wordmark({
  variant = "solid",
  size = "md",
  className = "",
}: WordmarkProps) {
  const baseClasses = `font-sans font-semibold [letter-spacing:-0.01em] ${sizes[size]} ${className}`

  if (variant === "gradient") {
    return (
      <span
        className={`${baseClasses} bg-gradient-to-r from-teal to-sky bg-clip-text text-transparent`}
      >
        Breakwater
      </span>
    )
  }

  return (
    <span className={`${baseClasses} text-primary`}>
      Breakwater
    </span>
  )
}
