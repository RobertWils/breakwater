import { describe, it, expect } from "vitest";
import { cooldownKey } from "@/lib/cooldown";

describe("cooldownKey", () => {
  it("formats as CHAIN:address", () => {
    expect(cooldownKey("ETHEREUM", "0xabcdef0123456789abcdef0123456789abcdef01")).toBe(
      "ETHEREUM:0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("formats correctly for SOLANA chain", () => {
    expect(
      cooldownKey("SOLANA", "So11111111111111111111111111111111111111112"),
    ).toBe("SOLANA:So11111111111111111111111111111111111111112");
  });

  it("different chains produce different keys for the same address", () => {
    const addr = "0xabcdef0123456789abcdef0123456789abcdef01";
    expect(cooldownKey("ETHEREUM", addr)).not.toBe(cooldownKey("SOLANA", addr));
  });

  it("different addresses produce different keys for the same chain", () => {
    expect(
      cooldownKey("ETHEREUM", "0xaaaa000000000000000000000000000000000001"),
    ).not.toBe(
      cooldownKey("ETHEREUM", "0xbbbb000000000000000000000000000000000002"),
    );
  });

  it("is deterministic — same inputs always produce same key", () => {
    const addr = "0xabcdef0123456789abcdef0123456789abcdef01";
    expect(cooldownKey("ETHEREUM", addr)).toBe(cooldownKey("ETHEREUM", addr));
  });
});
