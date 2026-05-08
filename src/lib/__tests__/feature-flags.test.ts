// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __reparseDetectorDisableList,
  isDetectorDisabled,
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

describe("isDetectorDisabled (Plan 02 E.0)", () => {
  beforeEach(() => {
    delete process.env.BREAKWATER_DETECTOR_DISABLE;
    __reparseDetectorDisableList();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.BREAKWATER_DETECTOR_DISABLE;
    __reparseDetectorDisableList();
  });

  it("returns false for any detector when BREAKWATER_DETECTOR_DISABLE is unset", () => {
    expect(isDetectorDisabled("GOV-001")).toBe(false);
    expect(isDetectorDisabled("GOV-002")).toBe(false);
    expect(isDetectorDisabled("GOV-006")).toBe(false);
  });

  it("returns true for a single-id disable list", () => {
    vi.stubEnv("BREAKWATER_DETECTOR_DISABLE", "GOV-003");
    __reparseDetectorDisableList();

    expect(isDetectorDisabled("GOV-003")).toBe(true);
    expect(isDetectorDisabled("GOV-001")).toBe(false);
  });

  it("supports multiple disabled detectors via CSV", () => {
    vi.stubEnv("BREAKWATER_DETECTOR_DISABLE", "GOV-001,GOV-003,GOV-005");
    __reparseDetectorDisableList();

    expect(isDetectorDisabled("GOV-001")).toBe(true);
    expect(isDetectorDisabled("GOV-003")).toBe(true);
    expect(isDetectorDisabled("GOV-005")).toBe(true);
    expect(isDetectorDisabled("GOV-002")).toBe(false);
    expect(isDetectorDisabled("GOV-004")).toBe(false);
    expect(isDetectorDisabled("GOV-006")).toBe(false);
  });

  it("trims whitespace around CSV entries", () => {
    vi.stubEnv("BREAKWATER_DETECTOR_DISABLE", " GOV-001 , GOV-003 ");
    __reparseDetectorDisableList();

    expect(isDetectorDisabled("GOV-001")).toBe(true);
    expect(isDetectorDisabled("GOV-003")).toBe(true);
    // Make sure the trimmed values are exactly what's in the set
    // (not " GOV-001 " with leading/trailing spaces).
    expect(isDetectorDisabled(" GOV-001 ")).toBe(false);
  });

  it("filters empty entries (trailing comma, doubled commas, blank values)", () => {
    vi.stubEnv("BREAKWATER_DETECTOR_DISABLE", "GOV-001,,GOV-003,");
    __reparseDetectorDisableList();

    expect(isDetectorDisabled("GOV-001")).toBe(true);
    expect(isDetectorDisabled("GOV-003")).toBe(true);
    // Empty string never matches.
    expect(isDetectorDisabled("")).toBe(false);
  });

  it("is case-sensitive (GOV-001 ≠ gov-001)", () => {
    vi.stubEnv("BREAKWATER_DETECTOR_DISABLE", "GOV-001");
    __reparseDetectorDisableList();

    expect(isDetectorDisabled("GOV-001")).toBe(true);
    expect(isDetectorDisabled("gov-001")).toBe(false);
  });
});
