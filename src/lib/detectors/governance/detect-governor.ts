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

/**
 * Snapshot-mechanism probe ABI (E.4):
 *   - getVotes(address, uint256)  → OZ Governor checkpoint API
 *   - CLOCK_MODE()                → OZ 4.9+ exposes "mode=blocknumber"
 *                                   or "mode=timestamp" so we can record
 *                                   the timepoint type in raw.clockMode
 *                                   (forensic; both flavours map to
 *                                   BLOCK_BASED for GOV-004 purposes).
 *   - getCurrentVotes(address)    → Compound Bravo legacy API; presence
 *                                   without checkpoint API → vulnerable
 *                                   CURRENT_BALANCE pattern (Beanstalk).
 */
const SNAPSHOT_PROBE_ABI = parseAbi([
  "function getVotes(address account, uint256 timepoint) view returns (uint256)",
  "function CLOCK_MODE() view returns (string)",
  "function getCurrentVotes(address account) view returns (uint96)",
] as const);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

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

  // Snapshot probe (E.4). A failure here doesn't invalidate the rest of
  // the detection — `votingSnapshotType` just stays null and GOV-004
  // fires its INFO-level "undetermined" finding.
  let snapshotResults: MulticallEntry[] | null = null;
  try {
    snapshotResults = (await publicClient.multicall({
      contracts: [
        {
          address,
          abi: SNAPSHOT_PROBE_ABI,
          functionName: "getVotes",
          args: [ZERO_ADDRESS, BigInt(0)],
        },
        {
          address,
          abi: SNAPSHOT_PROBE_ABI,
          functionName: "CLOCK_MODE",
        },
        {
          address,
          abi: SNAPSHOT_PROBE_ABI,
          functionName: "getCurrentVotes",
          args: [ZERO_ADDRESS],
        },
      ],
      blockNumber,
      allowFailure: true,
    })) as MulticallEntry[];
  } catch {
    snapshotResults = null;
  }

  let votingSnapshotType: GovernorDetectionResult extends infer R
    ? R extends { votingSnapshotType: infer V }
      ? V
      : never
    : never = null;
  let clockMode: string | null = null;

  if (snapshotResults) {
    const [getVotesResult, clockModeResult, getCurrentVotesResult] =
      snapshotResults;

    if (
      clockModeResult?.status === "success" &&
      typeof clockModeResult.result === "string"
    ) {
      clockMode = clockModeResult.result;
      // Both "mode=blocknumber" and "mode=timestamp" describe checkpoint
      // voting — both map to BLOCK_BASED. Granularity preserved in
      // raw.clockMode for forensics.
      votingSnapshotType = "BLOCK_BASED";
    }

    // No CLOCK_MODE but getVotes(address, timepoint) responds — also
    // checkpoint-based (modern OZ Governor without explicit clock).
    if (votingSnapshotType === null && getVotesResult?.status === "success") {
      votingSnapshotType = "BLOCK_BASED";
    }

    // Only legacy getCurrentVotes responds → live-balance Compound
    // Bravo pattern (Beanstalk attack surface).
    if (
      votingSnapshotType === null &&
      getCurrentVotesResult?.status === "success"
    ) {
      votingSnapshotType = "CURRENT_BALANCE";
    }
  }

  return {
    type,
    address: protocolAddress.toLowerCase(),
    version: detectedVersion,
    votingSnapshotType,
    raw: {
      name: valueOrNull(name),
      version: valueOrNull(version),
      votingDelay: bigintToString(votingDelay),
      votingPeriod: bigintToString(votingPeriod),
      quorumNumerator: bigintToString(ozQuorum),
      quorumVotes: bigintToString(compQuorum),
      proposalThreshold: bigintToString(proposalThreshold),
      clockMode,
      getVotesAvailable:
        snapshotResults !== null
          ? snapshotResults[0]?.status === "success"
          : null,
      getCurrentVotesAvailable:
        snapshotResults !== null
          ? snapshotResults[2]?.status === "success"
          : null,
    },
  };
}
