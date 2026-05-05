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
