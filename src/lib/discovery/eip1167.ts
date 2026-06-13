/**
 * Plan 05 Fase 1.5 — EIP-1167 minimal-proxy detection (pure, from bytecode).
 *
 * The canonical EIP-1167 runtime is exactly 45 bytes:
 *   363d3d373d3d3d363d73 <20-byte delegate target> 5af43d82803e903d91602b57fd5bf3
 *      ^ 10-byte prefix                              ^ 15-byte suffix
 *
 * `parseMinimalProxyTarget` returns the hard-coded delegate (implementation)
 * address, or null if the code is not a canonical minimal proxy. Pure — the
 * caller fetches the runtime code via getCode and feeds it here; the resolved
 * target is then attached as a PROXY_IMPLEMENTATION sibling (rung 1 of the role
 * ladder). Only the canonical layout is matched; vanity/optimised 1167 variants
 * are out of scope for Fase 1.
 */

const PREFIX = "363d3d373d3d3d363d73";
const SUFFIX = "5af43d82803e903d91602b57fd5bf3";
const RUNTIME_HEX_LEN = 90; // 45 bytes = 90 hex chars (no 0x)
const ZERO_ADDR = "0".repeat(40);

export function parseMinimalProxyTarget(
  bytecode: string | null | undefined,
): string | null {
  if (!bytecode) return null;
  const hex = bytecode.replace(/^0x/i, "").toLowerCase();
  if (hex.length !== RUNTIME_HEX_LEN) return null;
  if (!hex.startsWith(PREFIX)) return null;
  if (!hex.endsWith(SUFFIX)) return null;

  const addr = hex.slice(PREFIX.length, PREFIX.length + 40);
  if (addr === ZERO_ADDR) return null;
  return `0x${addr}`;
}
