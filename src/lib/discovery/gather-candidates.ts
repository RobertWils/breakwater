/**
 * Plan 05 Fase 1.5b — live discovery sources feeding the 5a core.
 *
 * `gatherCandidates(deps, contract)` is the TESTABLE orchestration: it pulls raw
 * discoveries from the injected sources, runs the §4 role ladder, and returns
 * role'd `DiscoveredCandidate`s + a `degraded` flag. Per-source isolation: a
 * failing implementation-source must not drag down the getter source, and a
 * failing per-address probe must not drag down the rest — each is try/caught and
 * marks `degraded` without throwing.
 *
 * `makeCandidateSourceDeps(blockNumber)` is the LIVE wiring (viem getStorageAt /
 * getCode / static eth_call, reusing detectProxy + detectSafe). It is NOT
 * runtime-validatable here (no chain/keys) — its real behaviour (do the slot
 * reads hit real proxies, do the getters find real deps, is the Safe check
 * right) is proven at the live run. `gatherCandidates`'s orchestration + the
 * degraded isolation ARE unit-tested via fakes.
 *
 * RPC-first (§5.3): slots, getters, and probes are keyless eth_call/getStorageAt/
 * getCode. Etherscan is reused ONLY through detectProxy's existing ABI fetch
 * (memoised per address here so it is not duplicated), never called directly.
 */

import { parseAbi } from "viem";

import { detectProxy, type ProxyDetectionResult } from "@/lib/detectors/governance/detect-proxy";
import { detectSafe } from "@/lib/detectors/governance/detect-safe";
import { publicClient } from "@/lib/rpc-client";

import type { DiscoveredCandidate } from "./attach-proxy-implementations";
import { parseMinimalProxyTarget } from "./eip1167";
import { assignDiscoveredRole, type DiscoverySignalSource } from "./role-ladder";
import {
  ADDRESS_ARRAY_GETTERS,
  ADDRESS_GETTERS,
  BEACON_IMPL_FN,
  COMPOUND_IMPL_FN,
  EIP1822_PROXIABLE_SLOT,
  EIP1967_BEACON_SLOT,
  ERC20_PROBE_FNS,
  KNOWN_BRIDGE_ADDRESSES,
  OZ_LEGACY_IMPL_SLOT,
  TIMELOCK_PROBE_FNS,
} from "./source-constants";

const ZERO = "0x0000000000000000000000000000000000000000";

/** A discovered address + how it was found (pre-classification). */
interface ImplementationDiscovery {
  address: string;
  source: DiscoverySignalSource; // an implementation-class source
}
interface OwnerOrGetterTarget {
  address: string;
  source: "ADMIN_SLOT" | "GETTER";
  getterName?: string;
}
interface RoleProbeSignals {
  isConfirmedSafe: boolean;
  hasTimelockSelectors: boolean;
  isErc20: boolean;
  isBridgeRegistry: boolean;
}

export interface CandidateSourceDeps {
  /** Implementation-class addresses (rung 1 — no probe needed). */
  resolveImplementations(address: string): Promise<ImplementationDiscovery[]>;
  /** Admin-slot + getter targets that need probing to classify (rungs 2-6). */
  resolveOwnerAndGetterTargets(address: string): Promise<OwnerOrGetterTarget[]>;
  /** Role-signal probes on a discovered address (Safe / ERC-20 / timelock / bridge). */
  probeRoleSignals(address: string): Promise<RoleProbeSignals>;
  /**
   * Whether the address has contract bytecode (eth_getCode, keyless). EOAs (and
   * undeployed addresses) have none — per spec §2 they are TERMINAL, never a
   * scan target, so they must not be attached or they FAIL governance and
   * pollute coverage.
   */
  hasBytecode(address: string): Promise<boolean>;
  log(line: string): void;
}

