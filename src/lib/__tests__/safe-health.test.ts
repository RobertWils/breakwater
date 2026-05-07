// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchSafeInfoMock = vi.fn();

vi.mock("../safe-client", () => ({
  fetchSafeInfo: fetchSafeInfoMock,
}));

describe("checkSafeApiHealth (Plan 02 D.2)", () => {
  beforeEach(() => {
    fetchSafeInfoMock.mockReset();
    vi.unstubAllEnvs();
    delete process.env.SAFE_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fetchSafeInfoMock.mockReset();
  });

  it("returns reachable=true / hasApiKey=false on success without an API key", async () => {
    fetchSafeInfoMock.mockResolvedValueOnce({
      ok: true,
      data: {
        address: "0x849D52316331967b6fF1198e5E32A0eB168D039d",
        threshold: 3,
        owners: ["0x1", "0x2", "0x3"],
        nonce: 1,
      },
    });
    const { checkSafeApiHealth } = await import("../safe-health");

    const result = await checkSafeApiHealth();

    expect(result).toEqual({ reachable: true, hasApiKey: false, error: null });
  });

  it("returns hasApiKey=true on success when SAFE_API_KEY is configured", async () => {
    vi.stubEnv("SAFE_API_KEY", "test-bearer-token");
    fetchSafeInfoMock.mockResolvedValueOnce({
      ok: true,
      data: {
        address: "0x849D52316331967b6fF1198e5E32A0eB168D039d",
        threshold: 3,
        owners: ["0x1", "0x2", "0x3"],
        nonce: 1,
      },
    });
    const { checkSafeApiHealth } = await import("../safe-health");

    const result = await checkSafeApiHealth();

    expect(result).toEqual({ reachable: true, hasApiKey: true, error: null });
  });

  it("treats not_a_safe on the canonical health address as reachable=true with a defensive error message", async () => {
    fetchSafeInfoMock.mockResolvedValueOnce({
      ok: false,
      reason: "not_a_safe",
      message: "Address ... is not registered as a Safe",
    });
    const { checkSafeApiHealth } = await import("../safe-health");

    const result = await checkSafeApiHealth();

    expect(result.reachable).toBe(true);
    expect(result.hasApiKey).toBe(false);
    expect(result.error).toMatch(/Gnosis DAO|deregistered|upstream/);
  });

  it("returns reachable=false on rate_limit", async () => {
    fetchSafeInfoMock.mockResolvedValueOnce({
      ok: false,
      reason: "rate_limit",
      message: "Safe API rate limit hit (HTTP 429)",
    });
    const { checkSafeApiHealth } = await import("../safe-health");

    const result = await checkSafeApiHealth();

    expect(result.reachable).toBe(false);
    expect(result.error).toMatch(/rate limit/i);
  });

  it("returns reachable=false on network_error", async () => {
    fetchSafeInfoMock.mockResolvedValueOnce({
      ok: false,
      reason: "network_error",
      message: "ENETUNREACH",
    });
    const { checkSafeApiHealth } = await import("../safe-health");

    const result = await checkSafeApiHealth();

    expect(result.reachable).toBe(false);
    expect(result.error).toBe("ENETUNREACH");
  });
});
