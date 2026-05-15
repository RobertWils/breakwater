// @vitest-environment node
/**
 * Future-proofing unit test (Plan 02 H.6).
 *
 * Asserts every `ModuleName` enum value is either in `IMPLEMENTED_MODULES`
 * OR explicitly listed below as a Plan 03+ placeholder. Adding a new
 * ModuleName to the schema without updating this set (or the placeholder
 * list) fails here loudly instead of silently re-introducing the Phase H
 * dispatcher hang — i.e., the bug that motivated H.6.
 */

import { describe, expect, it } from "vitest";
import { ModuleName } from "@prisma/client";

import { IMPLEMENTED_MODULES } from "@/lib/scan-submission";

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
