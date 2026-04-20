/**
 * Strategy B: isDevMode and assertProductionConfig re-read process.env at call
 * time (not capturing the module-level `resend` const), so they are testable
 * with plain process.env assignment without needing vi.resetModules().
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isDevMode, assertProductionConfig } from "@/lib/resend";

type EnvSnapshot = {
  RESEND_API_KEY: string | undefined;
  NODE_ENV: string | undefined;
  FORCE_RESEND_IN_DEV: string | undefined;
};

let snapshot: EnvSnapshot;

beforeEach(() => {
  snapshot = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    NODE_ENV: process.env.NODE_ENV,
    FORCE_RESEND_IN_DEV: process.env.FORCE_RESEND_IN_DEV,
  };
});

afterEach(() => {
  if (snapshot.RESEND_API_KEY === undefined) {
    delete process.env.RESEND_API_KEY;
  } else {
    process.env.RESEND_API_KEY = snapshot.RESEND_API_KEY;
  }
  if (snapshot.NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = snapshot.NODE_ENV;
  }
  if (snapshot.FORCE_RESEND_IN_DEV === undefined) {
    delete process.env.FORCE_RESEND_IN_DEV;
  } else {
    process.env.FORCE_RESEND_IN_DEV = snapshot.FORCE_RESEND_IN_DEV;
  }
});

describe("isDevMode()", () => {
  it("returns true when RESEND_API_KEY is unset", () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    expect(isDevMode()).toBe(true);
  });

  it("returns true when NODE_ENV=development and FORCE_RESEND_IN_DEV is not '1' (key set)", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NODE_ENV = "development";
    delete process.env.FORCE_RESEND_IN_DEV;
    expect(isDevMode()).toBe(true);
  });

  it("returns false when NODE_ENV=development and FORCE_RESEND_IN_DEV='1' (key set)", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NODE_ENV = "development";
    process.env.FORCE_RESEND_IN_DEV = "1";
    expect(isDevMode()).toBe(false);
  });

  it("returns false when NODE_ENV=production with key set", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NODE_ENV = "production";
    delete process.env.FORCE_RESEND_IN_DEV;
    expect(isDevMode()).toBe(false);
  });
});

describe("assertProductionConfig()", () => {
  it("throws when NODE_ENV=production without key", () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "production";
    expect(() => assertProductionConfig()).toThrow(
      "[auth] RESEND_API_KEY is required in production. Magic link delivery cannot proceed.",
    );
  });

  it("does not throw when NODE_ENV=production with key", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.NODE_ENV = "production";
    expect(() => assertProductionConfig()).not.toThrow();
  });

  it("does not throw when NODE_ENV=development without key", () => {
    delete process.env.RESEND_API_KEY;
    process.env.NODE_ENV = "development";
    expect(() => assertProductionConfig()).not.toThrow();
  });
});
