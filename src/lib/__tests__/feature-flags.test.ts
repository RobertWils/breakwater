// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isFeatureEnabled,
  isGovernanceModuleEnabled,
} from "../feature-flags";

const FLAG = "BREAKWATER_GOVERNANCE_MODULE_ENABLED" as const;

describe("isFeatureEnabled", () => {
  beforeEach(() => {
    delete process.env[FLAG];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env[FLAG];
  });

  it("returns default true when env var unset", () => {
    expect(isFeatureEnabled(FLAG)).toBe(true);
  });

  it("returns false when env var is 'false'", () => {
    vi.stubEnv(FLAG, "false");
    expect(isFeatureEnabled(FLAG)).toBe(false);
  });

  it("returns false when env var is 'FALSE' (case insensitive)", () => {
    vi.stubEnv(FLAG, "FALSE");
    expect(isFeatureEnabled(FLAG)).toBe(false);
  });

  it("returns true when env var is 'true'", () => {
    vi.stubEnv(FLAG, "true");
    expect(isFeatureEnabled(FLAG)).toBe(true);
  });

  it("returns true for non-false values like '1', 'yes', or ''", () => {
    vi.stubEnv(FLAG, "1");
    expect(isFeatureEnabled(FLAG)).toBe(true);

    vi.stubEnv(FLAG, "yes");
    expect(isFeatureEnabled(FLAG)).toBe(true);

    vi.stubEnv(FLAG, "");
    expect(isFeatureEnabled(FLAG)).toBe(true);
  });
});

describe("isGovernanceModuleEnabled", () => {
  beforeEach(() => {
    delete process.env[FLAG];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env[FLAG];
  });

  it("returns true by default", () => {
    expect(isGovernanceModuleEnabled()).toBe(true);
  });

  it("returns false when env var explicitly disabled", () => {
    vi.stubEnv(FLAG, "false");
    expect(isGovernanceModuleEnabled()).toBe(false);
  });
});
