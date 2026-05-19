/**
 * Production environment assertions.
 * Called once at module load of route handlers that depend on hash salts.
 */

export function assertProductionHashSalts(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (!process.env.SCAN_IP_SALT) {
    throw new Error(
      "[config] SCAN_IP_SALT required in production. " +
        "Without salt, IP hashing is vulnerable to rainbow table attacks.",
    );
  }
  if (!process.env.SCAN_EMAIL_SALT) {
    throw new Error("[config] SCAN_EMAIL_SALT required in production.");
  }
}

const REQUIRED_INNGEST_VARS = [
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "INNGEST_APP_ID",
] as const;

const OPTIONAL_VARS = ["ETHERSCAN_API_KEY"] as const;

export function assertProductionInngestConfig(): void {
  if (process.env.NODE_ENV !== "production") return;

  const missing: string[] = [];

  for (const key of REQUIRED_INNGEST_VARS) {
    if (!process.env[key]) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[config] Required production env vars missing: ${missing.join(", ")}. ` +
        `These are required for Inngest dispatcher functionality (Plan 02).`,
    );
  }

  for (const key of OPTIONAL_VARS) {
    if (!process.env[key]) {
      console.warn(
        `[config] Optional env var ${key} not set. ` +
          `GOV-002 detector will degrade gracefully without Etherscan API access.`,
      );
    }
  }
}

/**
 * Plan 02 D.2 — external API config (Safe Transaction Service primarily).
 *
 * - SAFE_API_BASE_URL has a baked-in default; production gets a hard
 *   error only if the var is set to an explicit empty string (signals
 *   a misconfigured env file rather than an unset value).
 * - SAFE_API_KEY is optional. Anonymous tier is 2 RPS / 5K monthly —
 *   fine for early dev; production should provision a key but we
 *   warn-not-throw to keep the deploy path unblocked.
 */
const REQUIRED_EXTERNAL_API_VARS_WITH_DEFAULTS = [
  {
    key: "SAFE_API_BASE_URL",
    defaultValue: "https://api.safe.global/tx-service/eth",
  },
] as const;

const OPTIONAL_EXTERNAL_API_VARS = ["SAFE_API_KEY"] as const;

export function assertProductionExternalApis(): void {
  if (process.env.NODE_ENV !== "production") return;

  for (const { key, defaultValue } of REQUIRED_EXTERNAL_API_VARS_WITH_DEFAULTS) {
    if (process.env[key] === "") {
      throw new Error(
        `[config] ${key} is set to empty string in production. ` +
          `Either unset (uses default ${defaultValue}) or provide a valid URL.`,
      );
    }
  }

  for (const key of OPTIONAL_EXTERNAL_API_VARS) {
    if (!process.env[key]) {
      console.warn(
        `[config] Optional external API key ${key} not set. ` +
          `Safe API will use anonymous tier (2 RPS, 5K/month limit).`,
      );
    }
  }
}
