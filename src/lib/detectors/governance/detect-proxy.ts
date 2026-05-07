import type { ProxyType } from "@prisma/client";

import { fetchContractAbi } from "@/lib/etherscan-client";
import { publicClient } from "@/lib/rpc-client";

/**
 * Proxy detection for the governance snapshot.
 *
 * Storage slot constants (EIP-1967):
 *   IMPLEMENTATION = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
 *   ADMIN          = bytes32(uint256(keccak256("eip1967.proxy.admin")) - 1)
 *
 * Values verified by computing in-tree:
 *   const h = keccak256(stringToBytes("eip1967.proxy.implementation"));
 *   "0x" + (BigInt(h) - 1n).toString(16).padStart(64, "0")
 *
 * Classification (Plan 02 D.5 — refined per Codex review):
 *   impl set + admin set    → EIP_1967_TRANSPARENT (TUP via ProxyAdmin)
 *   impl set + admin empty  → CUSTOM (could be UUPS, could be a custom
 *                                     proxy without ProxyAdmin — we
 *                                     can't distinguish without
 *                                     reading the implementation
 *                                     contract's interface)
 *   impl empty              → NONE
 *
 * The previous version classified impl-set+admin-empty as
 * EIP_1822_UUPS, which over-claimed: not every proxy without a
 * ProxyAdmin is UUPS. Phase E GOV-005 may upgrade to confirmed
 * EIP_1822_UUPS by checking the implementation contract's
 * proxiableUUID() return value or upgradeToAndCall() presence.
 *
 * RPC outage handling (D.5 I4): if BOTH storage reads reject, we throw
 * so the orchestrator captures the error in ModuleRun.errorMessage
 * rather than persisting an ambiguous "NONE" classification. A single
 * read failing still falls through to the impl/admin presence checks
 * with that one slot treated as null.
 */
const EIP_1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const EIP_1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface ProxyDetectionResult {
  proxyType: ProxyType;
  proxyAdminAddress: string | null;
  proxyImplementation: string | null;
  proxyAdminIsContract: boolean | null;
  implementationAbi: string | null;
}

export interface ProxyDetectionContext {
  protocolAddress: string;
  blockNumber: bigint;
}

export async function detectProxy(
  context: ProxyDetectionContext,
): Promise<ProxyDetectionResult> {
  const { protocolAddress, blockNumber } = context;
  const address = protocolAddress as `0x${string}`;

  const [implResult, adminResult] = await Promise.allSettled([
    publicClient.getStorageAt({
      address,
      slot: EIP_1967_IMPLEMENTATION_SLOT,
      blockNumber,
    }),
    publicClient.getStorageAt({
      address,
      slot: EIP_1967_ADMIN_SLOT,
      blockNumber,
    }),
  ]);

  // D.5 I4: when BOTH reads fail, propagate so the orchestrator records
  // the failure in ModuleRun.errorMessage instead of silently persisting
  // a misleading NONE classification.
  if (implResult.status === "rejected" && adminResult.status === "rejected") {
    const implReason =
      implResult.reason instanceof Error
        ? implResult.reason.message
        : String(implResult.reason);
    const adminReason =
      adminResult.reason instanceof Error
        ? adminResult.reason.message
        : String(adminResult.reason);
    throw new Error(
      `Proxy detection failed: both EIP-1967 storage reads rejected (${implReason}; ${adminReason})`,
    );
  }

  const eip1967Impl = parseSlotAsAddress(
    implResult.status === "fulfilled" ? implResult.value : null,
  );
  const eip1967Admin = parseSlotAsAddress(
    adminResult.status === "fulfilled" ? adminResult.value : null,
  );

  let proxyType: ProxyType;
  let proxyImplementation: string | null = null;
  let proxyAdminAddress: string | null = null;

  if (eip1967Impl) {
    proxyImplementation = eip1967Impl;
    if (eip1967Admin) {
      proxyType = "EIP_1967_TRANSPARENT";
      proxyAdminAddress = eip1967Admin;
    } else {
      // D.5 I2: downgraded from EIP_1822_UUPS to CUSTOM. UUPS without
      // a separate ProxyAdmin is one possibility; a custom non-OZ proxy
      // pattern is another. Distinguishing requires reading the
      // implementation interface (proxiableUUID / upgradeToAndCall) —
      // deferred to Phase E GOV-005 where the ABI is already in scope.
      proxyType = "CUSTOM";
      proxyAdminAddress = null;
    }
  } else {
    proxyType = "NONE";
  }

  let proxyAdminIsContract: boolean | null = null;
  if (proxyAdminAddress) {
    proxyAdminIsContract = await checkIsContract(proxyAdminAddress, blockNumber);
  }

  let implementationAbi: string | null = null;
  if (proxyImplementation && proxyImplementation !== ZERO_ADDRESS) {
    const abi = await fetchContractAbi(proxyImplementation);
    if (abi.ok) {
      implementationAbi = abi.data;
    }
    // Etherscan unavailable / unverified contract → leave null. GOV-002
    // detector treats null as "skip with note", not as failure.
  }

  return {
    proxyType,
    proxyAdminAddress,
    proxyImplementation,
    proxyAdminIsContract,
    implementationAbi,
  };
}

/**
 * Parse a 32-byte storage slot value as an Ethereum address.
 * Returns null for:
 *   - empty (`0x` / `0x000…000`) or malformed slots
 *   - slots whose high 12 bytes are non-zero (D.5 I3): an
 *     address-shaped slot has the address in the rightmost 20 bytes
 *     and the leading 12 bytes zero. Anything else is garbage data
 *     that happens to live in the slot (shared storage with another
 *     mapping, uninitialised value with non-canonical layout, etc.)
 *     and would yield a misleading "address" if naively truncated.
 */
function parseSlotAsAddress(
  slot: string | null | undefined,
): string | null {
  if (!slot || slot === "0x") return null;
  if (slot.length !== 66) return null; // 0x + 64 hex = 32 bytes

  // High 12 bytes = chars 2..26 in the 0x-prefixed slot. Must be zero
  // for a canonical address-shaped slot.
  const high12Hex = slot.slice(2, 26).toLowerCase();
  if (high12Hex !== "000000000000000000000000") return null;

  const addrHex = "0x" + slot.slice(-40).toLowerCase();
  if (addrHex === ZERO_ADDRESS) return null;
  return addrHex;
}

async function checkIsContract(
  address: string,
  blockNumber: bigint,
): Promise<boolean> {
  try {
    const code = await publicClient.getCode({
      address: address as `0x${string}`,
      blockNumber,
    });
    return Boolean(code && code !== "0x" && code.length > 2);
  } catch {
    return false;
  }
}
