// @vitest-environment node
import { describe, expect, it } from "vitest";

import { generateSlug } from "../scan-submission";

describe("generateSlug — 14-char prefix (Plan 02 B.3)", () => {
  it("generates a slug with 12 hex chars after 0x for Ethereum addresses", () => {
    const slug = generateSlug(
      "ETHEREUM",
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
    expect(slug).toBe("ethereum-0xabcdef012345");
  });

  it("distinguishes addresses sharing the first 8 chars but differing in chars 9-14", () => {
    const slug1 = generateSlug(
      "ETHEREUM",
      "0xabcdef011234567890abcdef0123456789abcdef",
    );
    const slug2 = generateSlug(
      "ETHEREUM",
      "0xabcdef019876543210abcdef0123456789abcdef",
    );
    expect(slug1).not.toBe(slug2);
    expect(slug1).toBe("ethereum-0xabcdef011234");
    expect(slug2).toBe("ethereum-0xabcdef019876");
  });

  it("generates a 14-char slug for Solana base58 addresses", () => {
    const slug = generateSlug(
      "SOLANA",
      "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    );
    // Base58 case-sensitivity caveat (pre-existing, tracked in NOTES.md):
    // .toLowerCase() corrupts uniqueness for Solana. This test asserts the
    // CURRENT behavior so accidental fixes/regressions get caught explicitly.
    expect(slug).toBe("solana-driftyha39mwei");
  });
});
