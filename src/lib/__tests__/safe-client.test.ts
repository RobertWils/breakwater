// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchSafeInfo } from "../safe-client";

const SAMPLE_ADDRESS = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

function makeFetchMock(
  impl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> | Response,
) {
  return vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    async (input, init) => Promise.resolve(impl(input, init)),
  );
}

const validSafeBody = {
  address: SAMPLE_ADDRESS.toLowerCase(),
  threshold: 3,
  owners: [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
    "0x4444444444444444444444444444444444444444",
    "0x5555555555555555555555555555555555555555",
  ],
  nonce: 42,
};

describe("fetchSafeInfo (Plan 02 D.2 — Safe Transaction Service client)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    delete process.env.SAFE_API_BASE_URL;
    delete process.env.SAFE_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns Safe info on a 200 response with the expected shape", async () => {
    vi.stubGlobal("fetch", makeFetchMock(() => jsonResponse(validSafeBody)));

    const result = await fetchSafeInfo(SAMPLE_ADDRESS);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.threshold).toBe(3);
      expect(result.data.owners).toHaveLength(5);
      expect(result.data.nonce).toBe(42);
    }
  });

  it("returns not_a_safe on HTTP 404 (first-class signal for GOV-003)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() => new Response("Not Found", { status: 404 })),
    );

    const result = await fetchSafeInfo("0x1c91347f2A44538ce62453BEBd9Aa907C662b4bD");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("not_a_safe");
      expect(result.message).toContain("not registered as a Safe");
    }
  });

  it("returns rate_limit on HTTP 429", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() => new Response("Too Many Requests", { status: 429 })),
    );

    const result = await fetchSafeInfo(SAMPLE_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("rate_limit");
    }
  });

  it("builds URL with /api/v1/safes/{lowercased-address}/ trailing-slash path", async () => {
    const fetchMock = makeFetchMock(() => jsonResponse(validSafeBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSafeInfo(SAMPLE_ADDRESS);

    expect(fetchMock).toHaveBeenCalledOnce();
    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain(
      `/api/v1/safes/${SAMPLE_ADDRESS.toLowerCase()}/`,
    );
  });

  it("uses default base URL when SAFE_API_BASE_URL is unset", async () => {
    const fetchMock = makeFetchMock(() => jsonResponse(validSafeBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSafeInfo(SAMPLE_ADDRESS);

    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("api.safe.global/tx-service/eth");
  });

  it("respects custom SAFE_API_BASE_URL via vi.stubEnv (no resetModules needed — env is read at call time)", async () => {
    vi.stubEnv("SAFE_API_BASE_URL", "https://custom.safe.example");
    const fetchMock = makeFetchMock(() => jsonResponse(validSafeBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSafeInfo(SAMPLE_ADDRESS);

    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).toContain("custom.safe.example");
  });

  it("normalises a trailing slash on SAFE_API_BASE_URL (no //api/ in the constructed URL)", async () => {
    vi.stubEnv("SAFE_API_BASE_URL", "https://api.safe.global/tx-service/eth/");
    const fetchMock = makeFetchMock(() => jsonResponse(validSafeBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSafeInfo(SAMPLE_ADDRESS);

    const calledUrl = String(fetchMock.mock.calls[0]![0]);
    expect(calledUrl).not.toMatch(/\/\/api\/v1\//);
    expect(calledUrl).toContain("/api/v1/safes/");
  });

  it("adds Authorization: Bearer header when SAFE_API_KEY is set", async () => {
    vi.stubEnv("SAFE_API_KEY", "test-bearer-key");
    const fetchMock = makeFetchMock(() => jsonResponse(validSafeBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSafeInfo(SAMPLE_ADDRESS);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-bearer-key");
  });

  it("omits Authorization header when SAFE_API_KEY is unset", async () => {
    const fetchMock = makeFetchMock(() => jsonResponse(validSafeBody));
    vi.stubGlobal("fetch", fetchMock);

    await fetchSafeInfo(SAMPLE_ADDRESS);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("returns invalid_response when required fields are missing from body", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() => jsonResponse({ address: "0xabc" })),
    );

    const result = await fetchSafeInfo(SAMPLE_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_response");
    }
  });

  it("returns invalid_response when owners contains non-string elements (D.5 I1)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() =>
        jsonResponse({
          address: "0xabc",
          threshold: 2,
          owners: [
            123, // numeric instead of address string
            "0x2222222222222222222222222222222222222222",
          ],
        }),
      ),
    );

    const result = await fetchSafeInfo(SAMPLE_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid_response");
      expect(result.message).toMatch(/malformed/i);
    }
  });

  it("returns network_error on TimeoutError", async () => {
    const timeoutErr = new Error("aborted");
    timeoutErr.name = "TimeoutError";
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() => {
        throw timeoutErr;
      }),
    );

    const result = await fetchSafeInfo(SAMPLE_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network_error");
      expect(result.message).toMatch(/timed out/);
    }
  });

  it("returns network_error on generic fetch rejection", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() => {
        throw new Error("ECONNRESET");
      }),
    );

    const result = await fetchSafeInfo(SAMPLE_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network_error");
      expect(result.message).toBe("ECONNRESET");
    }
  });

  it("returns network_error on non-2xx non-404 non-429 status (e.g., 502)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchMock(() => new Response("upstream down", { status: 502 })),
    );

    const result = await fetchSafeInfo(SAMPLE_ADDRESS);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network_error");
      expect(result.message).toContain("502");
    }
  });
});
