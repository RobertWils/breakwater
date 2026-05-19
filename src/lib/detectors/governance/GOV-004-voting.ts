import type {
  GovernanceDetector,
  GovernanceFindingInput,
} from "./types";

/**
 * GOV-004 — Current-balance voting without snapshot (Plan 02 spec §5.2).
 *
 * Two rules:
 *   1. votingSnapshotType === "CURRENT_BALANCE" → HIGH finding.
 *      Anchored to Beanstalk (April 2022, $182M lost). The protocol's
 *      voting weight reads live token balanceOf, allowing flash-loan
 *      governance attacks: borrow tokens → vote → return tokens, all
 *      in one transaction.
 *
 *   2. votingSnapshotType === null → INFO finding (defensive).
 *      Snapshot probe couldn't determine the mechanism. Could be a
 *      custom Governor, RPC visibility issue, or unverified contract.
 *      Manual review recommended; not a vulnerability assertion.
 *
 * BLOCK_BASED is the safe outcome — covers both OZ block-number
 * checkpoints and OZ 4.9+ timestamp clocks (the granularity stays in
 * snapshot.rawState.governor.clockMode for Plan 03+ if needed).
 *
 * Fires only when hasGovernor=true. Multisig-only governance has no
 * "voting" concept in this sense, so the detector stays quiet there.
 */
const DETECTOR_ID = "GOV-004";
const DETECTOR_VERSION = 1;

export const detectGov004: GovernanceDetector = (snapshot) => {
  const findings: GovernanceFindingInput[] = [];

  if (!snapshot.hasGovernor) {
    return findings;
  }

  if (snapshot.votingSnapshotType === "CURRENT_BALANCE") {
    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "HIGH",
      publicTitle: "Governance vulnerable to flash-loan vote manipulation",
      title: "Governor uses current-balance voting without snapshot mechanism",
      description:
        "The governance contract uses live token balanceOf() to determine " +
        "voting weight, without a checkpoint or snapshot mechanism. This " +
        "pattern is vulnerable to flash-loan attacks: an attacker borrows " +
        "large amounts of governance tokens, casts a vote, and returns " +
        "the tokens within the same transaction. The Beanstalk Protocol " +
        "exploit (April 2022, $182M lost) used this exact attack vector. " +
        "Industry standard requires checkpoint-based voting (e.g., " +
        "OpenZeppelin Governor with ERC20Votes, or Compound Bravo with " +
        "getPriorVotes).",
      evidence: {
        governorAddress: snapshot.governorAddress,
        governorType: snapshot.governorType,
        votingSnapshotType: "CURRENT_BALANCE",
      },
      affectedComponent: "governor",
      references: [
        "https://rekt.news/beanstalk-rekt/",
        "https://docs.openzeppelin.com/contracts/4.x/governance#token-snapshot",
        "https://compound.finance/docs/governance#get-prior-votes",
      ],
      remediationHint:
        "Migrate to checkpoint-based voting using ERC20Votes or implement getPriorVotes.",
      remediationDetailed:
        "1. Replace governance token with OpenZeppelin ERC20Votes:\n" +
        "   - Token tracks delegations + checkpoints automatically.\n" +
        "   - Governor calls token.getPastVotes(account, blockNumber).\n" +
        "2. OR, for existing tokens, implement Comp-style checkpoints:\n" +
        "   - Track historical balance snapshots per delegate.\n" +
        "   - Governor calls token.getPriorVotes(account, blockNumber).\n" +
        "3. Migration path requires:\n" +
        "   - Token contract upgrade (if upgradeable) or new token deployment.\n" +
        "   - Voting weight migration plan for active proposals.\n" +
        "   - Documentation update for delegators.\n" +
        "4. CRITICAL: Pause governance during migration to prevent attacks.",
      publicRank: 2,
    });
    return findings;
  }

  if (snapshot.votingSnapshotType === null) {
    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "INFO",
      publicTitle: "Governor voting mechanism undetermined",
      title: "Could not determine governor voting snapshot mechanism",
      description:
        "Breakwater could not detect whether this governor uses " +
        "checkpoint-based voting (safe) or current-balance voting " +
        "(vulnerable to flash-loan attacks). This may indicate a custom " +
        "governor implementation or limited RPC visibility. Manual review " +
        "of the governor's vote-counting logic is recommended.",
      evidence: {
        governorAddress: snapshot.governorAddress,
        governorType: snapshot.governorType,
        votingSnapshotType: null,
      },
      affectedComponent: "governor",
      references: [
        "https://docs.openzeppelin.com/contracts/4.x/governance#token-snapshot",
      ],
      remediationHint:
        "Manually verify governor uses ERC20Votes-style checkpoint voting.",
      remediationDetailed:
        "1. Inspect governor source code on Etherscan.\n" +
        "2. Look for getPastVotes(), getPriorVotes(), or a checkpoints mapping.\n" +
        "3. Confirm voting weight is captured at proposal creation block.\n" +
        "4. If voting reads live balanceOf — flash-loan attack vector exists.",
      publicRank: 3,
    });
  }

  return findings;
};
