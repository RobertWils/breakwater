import { describe, expect, it } from "vitest";

import { parseMinimalProxyTarget } from "../eip1167";

// Canonical EIP-1167 runtime: 363d3d373d3d3d363d73 <20-byte addr> 5af43d82803e903d91602b57fd5bf3
const ADDR = "bebc44782c7db0a1a60cb6fe97d0b483032ff1c7";
const CANONICAL = `0x363d3d373d3d3d363d73${ADDR}5af43d82803e903d91602b57fd5bf3`;

describe("parseMinimalProxyTarget", () => {
  it("extracts the delegate target from canonical EIP-1167 runtime bytecode", () => {
    expect(parseMinimalProxyTarget(CANONICAL)).toBe(`0x${ADDR}`);
  });

  it("is case-insensitive and lowercases the result", () => {
    expect(parseMinimalProxyTarget(CANONICAL.toUpperCase())).toBe(`0x${ADDR}`);
  });

  it("returns null for non-proxy bytecode", () => {
    expect(parseMinimalProxyTarget("0x6080604052348015600f57600080fd")).toBeNull();
  });

  it("returns null when the length is wrong (right prefix, truncated)", () => {
    expect(parseMinimalProxyTarget("0x363d3d373d3d3d363d73" + ADDR)).toBeNull();
  });

  it("returns null for the zero address target", () => {
    const zero = `0x363d3d373d3d3d363d73${"0".repeat(40)}5af43d82803e903d91602b57fd5bf3`;
    expect(parseMinimalProxyTarget(zero)).toBeNull();
  });

  it("returns null for empty / 0x / undefined", () => {
    expect(parseMinimalProxyTarget("0x")).toBeNull();
    expect(parseMinimalProxyTarget("")).toBeNull();
    expect(parseMinimalProxyTarget(null)).toBeNull();
    expect(parseMinimalProxyTarget(undefined)).toBeNull();
  });

  it("returns null when the suffix is wrong (not a minimal proxy)", () => {
    const badSuffix = `0x363d3d373d3d3d363d73${ADDR}${"a".repeat(30)}`;
    expect(parseMinimalProxyTarget(badSuffix)).toBeNull();
  });
});
