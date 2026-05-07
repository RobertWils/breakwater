// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchContractAbi } from "../etherscan-client";

const TEST_ADDRESS = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("fetchContractAbi (Plan 02 D.1 — Etherscan v2 client)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete process.env.ETHERSCAN_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns missing_api_key when ETHERSCAN_API_KEY is unset", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing_api_key");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds the v2 URL with chainid=1, lowercased address, and apikey", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    const fetchMock =
      vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
        async () => jsonResponse({ status: "1", message: "OK", result: "[]" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fetchContractAbi(TEST_ADDRESS);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("api.etherscan.io/v2/api");
    expect(calledUrl).toContain("chainid=1");
    expect(calledUrl).toContain("apikey=test-key");
    expect(calledUrl).toContain(`address=${TEST_ADDRESS.toLowerCase()}`);
    expect(calledUrl).toContain("module=contract");
    expect(calledUrl).toContain("action=getabi");
  });

  it("returns the ABI string on a status='1' envelope", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "1",
          message: "OK",
          result: '[{"type":"function","name":"transfer"}]',
        }),
      ),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toContain("transfer");
    }
  });

  it("returns rate_limit on HTTP 429", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limit exceeded", { status: 429 })),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("rate_limit");
    }
  });

  it("classifies envelope status='0' with rate-limit text in result as rate_limit", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "0",
          message: "NOTOK",
          result: "Max calls per sec rate limit reached (5/sec)",
        }),
      ),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("rate_limit");
    }
  });

  it("classifies 'Contract source code not verified' as not_found", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "0",
          message: "NOTOK",
          result: "Contract source code not verified",
        }),
      ),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_found");
    }
  });

  it("classifies 'Missing/Invalid API Key' as missing_api_key", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "invalid-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "0",
          message: "NOTOK",
          result: "Missing/Invalid API Key",
        }),
      ),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing_api_key");
    }
  });

  it("returns network_error on fetch timeout (TimeoutError name)", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    const timeoutErr = new Error("aborted");
    timeoutErr.name = "TimeoutError";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw timeoutErr;
      }),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network_error");
      expect(result.message).toMatch(/timed out/);
    }
  });

  it("returns network_error on generic fetch rejection", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENETUNREACH");
      }),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network_error");
      expect(result.message).toBe("ENETUNREACH");
    }
  });

  it("returns network_error on non-2xx non-429 HTTP responses", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream down", { status: 502 })),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network_error");
      expect(result.message).toContain("502");
    }
  });

  it("returns invalid_response when status='1' result is not a string", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "1",
          message: "OK",
          result: { unexpected: "object" },
        }),
      ),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_response");
    }
  });

  it("returns invalid_response when response body is not valid JSON", async () => {
    vi.stubEnv("ETHERSCAN_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>maintenance</html>", { status: 200 })),
    );

    const result = await fetchContractAbi(TEST_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_response");
    }
  });
});
