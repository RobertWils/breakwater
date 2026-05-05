// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getBlockNumberMock = vi.fn();

vi.mock("../rpc-client", () => ({
  publicClient: {
    getBlockNumber: getBlockNumberMock,
  },
}));

describe("checkRpcHealth", () => {
  beforeEach(() => {
    getBlockNumberMock.mockReset();
  });

  it("returns reachable=true with block number when RPC succeeds", async () => {
    getBlockNumberMock.mockResolvedValueOnce(BigInt(20_000_000));
    const { checkRpcHealth } = await import("../rpc-health");

    const result = await checkRpcHealth();
    expect(result.reachable).toBe(true);
    expect(result.blockNumber).toBe(BigInt(20_000_000));
    expect(result.error).toBeNull();
  });

  it("returns reachable=false with error message when RPC fails", async () => {
    getBlockNumberMock.mockRejectedValueOnce(
      new Error("All transports failed"),
    );
    const { checkRpcHealth } = await import("../rpc-health");

    const result = await checkRpcHealth();
    expect(result.reachable).toBe(false);
    expect(result.blockNumber).toBeNull();
    expect(result.error).toBe("All transports failed");
  });

  it("stringifies non-Error rejections", async () => {
    getBlockNumberMock.mockRejectedValueOnce("network down");
    const { checkRpcHealth } = await import("../rpc-health");

    const result = await checkRpcHealth();
    expect(result.reachable).toBe(false);
    expect(result.error).toBe("network down");
  });
});
