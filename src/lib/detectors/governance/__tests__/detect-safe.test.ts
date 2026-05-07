// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/safe-client", () => ({
  fetchSafeInfo: vi.fn(),
}));

import { fetchSafeInfo } from "@/lib/safe-client";

import { detectSafe } from "../detect-safe";

const fetchSafeInfoMock = vi.mocked(fetchSafeInfo);

const SAFE_ADDR = "0x849d52316331967b6ff1198e5e32a0eb168d039d";
const NON_SAFE_ADDR = "0x1c91347f2a44538ce62453bebd9aa907c662b4bd";

describe("detectSafe (Plan 02 D.3b)", () => {
  beforeEach(() => {
    fetchSafeInfoMock.mockReset();
  });

  it("returns isSafe:true with owners + threshold for a confirmed Safe", async () => {
    fetchSafeInfoMock.mockResolvedValue({
      ok: true,
      data: {
        address: SAFE_ADDR,
        threshold: 3,
        owners: [
          "0x1111111111111111111111111111111111111111",
          "0x2222222222222222222222222222222222222222",
          "0x3333333333333333333333333333333333333333",
          "0x4444444444444444444444444444444444444444",
          "0x5555555555555555555555555555555555555555",
        ],
        nonce: 42,
      },
    });

    const result = await detectSafe({ candidateAddress: SAFE_ADDR });

    expect(result.isSafe).toBe(true);
    if (result.isSafe) {
      expect(result.threshold).toBe(3);
      expect(result.ownerCount).toBe(5);
      expect(result.owners).toHaveLength(5);
    }
  });

  it("returns isSafe:false with reason='not_a_safe' on confirmed 404 (first-class signal)", async () => {
    fetchSafeInfoMock.mockResolvedValue({
      ok: false,
      reason: "not_a_safe",
      message: "Address ... is not registered as a Safe",
    });

    const result = await detectSafe({ candidateAddress: NON_SAFE_ADDR });

    expect(result.isSafe).toBe(false);
    if (!result.isSafe) {
      expect(result.reason).toBe("not_a_safe");
    }
  });

  it("maps rate_limit to api_unavailable (transient, not a finding)", async () => {
    fetchSafeInfoMock.mockResolvedValue({
      ok: false,
      reason: "rate_limit",
      message: "Safe API rate limit hit (HTTP 429)",
    });

    const result = await detectSafe({ candidateAddress: SAFE_ADDR });

    expect(result.isSafe).toBe(false);
    if (!result.isSafe) {
      expect(result.reason).toBe("api_unavailable");
      expect(result.errorMessage).toMatch(/rate limit/i);
    }
  });

  it("maps network_error to api_unavailable", async () => {
    fetchSafeInfoMock.mockResolvedValue({
      ok: false,
      reason: "network_error",
      message: "Network timeout",
    });

    const result = await detectSafe({ candidateAddress: SAFE_ADDR });

    expect(result.isSafe).toBe(false);
    if (!result.isSafe) {
      expect(result.reason).toBe("api_unavailable");
      expect(result.errorMessage).toBe("Network timeout");
    }
  });

  it("maps invalid_response to api_unavailable", async () => {
    fetchSafeInfoMock.mockResolvedValue({
      ok: false,
      reason: "invalid_response",
      message: "Safe API returned unexpected shape",
    });

    const result = await detectSafe({ candidateAddress: SAFE_ADDR });

    expect(result.isSafe).toBe(false);
    if (!result.isSafe) {
      expect(result.reason).toBe("api_unavailable");
    }
  });

  it("lowercases all addresses in the result (input address, Safe address, owner addresses)", async () => {
    const upperCandidate = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
    fetchSafeInfoMock.mockResolvedValue({
      ok: true,
      data: {
        address: "0xABCDEF1234567890ABCDEF1234567890ABCDEF12",
        threshold: 2,
        owners: [
          "0xOWNER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          "0xOWNER2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        ],
        nonce: 0,
      },
    });

    const result = await detectSafe({ candidateAddress: upperCandidate });

    expect(result.isSafe).toBe(true);
    if (result.isSafe) {
      expect(result.address).toBe(upperCandidate.toLowerCase());
      expect(result.owners[0]).toBe(
        "0xowner1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      );
      expect(result.owners[1]).toBe(
        "0xowner2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
    }
  });

  it("preserves the candidate address (lowercased) on not_a_safe + api_unavailable paths", async () => {
    const upperCandidate = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
    fetchSafeInfoMock.mockResolvedValue({
      ok: false,
      reason: "not_a_safe",
      message: "Address ... is not registered as a Safe",
    });

    const result = await detectSafe({ candidateAddress: upperCandidate });

    expect(result.isSafe).toBe(false);
    expect(result.address).toBe(upperCandidate.toLowerCase());
  });
});
