// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchContractAbiMock = vi.fn();

vi.mock("../etherscan-client", () => ({
  fetchContractAbi: fetchContractAbiMock,
}));

describe("checkEtherscanHealth (Plan 02 D.1)", () => {
  beforeEach(() => {
    fetchContractAbiMock.mockReset();
  });

  afterEach(() => {
    fetchContractAbiMock.mockReset();
  });

  it("returns reachable=true / hasApiKey=true on a successful ABI lookup", async () => {
    fetchContractAbiMock.mockResolvedValueOnce({
      ok: true,
      data: '[{"type":"function","name":"transfer"}]',
    });
    const { checkEtherscanHealth } = await import("../etherscan-health");

    const result = await checkEtherscanHealth();

    expect(result).toEqual({ reachable: true, hasApiKey: true, error: null });
  });

  it("returns hasApiKey=false / reachable=false when the client reports missing_api_key", async () => {
    fetchContractAbiMock.mockResolvedValueOnce({
      ok: false,
      reason: "missing_api_key",
      message: "ETHERSCAN_API_KEY env var not set; GOV-002 will be skipped",
    });
    const { checkEtherscanHealth } = await import("../etherscan-health");

    const result = await checkEtherscanHealth();

    expect(result.reachable).toBe(false);
    expect(result.hasApiKey).toBe(false);
    expect(result.error).toMatch(/ETHERSCAN_API_KEY/);
  });

  it("returns reachable=false / hasApiKey=true on rate_limit (key configured, upstream throttled)", async () => {
    fetchContractAbiMock.mockResolvedValueOnce({
      ok: false,
      reason: "rate_limit",
      message: "Etherscan rate limit hit (HTTP 429)",
    });
    const { checkEtherscanHealth } = await import("../etherscan-health");

    const result = await checkEtherscanHealth();

    expect(result.reachable).toBe(false);
    expect(result.hasApiKey).toBe(true);
    expect(result.error).toMatch(/rate limit/i);
  });

  it("returns reachable=false / hasApiKey=true on network_error", async () => {
    fetchContractAbiMock.mockResolvedValueOnce({
      ok: false,
      reason: "network_error",
      message: "ENETUNREACH",
    });
    const { checkEtherscanHealth } = await import("../etherscan-health");

    const result = await checkEtherscanHealth();

    expect(result.reachable).toBe(false);
    expect(result.hasApiKey).toBe(true);
    expect(result.error).toBe("ENETUNREACH");
  });
});
