/**
 * Hashing helpers using Node's built-in crypto module.
 * No external dependencies.
 */

import { createHash } from "node:crypto";

type Chain = "ETHEREUM" | "SOLANA";

function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * SHA256 hex of the raw IP string.
 */
export function hashIp(ip: string): string {
  return sha256hex(ip);
}

/**
 * Normalize (trim + lowercase) then SHA256 hex.
 * This makes the hash case-insensitive and whitespace-insensitive.
 */
export function hashEmail(email: string): string {
  return sha256hex(email.trim().toLowerCase());
}

interface PayloadHashInput {
  chain: Chain;
  normalizedAddress: string;
  extraContractAddresses: string[];
  domain?: string;
  multisigs: string[];
  modulesEnabled: string[];
}

/**
 * Deterministic payload hash.
 *
 * Arrays are sorted alphabetically before serialization.
 * `domain` is included as `null` when undefined so that "no domain" is
 * stable and distinct from any actual domain value.
 * Key order is fixed: chain, normalizedAddress, extraContractAddresses,
 * domain, multisigs, modulesEnabled.
 */
export function hashPayload(input: PayloadHashInput): string {
  const canonical = {
    chain: input.chain,
    normalizedAddress: input.normalizedAddress,
    extraContractAddresses: [...input.extraContractAddresses].sort(),
    domain: input.domain !== undefined ? input.domain : null,
    multisigs: [...input.multisigs].sort(),
    modulesEnabled: [...input.modulesEnabled].sort(),
  };
  return sha256hex(JSON.stringify(canonical));
}
