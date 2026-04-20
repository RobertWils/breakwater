import { describe, it, expect } from "vitest";
import { normalizeAddress, isValidAddress } from "@/lib/addresses";

describe("normalizeAddress — ETHEREUM", () => {
  it("lowercases a valid mixed-case address", () => {
    const addr = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
    expect(normalizeAddress("ETHEREUM", addr)).toBe(addr.toLowerCase());
  });

  it("accepts an already-lowercase address", () => {
    const addr = "0xabcdef0123456789abcdef0123456789abcdef01";
    expect(normalizeAddress("ETHEREUM", addr)).toBe(addr);
  });

  it("trims leading and trailing whitespace before normalizing", () => {
    const addr = "  0xabcdef0123456789abcdef0123456789abcdef01  ";
    expect(normalizeAddress("ETHEREUM", addr)).toBe(
      "0xabcdef0123456789abcdef0123456789abcdef01",
    );
  });

  it("throws when the 0x prefix is missing", () => {
    expect(() =>
      normalizeAddress("ETHEREUM", "abcdef0123456789abcdef0123456789abcdef01"),
    ).toThrow("Invalid Ethereum address");
  });

  it("throws when the address is too short (39 hex chars)", () => {
    expect(() =>
      normalizeAddress("ETHEREUM", "0xabcdef0123456789abcdef0123456789abcde"),
    ).toThrow("Invalid Ethereum address");
  });

  it("throws when the address is too long (41 hex chars)", () => {
    expect(() =>
      normalizeAddress("ETHEREUM", "0xabcdef0123456789abcdef0123456789abcdef012"),
    ).toThrow("Invalid Ethereum address");
  });

  it("throws when the address contains non-hex characters", () => {
    // 'g' and 'z' are not valid hex chars
    expect(() =>
      normalizeAddress("ETHEREUM", "0xgggggg0123456789abcdef0123456789abcdef"),
    ).toThrow("Invalid Ethereum address");
  });
});

describe("normalizeAddress — SOLANA", () => {
  it("preserves case on a valid Solana address", () => {
    const addr = "So11111111111111111111111111111111111111112";
    expect(normalizeAddress("SOLANA", addr)).toBe(addr);
  });

  it("trims leading and trailing whitespace", () => {
    const addr = "  So11111111111111111111111111111111111111112  ";
    expect(normalizeAddress("SOLANA", addr)).toBe(
      "So11111111111111111111111111111111111111112",
    );
  });

  it("throws for addresses with invalid base58 chars (0, O, I, l)", () => {
    // '0' is not in the base58 alphabet
    expect(() =>
      normalizeAddress("SOLANA", "0o11111111111111111111111111111111111111112"),
    ).toThrow("Invalid Solana address");
  });

  it("throws when the address is too short (fewer than 32 chars)", () => {
    expect(() =>
      normalizeAddress("SOLANA", "So1111111111111111111111111111"),
    ).toThrow("Invalid Solana address");
  });

  it("throws when the address is too long (more than 44 chars)", () => {
    // 45 chars of valid base58
    expect(() =>
      normalizeAddress("SOLANA", "So111111111111111111111111111111111111111111112"),
    ).toThrow("Invalid Solana address");
  });
});

describe("isValidAddress", () => {
  it("returns true for a valid Ethereum address", () => {
    expect(
      isValidAddress("ETHEREUM", "0xabcdef0123456789abcdef0123456789abcdef01"),
    ).toBe(true);
  });

  it("returns false for an invalid Ethereum address without throwing", () => {
    expect(isValidAddress("ETHEREUM", "not-an-address")).toBe(false);
  });

  it("returns true for a valid Solana address", () => {
    expect(
      isValidAddress("SOLANA", "So11111111111111111111111111111111111111112"),
    ).toBe(true);
  });

  it("returns false for an invalid Solana address without throwing", () => {
    expect(isValidAddress("SOLANA", "!!!invalid!!!")).toBe(false);
  });
});
