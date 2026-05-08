import type {
  GovernanceDetector,
  GovernanceFindingInput,
} from "./types";

/**
 * GOV-006 — Upgradeable contract without emergency pause (Plan 02 §5.2).
 *
 * Fires MEDIUM when an upgradeable proxy's implementation ABI exposes
 * no recognisable pause/circuit-breaker function. Pause mechanisms let
 * protocols halt operations during exploits, governance attacks, or
 * unexpected behaviour — critical for incident response.
 *
 * Anchored: Compound 62 (October 2021, drainable rewards) + Audius
 * (July 2022, re-init exploit) — both could have been mitigated by a
 * timely pause if one had existed.
 *
 * Trigger: ALL of
 *   - proxy detected (proxyType !== NONE / null)
 *   - implementationAbi available + parses to a non-empty function set
 *   - no function name matches PAUSE_PATTERNS
 *
 * Skip semantics (no findings):
 *   - No proxy → no upgrade authority concern.
 *   - ABI null / empty / malformed → graceful (Etherscan unverified or
 *     missing key); GOV-006 is not the place to surface ABI-unavailable
 *     errors.
 *
 * Severity MEDIUM, publicRank 3 — gated to the higher tiers since the
 * absence of a pause is a posture concern, not an exploitable
 * condition on its own.
 */
const DETECTOR_ID = "GOV-006";
const DETECTOR_VERSION = 1;

/**
 * Pause/circuit-breaker function name patterns. Detection is "any
 * match means a pause mechanism exists". `paused()` (getter alone)
 * counts as a positive signal — its presence implies Pausable
 * inheritance even without explicit pause()/unpause() exports in the
 * ABI we inspected.
 *
 * Case-sensitivity is mixed by design:
 *   - Canonical OZ names (pause, unpause, paused, _pause) are
 *     case-sensitive — Solidity is too, and OZ inheritance produces
 *     these exact identifiers.
 *   - Less-canonical conventions (emergencyStop, circuitBreaker,
 *     shutdown) accept case variants since the same idea ships
 *     under multiple capitalisations across protocols.
 */
const PAUSE_PATTERNS: readonly RegExp[] = [
  /^pause$/,
  /^unpause$/,
  /^paused$/,
  /^_pause$/,
  /^pauseAll$/i,
  /^emergencyStop$/i,
  /^emergencyPause$/i,
  /^circuitBreaker$/i,
  /^kill$/,
  /^shutdown$/i,
];

interface AbiFunction {
  type: "function";
  name: string;
  inputs: unknown[];
  stateMutability?: string;
}

function isAbiFunction(item: unknown): item is AbiFunction {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Record<string, unknown>;
  return (
    candidate.type === "function" && typeof candidate.name === "string"
  );
}

export const detectGov006: GovernanceDetector = (snapshot) => {
  const findings: GovernanceFindingInput[] = [];

  if (snapshot.proxyType === "NONE" || snapshot.proxyType === null) {
    return findings;
  }

  if (!snapshot.implementationAbi) {
    return findings;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.implementationAbi);
  } catch {
    return findings;
  }
  if (!Array.isArray(parsed)) {
    return findings;
  }

  const functions: AbiFunction[] = parsed.filter(isAbiFunction);

  // E.7 I1: an empty function array is information-absent (e.g., the
  // ABI was empty `[]`, or contained only events/errors). That's
  // distinct from "we read the ABI and confirmed no pause exists" —
  // we cannot make the latter claim without functions to check, so
  // skip rather than fire a false-positive MEDIUM.
  if (functions.length === 0) {
    return findings;
  }

  const hasPauseMechanism = functions.some((fn) =>
    PAUSE_PATTERNS.some((pattern) => pattern.test(fn.name)),
  );

  if (hasPauseMechanism) {
    return findings;
  }

  findings.push({
    detectorId: DETECTOR_ID,
    detectorVersion: DETECTOR_VERSION,
    severity: "MEDIUM",
    publicTitle: "Upgradeable contract lacks emergency pause mechanism",
    title:
      "Proxy implementation has no detectable pause or circuit-breaker function",
    description:
      "The upgradeable proxy's implementation contract does not expose " +
      "any recognisable pause, emergency stop, or circuit-breaker " +
      "function. Without a pause mechanism, the protocol cannot quickly " +
      "halt operations if an exploit is detected, governance is " +
      "compromised, or unexpected behaviour emerges. Industry standard " +
      "for upgradeable protocols includes OpenZeppelin's Pausable " +
      "pattern (pause(), unpause(), paused()) or equivalent emergency " +
      "controls. Compound's October 2021 reward-drain incident and " +
      "various flash-loan exploits could have been mitigated with " +
      "timely pausing.",
    evidence: {
      proxyType: snapshot.proxyType,
      proxyImplementation: snapshot.proxyImplementation,
      abiFunctionCount: functions.length,
      pausePatternMatched: false,
      patternsChecked: PAUSE_PATTERNS.map((p) => p.source),
    },
    affectedComponent: "proxy",
    references: [
      "https://docs.openzeppelin.com/contracts/4.x/api/security#Pausable",
      "https://blog.openzeppelin.com/pausable-contracts",
      "https://rekt.news/compound-rekt/",
    ],
    remediationHint:
      "Add OpenZeppelin Pausable to the implementation contract.",
    remediationDetailed:
      "1. Inherit Pausable from @openzeppelin/contracts/security/Pausable.sol\n" +
      "2. Add whenNotPaused or whenPaused modifiers to critical functions:\n" +
      "   - User-facing operations: whenNotPaused\n" +
      "   - Recovery operations: whenPaused\n" +
      "3. Implement access-controlled pause/unpause:\n" +
      "   function pause() external onlyTimelock { _pause(); }\n" +
      "   function unpause() external onlyTimelock { _unpause(); }\n" +
      "4. Document pause authority (preferably Timelock + Multisig).\n" +
      "5. Test pause functionality in fork tests before mainnet upgrade.\n" +
      "6. Plan for upgrade migration since adding state to existing\n" +
      "   storage layout requires careful slot management.",
    publicRank: 3,
  });

  return findings;
};
