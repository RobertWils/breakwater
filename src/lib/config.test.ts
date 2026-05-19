import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertProductionExternalApis,
  assertProductionHashSalts,
  assertProductionInngestConfig,
} from "./config";

describe("assertProductionHashSalts", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when SCAN_IP_SALT missing in production", () => {
    vi.stubEnv("SCAN_EMAIL_SALT", "email-salt");
    expect(() => assertProductionHashSalts()).toThrow(/SCAN_IP_SALT/);
  });

  it("throws when SCAN_EMAIL_SALT missing in production", () => {
    vi.stubEnv("SCAN_IP_SALT", "ip-salt");
    expect(() => assertProductionHashSalts()).toThrow(/SCAN_EMAIL_SALT/);
  });

  it("lists the first missing salt in error message when both missing", () => {
    expect(() => assertProductionHashSalts()).toThrow(/SCAN_IP_SALT/);
  });

  it("passes when both salts present in production", () => {
    vi.stubEnv("SCAN_IP_SALT", "ip-salt");
    vi.stubEnv("SCAN_EMAIL_SALT", "email-salt");
    expect(() => assertProductionHashSalts()).not.toThrow();
  });

  it("does not assert in development mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertProductionHashSalts()).not.toThrow();
  });
});

describe("assertProductionInngestConfig", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when INNGEST_EVENT_KEY missing in production", () => {
    vi.stubEnv("INNGEST_SIGNING_KEY", "sk-test");
    vi.stubEnv("INNGEST_APP_ID", "breakwater");
    expect(() => assertProductionInngestConfig()).toThrow(/INNGEST_EVENT_KEY/);
  });

  it("throws when INNGEST_SIGNING_KEY missing in production", () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "evt-test");
    vi.stubEnv("INNGEST_APP_ID", "breakwater");
    expect(() => assertProductionInngestConfig()).toThrow(/INNGEST_SIGNING_KEY/);
  });

  it("throws when INNGEST_APP_ID missing in production", () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "evt-test");
    vi.stubEnv("INNGEST_SIGNING_KEY", "sk-test");
    expect(() => assertProductionInngestConfig()).toThrow(/INNGEST_APP_ID/);
  });

  it("lists multiple missing vars in error message", () => {
    expect(() => assertProductionInngestConfig()).toThrow(
      /INNGEST_EVENT_KEY.*INNGEST_SIGNING_KEY.*INNGEST_APP_ID/,
    );
  });

  it("passes when all required Inngest vars present", () => {
    vi.stubEnv("INNGEST_EVENT_KEY", "evt-test");
    vi.stubEnv("INNGEST_SIGNING_KEY", "sk-test");
    vi.stubEnv("INNGEST_APP_ID", "breakwater");
    vi.stubEnv("ETHERSCAN_API_KEY", "es-test");
    expect(() => assertProductionInngestConfig()).not.toThrow();
  });

  it("warns but does not throw when ETHERSCAN_API_KEY missing", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("INNGEST_EVENT_KEY", "evt-test");
    vi.stubEnv("INNGEST_SIGNING_KEY", "sk-test");
    vi.stubEnv("INNGEST_APP_ID", "breakwater");
    expect(() => assertProductionInngestConfig()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("ETHERSCAN_API_KEY"),
    );
    consoleSpy.mockRestore();
  });

  it("does not assert in development mode", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertProductionInngestConfig()).not.toThrow();
  });
});

describe("assertProductionExternalApis (Plan 02 D.2)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes when SAFE_API_BASE_URL is unset (uses default) and SAFE_API_KEY is also unset (warns)", () => {
    const consoleSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    expect(() => assertProductionExternalApis()).not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("SAFE_API_KEY"),
    );
    consoleSpy.mockRestore();
  });

  it("passes when SAFE_API_BASE_URL is set to a custom value", () => {
    vi.stubEnv("SAFE_API_BASE_URL", "https://custom.safe.example");
    expect(() => assertProductionExternalApis()).not.toThrow();
  });

  it("throws when SAFE_API_BASE_URL is explicitly empty string", () => {
    vi.stubEnv("SAFE_API_BASE_URL", "");
    expect(() => assertProductionExternalApis()).toThrow(
      /SAFE_API_BASE_URL.*empty string/,
    );
  });

  it("does not warn about SAFE_API_KEY when it is set", () => {
    const consoleSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.stubEnv("SAFE_API_KEY", "bearer-token-here");
    expect(() => assertProductionExternalApis()).not.toThrow();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does not assert in development mode (no throw, no warn)", () => {
    const consoleSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SAFE_API_BASE_URL", ""); // would throw in production
    expect(() => assertProductionExternalApis()).not.toThrow();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
