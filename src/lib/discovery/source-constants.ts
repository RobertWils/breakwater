/**
 * Plan 05 Fase 1.5b — constants for the live discovery sources.
 *
 * Slot values are EIP-1967-style `bytes32(uint256(keccak256(label)) - 1)` (or
 * the raw keccak for EIP-1822 / the OZ legacy zos slot). They are verified by
 * `source-constants.test.ts`, which re-derives each from its preimage — the
 * EIP-1967 impl/admin derivations there match detect-proxy.ts's known-good
 * constants, confirming the method.
 *
 * The getter/probe sets are read via keyless static `eth_call` (§5.3 RPC-first);
 * Etherscan is reused only via detectProxy's existing ABI fetch, never duplicated.
 */

// ── Proxy/implementation slots (new ones; impl+admin live in detect-proxy.ts) ──
/** EIP-1967 beacon slot. The beacon's implementation() is the second hop. */
export const EIP1967_BEACON_SLOT =
  "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50" as const;
/** EIP-1822 (UUPS legacy) — keccak256("PROXIABLE"), no -1. */
export const EIP1822_PROXIABLE_SLOT =
  "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7" as const;
/** Pre-1967 OpenZeppelin/zos slot — keccak256("org.zeppelinos.proxy.implementation"). */
export const OZ_LEGACY_IMPL_SLOT =
  "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3" as const;

// ── Curated zero-arg, address-returning getters (§1.2). getOwners() returns
//    address[] and is handled separately. (getRoleMember/latestRoundData are NOT
//    zero-arg / NOT address-returning and are out of scope for Fase 1.) ──
export const ADDRESS_GETTERS = [
  "asset", // ERC-4626
  "aggregator", // Chainlink
  "oracle",
  "pool",
  "owner", // Ownable
  "timelock",
] as const;
/** Returns address[] — Safe owners. */
export const ADDRESS_ARRAY_GETTERS = ["getOwners"] as const;

// ── Role-signal probes (§4). Presence of any selector → the signal is true. ──
/** ERC-20: both must respond. */
export const ERC20_PROBE_FNS = ["totalSupply", "decimals"] as const;
/** Timelock: OZ getMinDelay() / Compound delay(). Any responds → timelock. */
export const TIMELOCK_PROBE_FNS = ["getMinDelay", "delay"] as const;
/** Compound Unitroller implementation getter. */
export const COMPOUND_IMPL_FN = "comptrollerImplementation" as const;
/** Beacon implementation getter (second hop). */
export const BEACON_IMPL_FN = "implementation" as const;

/**
 * Curated known-bridge registry, keyed by lowercased address. EMPTY in Fase 1
 * (seeded later, like the KNOWN_INFRA allowlist) — so isBridgeRegistry is false
 * for now, but the role-ladder rung + the probe are wired.
 */
export const KNOWN_BRIDGE_ADDRESSES: ReadonlySet<string> = new Set<string>([]);
