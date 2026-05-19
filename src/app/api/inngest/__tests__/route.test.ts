// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

const assertSpy = vi.fn();
const getMock = vi.fn(async () => new Response("ok-get", { status: 200 }));
const postMock = vi.fn(async () => new Response("ok-post", { status: 200 }));
const putMock = vi.fn(async () => new Response("ok-put", { status: 200 }));

vi.mock("@/lib/config", () => ({
  assertProductionInngestConfig: assertSpy,
  // Re-export the salt assertion so unrelated imports still resolve.
  assertProductionHashSalts: vi.fn(),
}));

vi.mock("inngest/next", () => ({
  serve: () => ({
    GET: getMock,
    POST: postMock,
    PUT: putMock,
  }),
}));

const fakeRequest = (method: string): NextRequest =>
  new Request(`http://localhost/api/inngest`, { method }) as NextRequest;

describe("/api/inngest route", () => {
  beforeEach(() => {
    assertSpy.mockClear();
    getMock.mockClear();
    postMock.mockClear();
    putMock.mockClear();
  });

  it("GET invokes assertProductionInngestConfig and delegates to inngest serve", async () => {
    const { GET } = await import("../route");
    const res = await GET(fakeRequest("GET"));
    expect(assertSpy).toHaveBeenCalledOnce();
    expect(getMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it("POST invokes assertProductionInngestConfig and delegates", async () => {
    const { POST } = await import("../route");
    const res = await POST(fakeRequest("POST"));
    expect(assertSpy).toHaveBeenCalledOnce();
    expect(postMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it("PUT invokes assertProductionInngestConfig and delegates", async () => {
    const { PUT } = await import("../route");
    const res = await PUT(fakeRequest("PUT"));
    expect(assertSpy).toHaveBeenCalledOnce();
    expect(putMock).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
  });

  it("propagates production assertion failures (does not delegate when assertion throws)", async () => {
    assertSpy.mockImplementationOnce(() => {
      throw new Error("[config] missing INNGEST_EVENT_KEY");
    });
    const { POST } = await import("../route");
    await expect(POST(fakeRequest("POST"))).rejects.toThrow(
      /INNGEST_EVENT_KEY/,
    );
    expect(postMock).not.toHaveBeenCalled();
  });
});
