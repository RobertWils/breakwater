// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createPublicClientMock = vi.fn<(config: unknown) => unknown>(() => ({
  getBlockNumber: vi.fn(async () => BigInt(20000000)),
}));
const httpMock = vi.fn<(...args: unknown[]) => unknown>((...args) => ({
  __transport: "http" as const,
  args,
}));
const fallbackMock = vi.fn<(...args: unknown[]) => unknown>((...args) => ({
  __transport: "fallback" as const,
  args,
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: createPublicClientMock,
    http: httpMock,
    fallback: fallbackMock,
  };
});

describe("publicClient module", () => {
  beforeEach(() => {
    createPublicClientMock.mockClear();
    httpMock.mockClear();
    fallbackMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("imports without errors", async () => {
    const { publicClient } = await import("../rpc-client");
    expect(publicClient).toBeDefined();
    expect(createPublicClientMock).toHaveBeenCalledOnce();
  });

  it("uses default Ankr + Cloudflare URLs when env vars unset", async () => {
    delete process.env.PRIMARY_ETH_RPC_URL;
    delete process.env.FALLBACK_ETH_RPC_URL;

    await import("../rpc-client");

    expect(httpMock).toHaveBeenNthCalledWith(1, "https://rpc.ankr.com/eth");
    expect(httpMock).toHaveBeenNthCalledWith(2, "https://cloudflare-eth.com");
  });

  it("respects custom URLs from env vars", async () => {
    vi.stubEnv("PRIMARY_ETH_RPC_URL", "https://custom-primary.example.com");
    vi.stubEnv("FALLBACK_ETH_RPC_URL", "https://custom-fallback.example.com");

    await import("../rpc-client");

    expect(httpMock).toHaveBeenNthCalledWith(
      1,
      "https://custom-primary.example.com",
    );
    expect(httpMock).toHaveBeenNthCalledWith(
      2,
      "https://custom-fallback.example.com",
    );
  });

  it("wires primary first, fallback second through fallback transport", async () => {
    vi.stubEnv("PRIMARY_ETH_RPC_URL", "https://primary.test");
    vi.stubEnv("FALLBACK_ETH_RPC_URL", "https://fallback.test");

    await import("../rpc-client");

    expect(fallbackMock).toHaveBeenCalledOnce();
    const [transports] = fallbackMock.mock.calls[0] as [
      Array<{ args: unknown[] }>,
    ];
    expect(transports).toHaveLength(2);
    expect(transports[0]?.args[0]).toBe("https://primary.test");
    expect(transports[1]?.args[0]).toBe("https://fallback.test");
  });

  it("enables multicall batching", async () => {
    await import("../rpc-client");

    const [config] = createPublicClientMock.mock.calls[0] as [
      { batch?: { multicall?: boolean } },
    ];
    expect(config.batch?.multicall).toBe(true);
  });
});
