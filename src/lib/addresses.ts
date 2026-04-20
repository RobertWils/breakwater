/**
 * Address normalization and validation helpers.
 *
 * ETHEREUM: normalize to lowercase, validate 0x-prefixed 40-hex-char format.
 * SOLANA: preserve case, validate base58 32-44 chars.
 *
 * No viem dependency — regex-only validation.
 */

type Chain = "ETHEREUM" | "SOLANA";

// 0x followed by exactly 40 hex characters
const ETHEREUM_RE = /^0x[0-9a-fA-F]{40}$/;

// Base58 alphabet (no 0, O, I, l) — 32 to 44 characters
const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Normalize an address for the given chain.
 * - ETHEREUM: trims whitespace and lowercases; validates 0x + 40 hex chars.
 * - SOLANA: trims whitespace and preserves case; validates base58 32-44 chars.
 *
 * @throws {Error} if the address does not match the chain's format.
 */
export function normalizeAddress(chain: Chain, address: string): string {
  const trimmed = address.trim();

  if (chain === "ETHEREUM") {
    const lower = trimmed.toLowerCase();
    if (!ETHEREUM_RE.test(lower)) {
      throw new Error(
        `[addresses] Invalid Ethereum address: "${address}". Expected 0x-prefixed 40-hex-char address.`,
      );
    }
    return lower;
  }

  // SOLANA
  if (!SOLANA_BASE58_RE.test(trimmed)) {
    throw new Error(
      `[addresses] Invalid Solana address: "${address}". Expected base58-encoded string of 32–44 characters.`,
    );
  }
  return trimmed;
}

/**
 * Non-throwing boolean check using the same validation rules as normalizeAddress.
 */
export function isValidAddress(chain: Chain, address: string): boolean {
  try {
    normalizeAddress(chain, address);
    return true;
  } catch {
    return false;
  }
}
