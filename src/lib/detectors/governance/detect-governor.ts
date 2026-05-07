import { parseAbi } from "viem";

import { publicClient } from "@/lib/rpc-client";

import type {
  GovernorDetectionContext,
  GovernorDetectionResult,
} from "./types";

/**
 * Probe ABI shared across all Governor calls — multicall lets us pass
 * one ABI and address-by-functionName per contract entry.
 *
 * Detection heuristic (per spec §5.2):
 *   - OZ Governor          → exposes quorumNumerator()
 *   - Compound Bravo       → exposes quorumVotes()
 *   - Custom variant       → both (we report CUSTOM rather than guess)
 *   - Not a Governor       → neither, or votingDelay()/votingPeriod()
 *                            also missing (failure to confirm voting
 *                            machinery rules out Governor outright)
 */
const GOVERNOR_PROBE_ABI = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function votingDelay() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function quorumNumerator() view returns (uint256)",
  "function quorumVotes() view returns (uint256)",
  "function proposalThreshold() view returns (uint256)",
] as const);

const PROBE_FUNCTIONS = [
  "name",
  "version",
  "votingDelay",
  "votingPeriod",
  "quorumNumerator",
  "quorumVotes",
  "proposalThreshold",
] as const;

type MulticallEntry =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

function valueOrNull(entry: MulticallEntry): unknown {
  return entry.status === "success" ? entry.result : null;
}

function bigintToString(entry: MulticallEntry): string | null {
  if (entry.status !== "success") return null;
  if (typeof entry.result === "bigint") return entry.result.toString();
  return entry.result == null ? null : String(entry.result);
}

/**
 * Detect whether `protocolAddress` is a Governor at the given block.
 *
 * Returns `null` for any non-Governor outcome (no voting functions,
 * no quorum function, network failure). Callers can treat null as
 * "no Governor present" — they don't need to distinguish between
 * "definitely not a Governor" and "couldn't reach RPC", since both
 * lead to the same downstream behavior (skip Governor-derived findings,
 * proceed to multisig/proxy detection).
 */
export async function detectGovernor(
  context: GovernorDetectionContext,
): Promise<GovernorDetectionResult> {
  const { protocolAddress, blockNumber } = context;
  const address = protocolAddress as `0x${string}`;

  let results: MulticallEntry[];
  try {
    results = (await publicClient.multicall({
      contracts: PROBE_FUNCTIONS.map((functionName) => ({
        address,
        abi: GOVERNOR_PROBE_ABI,
        functionName,
      })),
      blockNumber,
      allowFailure: true,
    })) as MulticallEntry[];
  } catch {
    return null;
  }

  const [
    name,
    version,
    votingDelay,
    votingPeriod,
    ozQuorum,
    compQuorum,
    proposalThreshold,
  ] = results;

  // Tuple length must match PROBE_FUNCTIONS — but TS can't statically
  // narrow `results.length` after a `.map(...)` of unknown-length input,
  // so we destructure-and-guard at the boundary.
  if (
    !name ||
    !version ||
    !votingDelay ||
    !votingPeriod ||
    !ozQuorum ||
    !compQuorum ||
    !proposalThreshold
  ) {
    return null;
  }

  const hasVotingFunctions =
    votingDelay.status === "success" && votingPeriod.status === "success";
  const hasOzQuorum = ozQuorum.status === "success";
  const hasCompQuorum = compQuorum.status === "success";

  if (!hasVotingFunctions || (!hasOzQuorum && !hasCompQuorum)) {
    return null;
  }

  let type: GovernorDetectionResult extends infer R
    ? R extends { type: infer T }
      ? T
      : never
    : never;
  if (hasOzQuorum && !hasCompQuorum) {
    type = "OZ_GOVERNOR";
  } else if (hasCompQuorum && !hasOzQuorum) {
    type = "COMPOUND_BRAVO";
  } else {
    // Both succeeded — likely a custom hybrid or a contract that
    // implements both interfaces. Flag CUSTOM so the detector layer
    // doesn't false-attribute findings to OZ/Compound semantics.
    type = "CUSTOM";
  }

  const detectedVersion =
    version.status === "success" && typeof version.result === "string"
      ? version.result
      : null;

  return {
    type,
    address: protocolAddress.toLowerCase(),
    version: detectedVersion,
    raw: {
      name: valueOrNull(name),
      version: valueOrNull(version),
      votingDelay: bigintToString(votingDelay),
      votingPeriod: bigintToString(votingPeriod),
      quorumNumerator: bigintToString(ozQuorum),
      quorumVotes: bigintToString(compQuorum),
      proposalThreshold: bigintToString(proposalThreshold),
    },
  };
}
