import { parseAbi } from "viem";

import { publicClient } from "@/lib/rpc-client";

import type { GovernorDetectionResult } from "./types";

/**
 * Probe ABI covering both Timelock variants the Plan 02 detectors care
 * about:
 *   - OpenZeppelin TimelockController → `getMinDelay()` returns uint256
 *   - Compound Timelock              → `delay()` returns uint256
 * Both expose `admin()` (used by GOV-001 indirect risk + D.3c proxy
 * cascade), so we batch all three reads in a single multicall.
 */
const TIMELOCK_PROBE_ABI = parseAbi([
  "function getMinDelay() view returns (uint256)",
  "function delay() view returns (uint256)",
  "function admin() view returns (address)",
] as const);

/**
 * Compound Bravo Governor exposes `timelock()` returning the timelock
 * address. OZ Governor wires a TimelockController via constructor and
 * doesn't expose a `timelock()` getter, so this lookup is best-effort —
 * a revert here just means we fall through to candidateAddress probing
 * (or skip Timelock detection entirely for this scan).
 */
const GOVERNOR_TIMELOCK_ABI = parseAbi([
  "function timelock() view returns (address)",
] as const);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface TimelockDetectionResult {
  address: string;
  minDelay: number; // seconds
  admin: string | null;
  raw: {
    getMinDelay: string | null;
    delay: string | null;
    admin: string | null;
  };
}

export interface TimelockDetectionContext {
  blockNumber: bigint;
  governorResult: GovernorDetectionResult;
  /** Explicit address to probe; takes precedence over governor.timelock() lookup. */
  candidateAddress?: string;
}

type MulticallEntry =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

/**
 * Detect Timelock contract via cascade:
 *
 *   1. Use `candidateAddress` if provided.
 *   2. Else, if a Governor was detected, call `governor.timelock()`.
 *      A revert (OZ Governor) or zero-address result fails through.
 *   3. Probe the resolved address for `getMinDelay()` / `delay()`.
 *      The smaller-naming `getMinDelay` is preferred when both succeed
 *      (defends against OZ-clone contracts that also expose a stub
 *      `delay()` for compatibility).
 *   4. Returns `null` for any non-Timelock outcome (no probe address,
 *      both delay functions revert, network failure).
 */
export async function detectTimelock(
  context: TimelockDetectionContext,
): Promise<TimelockDetectionResult | null> {
  const { blockNumber, governorResult, candidateAddress } = context;

  let probeAddress: string | null = candidateAddress?.toLowerCase() ?? null;

  if (!probeAddress && governorResult) {
    try {
      const fromGovernor = await publicClient.readContract({
        address: governorResult.address as `0x${string}`,
        abi: GOVERNOR_TIMELOCK_ABI,
        functionName: "timelock",
        blockNumber,
      });
      const candidate = String(fromGovernor).toLowerCase();
      if (candidate !== ZERO_ADDRESS && candidate.startsWith("0x")) {
        probeAddress = candidate;
      }
    } catch {
      // governor.timelock() reverted or doesn't exist (OZ Governor) — fall through.
    }
  }

  if (!probeAddress) {
    return null;
  }

  let results: MulticallEntry[];
  try {
    results = (await publicClient.multicall({
      contracts: [
        {
          address: probeAddress as `0x${string}`,
          abi: TIMELOCK_PROBE_ABI,
          functionName: "getMinDelay",
        },
        {
          address: probeAddress as `0x${string}`,
          abi: TIMELOCK_PROBE_ABI,
          functionName: "delay",
        },
        {
          address: probeAddress as `0x${string}`,
          abi: TIMELOCK_PROBE_ABI,
          functionName: "admin",
        },
      ],
      blockNumber,
      allowFailure: true,
    })) as MulticallEntry[];
  } catch {
    return null;
  }

  const [getMinDelayResult, delayResult, adminResult] = results;
  if (!getMinDelayResult || !delayResult || !adminResult) {
    return null;
  }

  const ozDelay =
    getMinDelayResult.status === "success" &&
    typeof getMinDelayResult.result === "bigint"
      ? Number(getMinDelayResult.result)
      : null;
  const compoundDelay =
    delayResult.status === "success" && typeof delayResult.result === "bigint"
      ? Number(delayResult.result)
      : null;

  if (ozDelay === null && compoundDelay === null) {
    return null;
  }

  const minDelay = ozDelay !== null ? ozDelay : (compoundDelay as number);

  const admin =
    adminResult.status === "success" && typeof adminResult.result === "string"
      ? adminResult.result.toLowerCase()
      : null;

  return {
    address: probeAddress,
    minDelay,
    admin,
    raw: {
      getMinDelay:
        getMinDelayResult.status === "success"
          ? String(getMinDelayResult.result)
          : null,
      delay:
        delayResult.status === "success" ? String(delayResult.result) : null,
      admin:
        adminResult.status === "success" ? String(adminResult.result) : null,
    },
  };
}
