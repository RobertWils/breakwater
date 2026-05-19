import type {
  GovernanceDetector,
  GovernanceFindingInput,
} from "./types";

/**
 * GOV-001 — Timelock missing or insufficient delay (Plan 02 spec §5.2).
 *
 * Three independent rules — any can fire on its own; multiple can fire
 * for one snapshot. Each fires CRITICAL.
 *
 *   Rule 1: Governor present but no Timelock.
 *           Anchored: Drift Protocol (April 2026), Beanstalk (April 2022).
 *           Risk: proposals execute immediately on passage; no review
 *           window for users or security researchers.
 *
 *   Rule 2: Timelock present but minDelay < 48h industry standard.
 *           Anchored: Beanstalk (24h delay was bypassed via
 *           emergencyCommit but the short delay was the structural
 *           weakness). Risk: insufficient review window.
 *
 *   Rule 3: Timelock admin is an EOA (not a contract).
 *           Anchored: Drift (admin EOA effectively bypassed delay).
 *           Risk: single-key compromise can bypass governance entirely.
 *
 * Snapshot inputs: hasGovernor, hasTimelock, timelockAddress,
 * timelockMinDelay, timelockAdmin, timelockAdminIsContract,
 * governorAddress, governorType.
 *
 * `timelockAdminIsContract === false` is the EOA signal (D.6 added the
 * field). `null` (indeterminate) does NOT fire — fail closed: a
 * transient RPC outage shouldn't produce false-positive findings.
 */
const DETECTOR_ID = "GOV-001";
const DETECTOR_VERSION = 1;
const MIN_SAFE_DELAY_SECONDS = 48 * 60 * 60; // 48h

export const detectGov001: GovernanceDetector = (snapshot) => {
  const findings: GovernanceFindingInput[] = [];

  // Rule 1: Governor without Timelock
  if (snapshot.hasGovernor && !snapshot.hasTimelock) {
    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "CRITICAL",
      publicTitle: "Governance executes without timelock delay",
      title:
        "Governor contract has no Timelock — proposals execute immediately",
      description:
        "A governance system without a Timelock allows proposals to execute " +
        "immediately upon passing, giving users no window to react to " +
        "malicious or buggy proposals. Industry standard requires at least " +
        "48 hours of delay between proposal passage and execution.",
      evidence: {
        hasGovernor: true,
        hasTimelock: false,
        governorAddress: snapshot.governorAddress,
        governorType: snapshot.governorType,
      },
      affectedComponent: "governor",
      references: [
        "https://docs.openzeppelin.com/contracts/4.x/governance#timelock",
        "https://blog.openzeppelin.com/governor-smart-contract",
      ],
      remediationHint:
        "Deploy an OpenZeppelin TimelockController and transfer governance ownership to it.",
      remediationDetailed:
        "1. Deploy a TimelockController with minDelay >= 172800 seconds (48 hours).\n" +
        "2. Configure TIMELOCK_ADMIN_ROLE for emergency operations only.\n" +
        "3. Transfer Governor ownership to the Timelock.\n" +
        "4. Update Governor contract to route execute() through Timelock.",
      publicRank: 1,
    });
  }

  // Rule 2: Timelock present but minDelay below 48h
  if (
    snapshot.hasTimelock &&
    snapshot.timelockMinDelay !== null &&
    snapshot.timelockMinDelay < MIN_SAFE_DELAY_SECONDS
  ) {
    const hoursActual = Math.floor(snapshot.timelockMinDelay / 3600);

    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "CRITICAL",
      publicTitle: "Timelock delay below safe threshold",
      title: `Timelock minimum delay is ${hoursActual}h, below 48h threshold`,
      description:
        `The Timelock contract has a minimum delay of ${snapshot.timelockMinDelay} ` +
        `seconds (${hoursActual} hours), which is below the 48-hour industry ` +
        `standard. This shortens the window for users and security ` +
        `researchers to detect and respond to malicious proposals.`,
      evidence: {
        timelockAddress: snapshot.timelockAddress,
        timelockMinDelay: snapshot.timelockMinDelay,
        minSafeDelay: MIN_SAFE_DELAY_SECONDS,
        hoursActual,
        hoursRequired: 48,
      },
      affectedComponent: "timelock",
      references: [
        "https://docs.openzeppelin.com/contracts/4.x/api/governance#TimelockController-getMinDelay",
      ],
      remediationHint:
        "Update Timelock minDelay to at least 172800 seconds (48 hours).",
      remediationDetailed:
        "Schedule a Timelock proposal calling updateDelay(172800). The " +
        "proposal itself will be subject to the current (insufficient) " +
        "delay; consider whether stakeholders accept this transition risk " +
        "or prefer redeploying with the safer parameter from inception.",
      publicRank: 1,
    });
  }

  // Rule 3: Timelock admin is an EOA
  if (
    snapshot.hasTimelock &&
    snapshot.timelockAdmin !== null &&
    snapshot.timelockAdminIsContract === false
  ) {
    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "CRITICAL",
      publicTitle: "Timelock controlled by single key (EOA)",
      title:
        "Timelock admin is an externally owned account, not a multisig",
      description:
        "The Timelock contract's admin is an externally owned account " +
        "(EOA), meaning a single private key controls the Timelock's " +
        "operations. This single point of failure can bypass the Timelock " +
        "entirely if the key is compromised, lost, or its holder acts " +
        "maliciously.",
      evidence: {
        timelockAddress: snapshot.timelockAddress,
        timelockAdmin: snapshot.timelockAdmin,
        timelockAdminIsContract: false,
      },
      affectedComponent: "timelock",
      references: ["https://blog.openzeppelin.com/timelock-smart-contracts"],
      remediationHint:
        "Replace EOA admin with a Gnosis Safe multisig (3-of-5 minimum).",
      remediationDetailed:
        "1. Deploy a Gnosis Safe multisig with at least 3-of-5 threshold.\n" +
        "2. Add geographically and organizationally diverse signers.\n" +
        "3. Schedule a Timelock proposal to grant TIMELOCK_ADMIN_ROLE to the Safe.\n" +
        "4. After delay passes, revoke TIMELOCK_ADMIN_ROLE from the EOA.",
      publicRank: 1,
    });
  }

  return findings;
};
