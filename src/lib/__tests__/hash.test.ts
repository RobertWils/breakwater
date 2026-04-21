import { describe, it, expect } from "vitest";
import { hashIp, hashEmail, hashPayload } from "@/lib/hash";

const TEST_IP_SALT = "test-ip-salt";
const TEST_EMAIL_SALT = "test-email-salt";

describe("hashIp", () => {
  it("returns a deterministic hex string for the same IP", () => {
    expect(hashIp("192.168.1.1", TEST_IP_SALT)).toBe(
      hashIp("192.168.1.1", TEST_IP_SALT),
    );
  });

  it("returns a 64-char hex string (SHA256)", () => {
    expect(hashIp("10.0.0.1", TEST_IP_SALT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different IPs produce different hashes", () => {
    expect(hashIp("1.2.3.4", TEST_IP_SALT)).not.toBe(
      hashIp("1.2.3.5", TEST_IP_SALT),
    );
  });

  it("throws when salt is empty string", () => {
    expect(() => hashIp("1.2.3.4", "")).toThrow(
      "SCAN_IP_SALT is required for ipHash computation",
    );
  });

  it("different salt produces different hash for the same IP", () => {
    expect(hashIp("1.2.3.4", "salt-a")).not.toBe(hashIp("1.2.3.4", "salt-b"));
  });

  it("same salt + same IP is always deterministic", () => {
    const a = hashIp("10.0.0.1", "stable-salt");
    const b = hashIp("10.0.0.1", "stable-salt");
    expect(a).toBe(b);
  });
});

describe("hashEmail", () => {
  it("is case-insensitive", () => {
    expect(hashEmail("Foo@BAR.com", TEST_EMAIL_SALT)).toBe(
      hashEmail("foo@bar.com", TEST_EMAIL_SALT),
    );
  });

  it("is whitespace-insensitive (leading/trailing)", () => {
    expect(hashEmail(" foo@bar.com ", TEST_EMAIL_SALT)).toBe(
      hashEmail("foo@bar.com", TEST_EMAIL_SALT),
    );
  });

  it("mixed case + whitespace equals normalized form", () => {
    expect(hashEmail("  Foo@BAR.com  ", TEST_EMAIL_SALT)).toBe(
      hashEmail("foo@bar.com", TEST_EMAIL_SALT),
    );
  });

  it("returns a 64-char hex string", () => {
    expect(hashEmail("user@example.com", TEST_EMAIL_SALT)).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("different emails produce different hashes", () => {
    expect(hashEmail("alice@example.com", TEST_EMAIL_SALT)).not.toBe(
      hashEmail("bob@example.com", TEST_EMAIL_SALT),
    );
  });

  it("throws when salt is empty string", () => {
    expect(() => hashEmail("user@example.com", "")).toThrow(
      "SCAN_EMAIL_SALT is required for emailHash computation",
    );
  });

  it("different salt produces different hash for the same email", () => {
    expect(hashEmail("user@example.com", "salt-a")).not.toBe(
      hashEmail("user@example.com", "salt-b"),
    );
  });

  it("same salt + same email is always deterministic", () => {
    const a = hashEmail("user@example.com", "stable-salt");
    const b = hashEmail("user@example.com", "stable-salt");
    expect(a).toBe(b);
  });
});

const BASE_INPUT = {
  chain: "ETHEREUM" as const,
  normalizedAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
  extraContractAddresses: ["0xaaa0000000000000000000000000000000000001"],
  domain: "app.uniswap.org",
  multisigs: ["0xbbb0000000000000000000000000000000000001"],
  modulesEnabled: ["GOVERNANCE", "ORACLE"],
};

describe("hashPayload", () => {
  it("returns a 64-char hex string", () => {
    expect(hashPayload(BASE_INPUT)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashPayload(BASE_INPUT)).toBe(hashPayload({ ...BASE_INPUT }));
  });

  it("extraContractAddresses order-insensitive", () => {
    const a = hashPayload({
      ...BASE_INPUT,
      extraContractAddresses: ["0xaaa0000000000000000000000000000000000001", "0xbbb0000000000000000000000000000000000002"],
    });
    const b = hashPayload({
      ...BASE_INPUT,
      extraContractAddresses: ["0xbbb0000000000000000000000000000000000002", "0xaaa0000000000000000000000000000000000001"],
    });
    expect(a).toBe(b);
  });

  it("multisigs order-insensitive", () => {
    const a = hashPayload({
      ...BASE_INPUT,
      multisigs: ["0xccc0000000000000000000000000000000000003", "0xddd0000000000000000000000000000000000004"],
    });
    const b = hashPayload({
      ...BASE_INPUT,
      multisigs: ["0xddd0000000000000000000000000000000000004", "0xccc0000000000000000000000000000000000003"],
    });
    expect(a).toBe(b);
  });

  it("modulesEnabled order-insensitive", () => {
    const a = hashPayload({ ...BASE_INPUT, modulesEnabled: ["GOVERNANCE", "ORACLE", "SIGNER"] });
    const b = hashPayload({ ...BASE_INPUT, modulesEnabled: ["SIGNER", "GOVERNANCE", "ORACLE"] });
    expect(a).toBe(b);
  });

  it("domain undefined and omitted yield the same hash", () => {
    const withUndefined = hashPayload({ ...BASE_INPUT, domain: undefined });
    const { domain: _domain, ...withoutDomain } = BASE_INPUT;
    void _domain; // intentionally omitted to test undefined ≡ absent
    const withOmitted = hashPayload(withoutDomain);
    expect(withUndefined).toBe(withOmitted);
  });

  it("present domain differs from absent domain", () => {
    const withDomain = hashPayload({ ...BASE_INPUT, domain: "app.uniswap.org" });
    const withoutDomain = hashPayload({ ...BASE_INPUT, domain: undefined });
    expect(withDomain).not.toBe(withoutDomain);
  });

  it("different domain values produce different hashes", () => {
    const a = hashPayload({ ...BASE_INPUT, domain: "app.uniswap.org" });
    const b = hashPayload({ ...BASE_INPUT, domain: "app.aave.com" });
    expect(a).not.toBe(b);
  });

  it("different chain produces different hash", () => {
    const eth = hashPayload({
      chain: "ETHEREUM",
      normalizedAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
      extraContractAddresses: [],
      multisigs: [],
      modulesEnabled: ["GOVERNANCE"],
    });
    const sol = hashPayload({
      chain: "SOLANA",
      normalizedAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
      extraContractAddresses: [],
      multisigs: [],
      modulesEnabled: ["GOVERNANCE"],
    });
    expect(eth).not.toBe(sol);
  });

  it("different normalizedAddress produces different hash", () => {
    const a = hashPayload({ ...BASE_INPUT, normalizedAddress: "0xaaaa000000000000000000000000000000000001" });
    const b = hashPayload({ ...BASE_INPUT, normalizedAddress: "0xbbbb000000000000000000000000000000000002" });
    expect(a).not.toBe(b);
  });
});
