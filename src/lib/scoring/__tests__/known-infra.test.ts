import { describe, expect, it } from "vitest";

import { isKnownInfra } from "../known-infra";

describe("isKnownInfra (Fase 1.2 hook, empty allowlist)", () => {
  it("returns false for any address while the allowlist is empty", () => {
    expect(isKnownInfra("0x0000000000000000000000000000000000000001")).toBe(false);
    expect(isKnownInfra("0xACFE4511CE883C14C4EA40563F176C3C09B4C47C")).toBe(false);
  });

  it("returns false for null/undefined/empty", () => {
    expect(isKnownInfra(null)).toBe(false);
    expect(isKnownInfra(undefined)).toBe(false);
    expect(isKnownInfra("")).toBe(false);
  });
});
