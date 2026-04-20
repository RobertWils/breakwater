/**
 * Cooldown key formatter.
 * The key is protocol-scoped and independent of Protocol.id,
 * so it can be computed before a Protocol row exists.
 */

type Chain = "ETHEREUM" | "SOLANA";

/**
 * Returns the cooldown key for a given chain + normalized address.
 * Format: `${chain}:${normalizedAddress}`
 */
export function cooldownKey(chain: Chain, normalizedAddress: string): string {
  return `${chain}:${normalizedAddress}`;
}
