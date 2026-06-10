import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import ScanNewPage from "../page"

// next/image (used by the brand Logo in SonarHeader) → render nothing in jsdom.
vi.mock("next/image", () => ({ default: () => null }))

afterEach(() => cleanup())

describe("/scan/new — multi-contract input shell", () => {
  it("renders the Sonar shell with title, multi-contract subtitle, and a placeholder card", () => {
    const { container } = render(<ScanNewPage />)

    expect(
      screen.getByRole("heading", { name: /scan a full protocol/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/multi-contract scan/i)).toBeInTheDocument()
    expect(screen.getByText(/scores the whole graph together/i)).toBeInTheDocument()
    // Placeholder input container (filled in D.2).
    expect(screen.getByText(/coming next/i)).toBeInTheDocument()

    // Sonar shell + card frame present.
    expect(container.querySelector(".sonar-theme")).not.toBeNull()
    expect(container.querySelector(".sonar-card")).not.toBeNull()
  })
})
