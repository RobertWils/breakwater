import type {
  GovernanceDetector,
  GovernanceFindingInput,
} from "./types";

/**
 * GOV-003 — Multisig signer concentration (Plan 02 spec §5.2).
 *
 * Three independent rules — Rules 1 + 2 always run; Rule 3 skips when
 * Rules 1 or 2 already fire so a degenerate small multisig (e.g.,
 * 1-of-2) doesn't produce three overlapping findings on the same
 * underlying weakness.
 *
 *   Rule 1: threshold < 3 (insufficient signature requirement).
 *   Rule 2: ownerCount < 4 (insufficient distribution of authority).
 *   Rule 3: threshold/ownerCount > 50% (concentration of authority).
 *
 * All findings HIGH (publicRank 2). Anchored: Drift (April 2026,
 * 2-of-5 with team-controlled keys) + Ronin (March 2022, 5-of-9 with
 * 5 keys controlled by Sky Mavis).
 *
 * Fires only when `snapshot.hasMultisig === true`. The "declared
 * multisig that returned 404 from Safe API" case is signalled by
 * `hasMultisig: false` after captureGovernanceSnapshot's normalisation
 * — a separate finding type for that scenario is deferred to Plan 03+.
 */
const DETECTOR_ID = "GOV-003";
const DETECTOR_VERSION = 1;

const MIN_THRESHOLD = 3;
const MIN_OWNER_COUNT = 4;
const MAX_THRESHOLD_RATIO = 0.5;

export const detectGov003: GovernanceDetector = (snapshot) => {
  const findings: GovernanceFindingInput[] = [];

  if (!snapshot.hasMultisig) {
    return findings;
  }

  const { multisigAddress, multisigThreshold, multisigOwnerCount } = snapshot;

  // Defensive: hasMultisig=true should imply non-null fields, but if
  // the snapshot is malformed we'd rather skip than throw.
  if (multisigThreshold === null || multisigOwnerCount === null) {
    return findings;
  }

  const thresholdBelowMin = multisigThreshold < MIN_THRESHOLD;
  const ownerCountBelowMin = multisigOwnerCount < MIN_OWNER_COUNT;

  // Rule 1: threshold below minimum
  if (thresholdBelowMin) {
    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "HIGH",
      publicTitle: "Multisig threshold below safe minimum",
      title: `Multisig requires only ${multisigThreshold} signature(s) — below 3-signature minimum`,
      description:
        `The multisig requires only ${multisigThreshold} signature(s) to ` +
        "execute transactions. Industry standard is at least 3 signatures " +
        "(typically in a 3-of-5 configuration) to prevent single-signer " +
        "compromise from leading to fund loss.",
      evidence: {
        multisigAddress,
        multisigThreshold,
        multisigOwnerCount,
        minSafeThreshold: MIN_THRESHOLD,
      },
      affectedComponent: "multisig",
      references: [
        "https://docs.safe.global/safe-smart-account/signatures/threshold",
        "https://blog.openzeppelin.com/multisig-best-practices",
      ],
      remediationHint:
        "Update multisig threshold to at least 3 (recommend 3-of-5 minimum).",
      remediationDetailed:
        "1. Audit current signers — verify each is independently controlled.\n" +
        "2. Add additional signers if owner count is below 5 (target 5+).\n" +
        "3. Update threshold to 3 (or higher) via Safe transaction:\n" +
        "   safe.changeThreshold(3)\n" +
        "4. Document signer roles and key custody policies.",
      publicRank: 2,
    });
  }

  // Rule 2: owner count below minimum
  if (ownerCountBelowMin) {
    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "HIGH",
      publicTitle: "Multisig has too few signers",
      title: `Multisig has only ${multisigOwnerCount} signer(s) — below 4-signer minimum`,
      description:
        `The multisig has ${multisigOwnerCount} signers, providing ` +
        "insufficient distribution of signing authority. With fewer signers, " +
        "key compromise or unavailability has higher impact on protocol " +
        "operations and security.",
      evidence: {
        multisigAddress,
        multisigOwnerCount,
        minSafeOwnerCount: MIN_OWNER_COUNT,
      },
      affectedComponent: "multisig",
      references: [
        "https://docs.safe.global/safe-smart-account/signatures/threshold",
      ],
      remediationHint:
        "Add additional signers to reach at least 4 (target 5+).",
      remediationDetailed:
        "1. Identify additional independent custodians (geographically/organizationally diverse).\n" +
        "2. Add each as a Safe owner via:\n" +
        "   safe.addOwnerWithThreshold(newSignerAddress, currentThreshold)\n" +
        "3. Verify each new signer's key custody and recovery procedures.\n" +
        "4. Document signer rotation and removal policies.",
      publicRank: 2,
    });
  }

  // Rule 3: threshold/ownerCount > 50%, suppressed when Rules 1 or 2 fire
  // so a degenerate config (e.g., 1-of-2) doesn't produce a third
  // finding repeating the same fundamental issue.
  if (!thresholdBelowMin && !ownerCountBelowMin) {
    const concentrationRatio = multisigThreshold / multisigOwnerCount;
    if (concentrationRatio > MAX_THRESHOLD_RATIO) {
      const ratioPercent = Math.round(concentrationRatio * 100);
      const recommendedOwnerCount = Math.ceil(multisigThreshold * 2);
      const recommendedThreshold = Math.max(
        MIN_THRESHOLD,
        Math.floor(multisigOwnerCount / 2),
      );

      findings.push({
        detectorId: DETECTOR_ID,
        detectorVersion: DETECTOR_VERSION,
        severity: "HIGH",
        publicTitle: "Multisig threshold ratio too concentrated",
        title: `Multisig threshold is ${multisigThreshold}/${multisigOwnerCount} (${ratioPercent}%) — above 50%`,
        description:
          `The multisig requires ${multisigThreshold} of ${multisigOwnerCount} ` +
          `signatures (${ratioPercent}%), exceeding the recommended 50% ratio. ` +
          "High concentration ratios mean compromise of relatively few keys " +
          "enables unauthorized actions. Industry standard is to keep threshold " +
          "below 50% of total signers (e.g., 3-of-7 instead of 4-of-7).",
        evidence: {
          multisigAddress,
          multisigThreshold,
          multisigOwnerCount,
          concentrationRatio,
          maxSafeRatio: MAX_THRESHOLD_RATIO,
        },
        affectedComponent: "multisig",
        references: [
          "https://blog.openzeppelin.com/multisig-best-practices",
        ],
        remediationHint:
          "Either reduce threshold or add more signers to bring ratio below 50%.",
        remediationDetailed:
          "Two paths to reduce concentration ratio:\n" +
          "1. ADD SIGNERS (preferred): increase ownerCount while keeping threshold:\n" +
          `   For ${multisigThreshold}-of-${multisigOwnerCount} → ${multisigThreshold}-of-${recommendedOwnerCount}+\n` +
          "2. REDUCE THRESHOLD: only if signers are highly trusted:\n" +
          `   For ${multisigThreshold}-of-${multisigOwnerCount} → ${recommendedThreshold}-of-${multisigOwnerCount}\n` +
          "Path 1 is generally safer; Path 2 reduces both attack surface and operational resilience.",
        publicRank: 2,
      });
    }
  }

  return findings;
};