export interface GatherResult {
  candidates: DiscoveredCandidate[];
  /** A source failed and was skipped; the scan should be marked discoveryDegraded. */
  degraded: boolean;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Gather role'd candidates from one manual contract's sources (depth 1). The
 * caller (the orchestrator) dedups across contracts and attaches.
 */
export async function gatherCandidates(
  deps: CandidateSourceDeps,
  contract: { address: string },
): Promise<GatherResult> {
  const candidates: DiscoveredCandidate[] = [];
  let degraded = false;

  // Source A — implementation class (rung 1, no probe). Isolated.
  try {
    for (const { address, source } of await deps.resolveImplementations(contract.address)) {
      const { role, discoveredAs } = assignDiscoveredRole({ source });
      candidates.push({ address: address.toLowerCase(), role, discoveredAs });
    }
  } catch (err) {
    degraded = true;
    deps.log(`implementation-source failed for ${contract.address}: ${errMsg(err)}`);
  }

  // Source B — admin slot + getters (need probing). Isolated from A.
  let targets: OwnerOrGetterTarget[] = [];
  try {
    targets = await deps.resolveOwnerAndGetterTargets(contract.address);
  } catch (err) {
    degraded = true;
    deps.log(`owner/getter-source failed for ${contract.address}: ${errMsg(err)}`);
  }

  for (const { address, source, getterName } of targets) {
    // Each probe isolated: a failing probe skips ONE candidate, not the batch.
    try {
      const probes = await deps.probeRoleSignals(address);
      const { role, discoveredAs } = assignDiscoveredRole({ source, getterName, ...probes });
      candidates.push({ address: address.toLowerCase(), role, discoveredAs });
    } catch (err) {
      degraded = true;
      deps.log(`role probe failed for ${address}: ${errMsg(err)}`);
    }
  }

  // EOA-terminality filter (spec §2), BEFORE the attach path so an EOA never
  // gets a Contract row / ModuleRun to FAIL on. A discovered address with no
  // bytecode (EOA or undeployed — e.g. a getter's owner/admin) is TERMINAL: not
  // a scannable contract. It is dropped here (logged as terminal metadata), so
  // it cannot pollute coverage/grade as a "failed contract". Dropping an EOA is
  // expected, NOT degradation. A getCode RPC FAILURE is conservatively dropped
  // AND marks degraded (we couldn't verify it).
  const scannable: DiscoveredCandidate[] = [];
  for (const c of candidates) {
    try {
      if (await deps.hasBytecode(c.address)) {
        scannable.push(c);
      } else {
        deps.log(
          `discovered ${c.address} (${c.discoveredAs}) has no bytecode — EOA/undeployed, terminal; not attached`,
        );
      }
    } catch (err) {
      degraded = true;
      deps.log(`bytecode check failed for ${c.address}: ${errMsg(err)}`);
    }
  }

  return { candidates: scannable, degraded };
}

// ─── Live wiring (viem + detectProxy + detectSafe) — live-run validated ───────

/** 32-byte storage word → canonical 20-byte address, or null. */
function slotToAddress(slot: string | undefined | null): string | null {
  if (!slot || slot.length !== 66) return null;
  if (slot.slice(2, 26).toLowerCase() !== "000000000000000000000000") return null;
  const addr = "0x" + slot.slice(-40).toLowerCase();
  return addr === ZERO ? null : addr;
}

export function makeCandidateSourceDeps(blockNumber: bigint): CandidateSourceDeps {
  const hex = (a: string) => a as `0x${string}`;

  // Memoise detectProxy per address so the EIP-1967 read + its Etherscan ABI
  // fetch happen ONCE per contract (reused across resolveImplementations and
  // resolveOwnerAndGetterTargets — no duplicate Etherscan call, §5.3).
  const proxyCache = new Map<string, Promise<ProxyDetectionResult>>();
  const getProxy = (address: string): Promise<ProxyDetectionResult> => {
    const key = address.toLowerCase();
    let p = proxyCache.get(key);
    if (!p) {
      p = detectProxy({ protocolAddress: address, blockNumber });
      proxyCache.set(key, p);
    }
    return p;
  };

  const readStorageAddress = async (
    address: string,
    slot: `0x${string}`,
  ): Promise<string | null> => {
    const word = await publicClient.getStorageAt({ address: hex(address), slot, blockNumber });
    return slotToAddress(word);
  };

  const callAddress = async (address: string, fn: string): Promise<string | null> => {
    try {
      const res = await publicClient.readContract({
        address: hex(address),
        abi: parseAbi([`function ${fn}() view returns (address)`]),
        functionName: fn,
        blockNumber,
      });
      const a = String(res).toLowerCase();
      return a === ZERO ? null : a;
    } catch {
      return null; // function absent / reverted
    }
  };

  const callSucceeds = async (address: string, signature: string, fn: string): Promise<boolean> => {
    try {
      await publicClient.readContract({
        address: hex(address),
        abi: parseAbi([signature]),
        functionName: fn,
        blockNumber,
      });
      return true;
    } catch {
      return false;
    }
  };

  return {
    async resolveImplementations(address) {
      const out: ImplementationDiscovery[] = [];

      // EIP-1967 implementation (reuses detectProxy + its impl-ABI fetch).
      const proxy = await getProxy(address);
      if (proxy.proxyImplementation) {
        out.push({ source: "IMPL_SLOT", address: proxy.proxyImplementation });
      }

      // EIP-1967 beacon → beacon.implementation() (second hop).
      const beacon = await readStorageAddress(address, EIP1967_BEACON_SLOT);
      if (beacon) {
        const impl = await callAddress(beacon, BEACON_IMPL_FN);
        if (impl) out.push({ source: "BEACON_IMPL", address: impl });
      }

      // EIP-1822 (UUPS legacy) + pre-1967 OZ/zos slots.
      const uups = await readStorageAddress(address, EIP1822_PROXIABLE_SLOT);
      if (uups) out.push({ source: "UUPS_SLOT", address: uups });
      const ozLegacy = await readStorageAddress(address, OZ_LEGACY_IMPL_SLOT);
      if (ozLegacy) out.push({ source: "OZ_LEGACY_SLOT", address: ozLegacy });

      // Compound Unitroller-style implementation getter.
      const compound = await callAddress(address, COMPOUND_IMPL_FN);
      if (compound) out.push({ source: "COMPOUND_IMPL", address: compound });

      // EIP-1167 minimal proxy from runtime bytecode.
      const code = await publicClient.getCode({ address: hex(address), blockNumber });
      const minimal = parseMinimalProxyTarget(code ?? null);
      if (minimal) out.push({ source: "MINIMAL_PROXY", address: minimal });

      return out;
    },

    async resolveOwnerAndGetterTargets(address) {
      const out: OwnerOrGetterTarget[] = [];

      // EIP-1967 admin (reused from the memoised detectProxy).
      const proxy = await getProxy(address);
      if (proxy.proxyAdminAddress) {
        out.push({ source: "ADMIN_SLOT", address: proxy.proxyAdminAddress });
      }

      // Curated zero-arg, address-returning getters (static calls).
      for (const getterName of ADDRESS_GETTERS) {
        const target = await callAddress(address, getterName);
        if (target) out.push({ source: "GETTER", address: target, getterName });
      }
      // Address[]-returning getters (Safe owners).
      for (const getterName of ADDRESS_ARRAY_GETTERS) {
        try {
          const res = await publicClient.readContract({
            address: hex(address),
            abi: parseAbi([`function ${getterName}() view returns (address[])`]),
            functionName: getterName,
            blockNumber,
          });
          for (const owner of (res as readonly string[]) ?? []) {
            const a = owner.toLowerCase();
            if (a !== ZERO) out.push({ source: "GETTER", address: a, getterName });
          }
        } catch {
          // getter absent / reverted — skip
        }
      }

      return out;
    },

    async probeRoleSignals(address) {
      const safe = await detectSafe({ candidateAddress: address });
      const isConfirmedSafe = safe.isSafe === true;

      const erc20Checks = await Promise.all([
        callSucceeds(address, "function totalSupply() view returns (uint256)", ERC20_PROBE_FNS[0]),
        callSucceeds(address, "function decimals() view returns (uint8)", ERC20_PROBE_FNS[1]),
      ]);
      const isErc20 = erc20Checks.every(Boolean);

      const timelockChecks = await Promise.all([
        callSucceeds(address, "function getMinDelay() view returns (uint256)", TIMELOCK_PROBE_FNS[0]),
        callSucceeds(address, "function delay() view returns (uint256)", TIMELOCK_PROBE_FNS[1]),
      ]);
      const hasTimelockSelectors = timelockChecks.some(Boolean);

      const isBridgeRegistry = KNOWN_BRIDGE_ADDRESSES.has(address.toLowerCase());

      return { isConfirmedSafe, hasTimelockSelectors, isErc20, isBridgeRegistry };
    },

    async hasBytecode(address) {
      const code = await publicClient.getCode({ address: hex(address), blockNumber });
      return !!code && code !== "0x";
    },

    log: (line) => console.log(`[discovery] ${line}`),
  };
}
