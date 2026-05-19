// @vitest-environment node
/**
 * Unit-level tests covering the module-registry + skip-reason logic.
 *
 *   - H.6 future-proofing: every ModuleName enum value is either
 *     implemented or explicitly placeholder.
 *   - H.9 N2: skip-reason priority order via the exported
 *     `computeSkipReason` pure function.
 *   - H.9 BLOCKER Layer A: schema-level rejection of empty
 *     `modulesEnabled`.
 */

import { describe, expect, it } from "vitest";
import { ModuleName } from "@prisma/client";

import {
  IMPLEMENTED_MODULES,
  computeSkipReason,
} from "@/lib/scan-submission";
import { ScanSubmissionSchema } from "@/lib/schemas/scan";

/**
 * Modules that are intentionally NOT yet implemented in this build.
 * Each entry costs one merge — adding here means "we acknowledge this
 * exists in the schema but ships SKIPPED via `module_not_implemented`."
 */
const PLACEHOLDER_MODULES = new Set<string>(["ORACLE", "SIGNER", "FRONTEND"]);

describe("ModuleName completeness (H.6 — IMPLEMENTED_MODULES guard)", () => {
  it("every ModuleName enum value is either implemented or explicitly placeholder", () => {
    const allModules = Object.values(ModuleName);

    for (const name of allModules) {
      const isImplemented = IMPLEMENTED_MODULES.has(name);
      const isPlaceholder = PLACEHOLDER_MODULES.has(name);
      expect(
        isImplemented || isPlaceholder,
        `ModuleName.${name} is in the Prisma enum but neither IMPLEMENTED_MODULES nor PLACEHOLDER_MODULES claims it. Add an Inngest handler + register in IMPLEMENTED_MODULES, or acknowledge as a Plan 03+ placeholder.`,
      ).toBe(true);
    }
  });

  it("IMPLEMENTED_MODULES and PLACEHOLDER_MODULES are disjoint (no module can be both)", () => {
    // NOTES.md L62 backlog: tsconfig has no target set, so Set iteration
    // via `for...of` requires --downlevelIteration. Array.from() works on
    // the ES3 default without that flag.
    for (const name of Array.from(IMPLEMENTED_MODULES)) {
      expect(PLACEHOLDER_MODULES.has(name)).toBe(false);
    }
  });

  it("IMPLEMENTED_MODULES contains GOVERNANCE — Plan 02 baseline", () => {
    expect(IMPLEMENTED_MODULES.has("GOVERNANCE")).toBe(true);
  });
});

describe("computeSkipReason priority order (H.9 N2)", () => {
  it("returns null when every gate condition passes (will QUEUE)", () => {
    expect(
      computeSkipReason({
        enabled: true,
        implemented: true,
        requiresDomain: false,
        hasDomain: false,
      }),
    ).toBeNull();
  });

  it("module_disabled_by_user beats module_not_implemented", () => {
    // Both conditions are true; priority 1 wins. Locks in the audit
    // signal preference (explicit user intent > system limitation).
    expect(
      computeSkipReason({
        enabled: false,
        implemented: false,
        requiresDomain: false,
        hasDomain: false,
      }),
    ).toBe("module_disabled_by_user");
  });

  it("module_disabled_by_user beats domain_required", () => {
    expect(
      computeSkipReason({
        enabled: false,
        implemented: true,
        requiresDomain: true,
        hasDomain: false,
      }),
    ).toBe("module_disabled_by_user");
  });

  it("module_not_implemented beats domain_required", () => {
    // The reachability test that's hard to set up at the integration
    // layer (no second implemented module yet to disable for a clean
    // user-disable test, no implemented FRONTEND yet for the
    // domain-required test). Pure function lets us verify the
    // priority without the integration ceremony.
    expect(
      computeSkipReason({
        enabled: true,
        implemented: false,
        requiresDomain: true,
        hasDomain: false,
      }),
    ).toBe("module_not_implemented");
  });

  it("returns domain_required when only the domain gate fails", () => {
    // Only reachable today via an implemented FRONTEND-style module
    // missing its domain. Plan 02 doesn't have one, but the priority
    // path is locked in for when it lands.
    expect(
      computeSkipReason({
        enabled: true,
        implemented: true,
        requiresDomain: true,
        hasDomain: false,
      }),
    ).toBe("domain_required");
  });

  it("hasDomain=true bypasses domain_required even when requiresDomain", () => {
    expect(
      computeSkipReason({
        enabled: true,
        implemented: true,
        requiresDomain: true,
        hasDomain: true,
      }),
    ).toBeNull();
  });
});

describe("ScanSubmissionSchema modulesEnabled (H.9 BLOCKER Layer A)", () => {
  const BASE_VALID_INPUT = {
    chain: "ETHEREUM" as const,
    primaryContractAddress: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
  };

  it("rejects modulesEnabled: [] with a min(1) zod error", () => {
    const result = ScanSubmissionSchema.safeParse({
      ...BASE_VALID_INPUT,
      modulesEnabled: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => i.message)
        .join("\n");
      expect(message).toMatch(/at least one module/i);
    }
  });

  it("accepts modulesEnabled with a single entry (GOVERNANCE)", () => {
    const result = ScanSubmissionSchema.safeParse({
      ...BASE_VALID_INPUT,
      modulesEnabled: ["GOVERNANCE"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts modulesEnabled with multiple entries", () => {
    const result = ScanSubmissionSchema.safeParse({
      ...BASE_VALID_INPUT,
      modulesEnabled: ["GOVERNANCE", "ORACLE"],
    });
    expect(result.success).toBe(true);
  });

  it("falls back to the 4-module default when modulesEnabled is omitted", () => {
    const result = ScanSubmissionSchema.safeParse(BASE_VALID_INPUT);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.modulesEnabled).toEqual([
        "GOVERNANCE",
        "ORACLE",
        "SIGNER",
        "FRONTEND",
      ]);
    }
  });
});
