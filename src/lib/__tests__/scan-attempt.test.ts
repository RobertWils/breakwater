// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ScanAttemptValidationError,
  assertReasonRequired,
  createScanAttempt,
  type ScanAttemptClient,
} from "../scan-attempt";

const createMock = vi.fn(async ({ data }: { data: unknown }) => ({
  id: "fake-id",
  data,
})) as unknown as ScanAttemptClient["scanAttempt"]["create"];

const fakeClient: ScanAttemptClient = {
  scanAttempt: {
    create: createMock,
  },
};

describe("createScanAttempt wrapper", () => {
  beforeEach(() => {
    vi.mocked(createMock).mockClear();
  });

  it("ACCEPTED with reason=null is allowed and forwarded to prisma", async () => {
    await createScanAttempt(fakeClient, {
      ipHash: "ip",
      userAgent: "ua",
      cooldownKey: "key",
      inputPayloadHash: "hash",
      status: "ACCEPTED",
      reason: null,
      scanId: "scan-1",
    });
    expect(createMock).toHaveBeenCalledOnce();
    const call = vi.mocked(createMock).mock.calls[0]![0];
    expect(call.data.status).toBe("ACCEPTED");
    expect(call.data.reason).toBeNull();
  });

  it("INVALID with concrete reason is allowed", async () => {
    await createScanAttempt(fakeClient, {
      ipHash: "ip",
      userAgent: "ua",
      cooldownKey: "key",
      inputPayloadHash: "hash",
      status: "INVALID",
      reason: "rate_limit",
      scanId: null,
    });
    expect(createMock).toHaveBeenCalledOnce();
  });

  it("INVALID with reason=null throws and does not call prisma", async () => {
    await expect(
      createScanAttempt(fakeClient, {
        ipHash: "ip",
        userAgent: "ua",
        cooldownKey: "key",
        inputPayloadHash: "hash",
        status: "INVALID",
        reason: null,
        scanId: null,
      }),
    ).rejects.toBeInstanceOf(ScanAttemptValidationError);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("INVALID with empty-string reason throws", async () => {
    await expect(
      createScanAttempt(fakeClient, {
        ipHash: "ip",
        userAgent: "ua",
        cooldownKey: "key",
        inputPayloadHash: "hash",
        status: "INVALID",
        reason: "",
        scanId: null,
      }),
    ).rejects.toBeInstanceOf(ScanAttemptValidationError);
  });

  it("RATE_LIMITED, ERROR, and DUPLICATE all require a reason", () => {
    expect(() => assertReasonRequired("RATE_LIMITED", null)).toThrow(
      ScanAttemptValidationError,
    );
    expect(() => assertReasonRequired("ERROR", null)).toThrow(
      ScanAttemptValidationError,
    );
    expect(() => assertReasonRequired("DUPLICATE", null)).toThrow(
      ScanAttemptValidationError,
    );
  });

  it("ACCEPTED with reason=null does not throw at the assertion layer", () => {
    expect(() => assertReasonRequired("ACCEPTED", null)).not.toThrow();
  });
});
