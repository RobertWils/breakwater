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
 * Heuristic:
 *   impl  set + admin  set    → EIP_1967_TRANSPARENT (TUP via ProxyAdmin)
 *   impl  set + admin  empty  → EIP_1822_UUPS        (no separate admin)
 *   impl  empty               → NONE / unrecognised pattern
 *
 * Note on EIP-1822: UUPS does NOT use a separate storage slot for the
 * implementation. Every real UUPS proxy stores its impl at the same
 * EIP-1967 implementation slot above. The well-known PROXIABLE constant
 * (`0xc5f16f…bcf7`) is the *return value* of `proxiableUUID()`, not a
 * storage location — reading that slot on a UUPS proxy returns empty.
 * We discriminate via presence/absence of the admin slot instead.
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
      proxyType = "EIP_1822_UUPS";
      // UUPS pattern: the proxy is its own upgrade authority. The
      // implementation contract holds upgrade logic; tooling treats the
      // proxy address itself as the "admin" for ownership-tracking purposes.
      proxyAdminAddress = protocolAddress.toLowerCase();
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
 * Returns null for empty (`0x` / `0x000…000`) or malformed slots.
 */
function parseSlotAsAddress(
  slot: string | null | undefined,
): string | null {
  if (!slot || slot === "0x") return null;
  if (slot.length !== 66) return null; // 0x + 64 hex = 32 bytes

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
