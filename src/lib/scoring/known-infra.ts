/**
 * Plan 05 — KNOWN_INFRA allowlist hook (Fase 1.2).
 *
 * A KNOWN_INFRA node is shared infrastructure (e.g. Permit2, a canonical
 * multicall) whose own risk should NOT drag a dependent protocol's grade
 * down. Such a node is excluded from the WORST-fold in BOTH scorers (its
 * own grade/score does not count); it still exists in the graph so
 * contagion can flow THROUGH it.
 *
 * The exclusion is wired through this single predicate so the rollup
 * (`rollupProtocolComposite`) and the radar graph-builder (`buildStarGraph`)
 * exclude EXACTLY the same nodes — there is one definition of "infra".
 *
 * The allowlist itself is intentionally EMPTY in Fase 1.2: the seeded
 * allowlist (the DiscoveredContractCache allowlist status) is Fase 2. With
 * an empty set this predicate is always false, so the hook is a no-op today
 * and the reconciled scorer stays bit-identical to the pre-reconciliation
 * one. Only the EXCLUSION LOGIC has to be present + identical now; the set
 * fills later.
 */

// Addresses are compared lowercased (EVM). Empty until Fase 2.
const KNOWN_INFRA_ADDRESSES: ReadonlySet<string> = new Set<string>([]);

export function isKnownInfra(address: string | null | undefined): boolean {
  if (!address) return false;
  return KNOWN_INFRA_ADDRESSES.has(address.toLowerCase());
}
