/**
 * Plan 05 Fase 1.5 — the discovery role ladder (§4), pure.
 *
 * Assigns each discovered contract a `ContractRole` via a TOP-DOWN ladder,
 * FIRST MATCH WINS. The order is load-bearing: a node that satisfies an earlier
 * rung must never be reclassified by a later one (e.g. an implementation behind
 * an admin proxy that also looks ERC-20-ish stays PROXY_IMPLEMENTATION).
 *
 *   1. impl / beacon / UUPS / OZ-legacy / Compound / minimal-proxy source
 *        → PROXY_IMPLEMENTATION
 *   2. admin-slot OR owner()/role-getter, AND a confirmed Safe
 *        → DECLARED_MULTISIG
 *   3. timelock selectors (OZ getMinDelay/PROPOSER_ROLE, Compound delay)
 *        → TIMELOCK
 *   4. ERC-20 probe (totalSupply/balanceOf/decimals)
 *        → TOKEN_CONTRACT
 *   5. bridge registry
 *        → DECLARED_BRIDGE
 *   6. otherwise
 *        → RELATED, with `discoveredAs` derived from the getter name
 *
 * roleSource is AUTO + user-overridable (set by the attach step, not here).
 * This module is IO-free: the caller gathers the signals (slot source, Safe
 * check, selector/ERC-20 probes) and passes them in.
 */

import type { ContractRole } from "@prisma/client";

export type DiscoverySignalSource =
  | "IMPL_SLOT" // EIP-1967 implementation slot
  | "BEACON_IMPL" // EIP-1967 beacon → implementation()
  | "UUPS_SLOT" // EIP-1822 legacy
  | "OZ_LEGACY_SLOT" // pre-1967 OZ slot
  | "COMPOUND_IMPL" // Unitroller comptrollerImplementation()
  | "MINIMAL_PROXY" // EIP-1167 bytecode
  | "ADMIN_SLOT" // EIP-1967 admin slot
  | "GETTER"; // a zero-arg view getter returned this address

export interface RoleSignals {
  /** How the address was discovered. */
  source: DiscoverySignalSource;
  /** The getter name, when source === "GETTER" (e.g. "owner", "oracle"). */
  getterName?: string;
  /** Safe Transaction Service confirmed this address is a Safe. */
  isConfirmedSafe?: boolean;
  /** OZ getMinDelay()/PROPOSER_ROLE() or Compound delay() responded. */
  hasTimelockSelectors?: boolean;
  /** totalSupply()/balanceOf()/decimals() responded (ERC-20). */
  isErc20?: boolean;
  /** Matched a known bridge registry. */
  isBridgeRegistry?: boolean;
}

export interface RoleAssignment {
  role: ContractRole;
  /** Provenance metadata persisted on Contract.discoveredAs. */
  discoveredAs: string;
}

const IMPLEMENTATION_SOURCES: ReadonlySet<DiscoverySignalSource> =
  new Set<DiscoverySignalSource>([
    "IMPL_SLOT",
    "BEACON_IMPL",
    "UUPS_SLOT",
    "OZ_LEGACY_SLOT",
    "COMPOUND_IMPL",
    "MINIMAL_PROXY",
  ]);

/** Getter names that name a governance owner/role holder (rung 2 candidates). */
const OWNER_ROLE_GETTERS: ReadonlySet<string> = new Set([
  "owner",
  "admin",
  "getOwners",
  "getRoleMember",
]);

export function assignDiscoveredRole(signals: RoleSignals): RoleAssignment {
  // Rung 1 — implementation behind a proxy/beacon/minimal-proxy.
  if (IMPLEMENTATION_SOURCES.has(signals.source)) {
    return { role: "PROXY_IMPLEMENTATION", discoveredAs: signals.source };
  }

  // Rung 2 — governance owner/admin that is a confirmed Safe.
  const fromOwnerOrAdmin =
    signals.source === "ADMIN_SLOT" ||
    (signals.source === "GETTER" &&
      !!signals.getterName &&
      OWNER_ROLE_GETTERS.has(signals.getterName));
  if (fromOwnerOrAdmin && signals.isConfirmedSafe) {
    return { role: "DECLARED_MULTISIG", discoveredAs: "confirmed_safe" };
  }

  // Rung 3 — timelock.
  if (signals.hasTimelockSelectors) {
    return { role: "TIMELOCK", discoveredAs: "timelock_selectors" };
  }

  // Rung 4 — ERC-20 token.
  if (signals.isErc20) {
    return { role: "TOKEN_CONTRACT", discoveredAs: "erc20_probe" };
  }

  // Rung 5 — bridge registry.
  if (signals.isBridgeRegistry) {
    return { role: "DECLARED_BRIDGE", discoveredAs: "bridge_registry" };
  }

  // Rung 6 — RELATED, classified from the getter name where possible.
  return { role: "RELATED", discoveredAs: relatedDiscoveredAs(signals.getterName) };
}

function relatedDiscoveredAs(getterName?: string): string {
  if (!getterName) return "RELATED";
  const n = getterName.toLowerCase();
  if (n.includes("oracle") || n.includes("aggregator") || n.includes("latestround")) {
    return "ORACLE";
  }
  if (n.includes("pool")) return "DEX_POOL";
  if (n.includes("asset")) return "ASSET";
  return getterName;
}
