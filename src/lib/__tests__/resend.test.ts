/**
 * Strategy B: isDevMode and assertProductionConfig re-read process.env at call
 * time (not capturing the module-level `resend` const), so they are testable
 * with vi.stubEnv without needing vi.resetModules().
 *
 * vi.stubEnv is type-safe against readonly env var types (NODE_ENV) and
 * vi.unstubAllEnvs() restores originals automatically — no manual snapshot
 * + restore dance.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { isDevMode, assertProductionConfig } from "@/lib/resend";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isDevMode()", () => {
  it("returns true when RESEND_API_KEY is unset", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevMode()).toBe(true);
  });

  it("returns true when NODE_ENV=development and FORCE_RESEND_IN_DEV is not '1' (key set)", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FORCE_RESEND_IN_DEV", "");
    expect(isDevMode()).toBe(true);
  });

  it("returns false when NODE_ENV=development and FORCE_RESEND_IN_DEV='1' (key set)", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FORCE_RESEND_IN_DEV", "1");
    expect(isDevMode()).toBe(false);
  });

  it("returns false when NODE_ENV=production with key set", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FORCE_RESEND_IN_DEV", "");
    expect(isDevMode()).toBe(false);
  });
});

describe("assertProductionConfig()", () => {
  it("throws when NODE_ENV=production without key", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertProductionConfig()).toThrow(
      "[auth] RESEND_API_KEY is required in production. Magic link delivery cannot proceed.",
    );
  });

  it("does not throw when NODE_ENV=production with key", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("does not throw when NODE_ENV=development without key", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => assertProductionConfig()).not.toThrow();
  });
});
