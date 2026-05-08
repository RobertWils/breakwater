type FlagName = "BREAKWATER_GOVERNANCE_MODULE_ENABLED";

const FLAG_DEFAULTS: Record<FlagName, boolean> = {
  BREAKWATER_GOVERNANCE_MODULE_ENABLED: true,
};

export function isFeatureEnabled(flag: FlagName): boolean {
  const envValue = process.env[flag];

  if (envValue === undefined) {
    return FLAG_DEFAULTS[flag];
  }

  return envValue.toLowerCase() !== "false";
}

export function isGovernanceModuleEnabled(): boolean {
  return isFeatureEnabled("BREAKWATER_GOVERNANCE_MODULE_ENABLED");
}

/**
 * Per-detector disable flag (Plan 02 E.0).
 *
 * Format: BREAKWATER_DETECTOR_DISABLE=GOV-001,GOV-003
 *   - Comma-separated detector IDs.
 *   - Whitespace around entries trimmed.
 *   - Empty entries (trailing/double commas, blanks) filtered.
 *   - Case-sensitive: `GOV-001` != `gov-001`.
 *
 * Parsed once at module load into a Set. Phase F's orchestrator
 * calls `isDetectorDisabled(id)` before invoking each detector so
 * we can ship a quick rollback without redeploying when a detector
 * starts false-positiving on real traffic (per implementation.md
 * Phase E rollback strategy).
 */
const DISABLED_DETECTORS = new Set<string>();

function parseDisableList(): void {
  DISABLED_DETECTORS.clear();
  const raw = process.env.BREAKWATER_DETECTOR_DISABLE ?? "";
  for (const id of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    DISABLED_DETECTORS.add(id);
  }
}

// Initialise from process.env at module load.
parseDisableList();

export function isDetectorDisabled(detectorId: string): boolean {
  return DISABLED_DETECTORS.has(detectorId);
}

/**
 * Test-only escape hatch: re-parse the disable list from the current
 * `process.env`. Production code relies on the module-load
 * initialisation and never calls this.
 *
 * Underscore prefix marks the function as internal — kept exported so
 * tests in `__tests__/feature-flags.test.ts` can call it without
 * `vi.resetModules` + dynamic re-import gymnastics. Existing tests
 * for `isFeatureEnabled` already use `vi.stubEnv`; this helper makes
 * the equivalent ergonomics work for the Set-backed disable list.
 */
export function __reparseDetectorDisableList(): void {
  parseDisableList();
}
