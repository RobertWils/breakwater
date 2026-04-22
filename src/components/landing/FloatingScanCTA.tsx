"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"

export function FloatingScanCTA() {
  const [isVisible, setIsVisible] = useState(false)
  const shouldReduceMotion = useReducedMotion()

  useEffect(() => {
    const statsSection = document.getElementById("stats")
    if (!statsSection) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.boundingClientRect.top < 0) {
            setIsVisible(true)
          } else {
            setIsVisible(false)
          }
        })
      },
      { threshold: 0 }
    )

    observer.observe(statsSection)

    return () => observer.disconnect()
  }, [])

  const animationProps = shouldReduceMotion
    ? {}
    : {
        initial: { opacity: 0, y: 20, scale: 0.9 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 20, scale: 0.9 },
        transition: { duration: 0.2 },
      }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          {...animationProps}
          className="hidden md:block fixed bottom-8 right-8 z-20"
        >
          <a
            href="#hero"
            className="inline-flex items-center gap-2 px-6 py-3 bg-teal text-[#0C1C3A] font-semibold rounded-lg shadow-lg hover:bg-teal/90 transition-colors"
          >
            Scan your protocol
            <span aria-hidden="true">→</span>
          </a>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
