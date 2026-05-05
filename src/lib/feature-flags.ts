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
