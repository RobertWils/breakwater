import type {
  GovernanceDetector,
  GovernanceFindingInput,
} from "./types";

/**
 * GOV-002 — Emergency execute / governance bypass functions (spec §5.2).
 *
 * Scans the protocol's ABI for function names matching emergency or
 * bypass patterns. Each match fires CRITICAL.
 *
 * ABI source picked at detector level:
 *   proxyType === "NONE" → snapshot.protocolAbi (the protocol contract
 *                          itself, fetched in capture-snapshot.ts E.2).
 *   proxyType !== "NONE" → snapshot.implementationAbi (proxy
 *                          implementation, fetched in detect-proxy.ts D.3c).
 *
 * Skipped (zero findings, no error) when the relevant ABI is null —
 * Etherscan may be rate-limited, the contract unverified, or the API
 * key missing. Phase F orchestrator surfaces "ABI unavailable" via
 * ModuleRun.errorMessage when relevant; the detector itself just
 * stays quiet.
 *
 * Anchored incidents:
 *   - Beanstalk (April 2022): emergencyCommit() bypassed timelock.
 *   - Drift (April 2026): direct admin path with no timelock review.
 *   - Audius (July 2022): re-initialize() callable post-deployment.
 */
const DETECTOR_ID = "GOV-002";
const DETECTOR_VERSION = 1;

const BYPASS_PATTERNS: ReadonlyArray<{ pattern: RegExp; risk: string }> = [
  {
    pattern: /^emergency[A-Z]/,
    risk: "emergency execution function (e.g., emergencyWithdraw, emergencyPause)",
  },
  {
    pattern: /^force[A-Z]/,
    risk: "force operation (e.g., forceTransfer, forceUnlock)",
  },
  {
    pattern: /^bypass[A-Z]/,
    risk: "explicit governance bypass (e.g., bypassTimelock)",
  },
  {
    pattern: /^skipTimelock/i,
    risk: "timelock skip mechanism",
  },
  {
    pattern: /^adminExecute/i,
    risk: "direct admin execution outside timelock",
  },
  {
    pattern: /^rescue[A-Z]/,
    risk: "asset rescue function (legitimate use case but worth flagging)",
  },
];

interface AbiFunction {
  type: "function";
  name: string;
  inputs: unknown[];
  outputs?: unknown[];
  stateMutability?: string;
}

function isAbiFunction(item: unknown): item is AbiFunction {
  if (!item || typeof item !== "object") return false;
  const candidate = item as Record<string, unknown>;
  return (
    candidate.type === "function" &&
    typeof candidate.name === "string"
  );
}

export const detectGov002: GovernanceDetector = (snapshot) => {
  const findings: GovernanceFindingInput[] = [];

  const abi =
    snapshot.proxyType === "NONE"
      ? snapshot.protocolAbi
      : snapshot.implementationAbi;
  if (!abi) {
    return findings;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(abi);
  } catch {
    return findings;
  }
  if (!Array.isArray(parsed)) {
    return findings;
  }

  const functions: AbiFunction[] = parsed.filter(isAbiFunction);

  // Track unique pattern matches so overloaded function definitions
  // (same name, different signatures) don't produce duplicate findings.
  const matched = new Set<string>();

  for (const fn of functions) {
    if (matched.has(fn.name)) continue;

    for (const { pattern, risk } of BYPASS_PATTERNS) {
      if (!pattern.test(fn.name)) continue;
      matched.add(fn.name);

      const abiSource: "protocol" | "implementation" =
        snapshot.proxyType === "NONE" ? "protocol" : "implementation";
      const contractAddress =
        abiSource === "implementation"
          ? snapshot.proxyImplementation
          : // Best-effort for non-proxy: governorAddress when present;
            // null otherwise. Plan 02 snapshot doesn't carry the raw
            // protocol address — accepted limitation, evidence is still
            // useful via functionName and abiSource.
            snapshot.governorAddress;

      findings.push({
        detectorId: DETECTOR_ID,
        detectorVersion: DETECTOR_VERSION,
        severity: "CRITICAL",
        publicTitle: "Bypass function detected in protocol ABI",
        title: `Function "${fn.name}" matches ${risk} pattern`,
        description:
          `The protocol contract exposes a function "${fn.name}" matching ` +
          `the pattern of an ${risk}. If this function is callable by ` +
          `admin or owner without timelock review, it can bypass normal ` +
          `governance controls and allow immediate privileged actions.`,
        evidence: {
          functionName: fn.name,
          functionInputs: fn.inputs,
          stateMutability: fn.stateMutability ?? null,
          patternMatched: pattern.toString(),
          abiSource,
          contractAddress,
        },
        affectedComponent: "governance",
        references: [
          "https://blog.openzeppelin.com/governance-attacks",
          "https://consensys.io/diligence/audits/2022/08/aave-v3-governance-checklist",
        ],
        remediationHint: `Review who can call ${fn.name}. If admin/owner-callable, route through Timelock.`,
        remediationDetailed:
          `1. Audit access control on ${fn.name} (modifiers like onlyOwner, onlyAdmin).\n` +
          `2. If the function exists for legitimate emergency use, ensure it requires:\n` +
          `   - Timelock-mediated approval (minimum 48h delay)\n` +
          `   - Multisig authorization (3-of-5 minimum)\n` +
          `   - Or both, for highest-privilege operations\n` +
          `3. Document the function's intended use case in protocol governance docs.\n` +
          `4. Consider deprecating/removing if no longer needed.`,
        publicRank: 1,
      });

      // First-pattern-wins per function so overloaded matches don't
      // multiply findings (e.g., a function matching both /^emergency/
      // and /^rescue/ — currently impossible by name shape but defensive).
      break;
    }
  }

  return findings;
};
