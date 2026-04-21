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
