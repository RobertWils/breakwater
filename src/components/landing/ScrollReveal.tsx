"use client"

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion"
import { useRef } from "react"
import type { ReactNode } from "react"

interface ScrollRevealProps {
  children: ReactNode
  delay?: number
  className?: string
}

export function ScrollReveal({ children, delay = 0, className }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const shouldReduceMotion = useReducedMotion()

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })

  const opacity = useTransform(
    scrollYProgress,
    [0, 0.2, 0.8, 1],
    [0, 1, 1, 0]
  )

  const y = useTransform(
    scrollYProgress,
    [0, 0.2, 0.8, 1],
    [20, 0, 0, -20]
  )

  if (shouldReduceMotion) {
    return <div ref={ref} className={className}>{children}</div>
  }

  return (
    <motion.div
      ref={ref}
      style={{ opacity, y }}
      transition={{ delay }}
      className={className}
    >
      {children}
    </motion.div>
  )
}
