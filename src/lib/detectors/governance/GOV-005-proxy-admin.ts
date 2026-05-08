import type {
  GovernanceDetector,
  GovernanceFindingInput,
} from "./types";

/**
 * GOV-005 — Proxy admin misconfiguration (Plan 02 spec §5.2 + Q6).
 *
 * Two independent rules:
 *
 *   Rule 1 (CRITICAL): Proxy admin is an EOA.
 *     A single private key has unilateral upgrade authority — rug-pull
 *     vector. Industry standard: Timelock + multisig.
 *
 *   Rule 2 (MEDIUM): Proxy type is CUSTOM (Q6 decision).
 *     The proxy doesn't conform to EIP-1967 transparent or EIP-1822
 *     UUPS standards. Custom patterns lack standardised invariants and
 *     need manual security review. Anchored to Audius (July 2022,
 *     non-standard storage layout enabled re-initialize() exploit).
 *     EIP_1822_UUPS itself is not currently emitted by detect-proxy
 *     (D.5 I2 collapsed UUPS-without-positive-evidence into CUSTOM);
 *     reserved for Plan 03+ when proxiableUUID() probing lands.
 *
 * Skipped (no findings) when:
 *   - proxyType === "NONE" or null (not a proxy)
 *   - Rule 1: proxyAdminAddress is null OR proxyAdminIsContract is null
 *     (fail-closed on indeterminate — same convention as GOV-001).
 */
const DETECTOR_ID = "GOV-005";
const DETECTOR_VERSION = 1;

export const detectGov005: GovernanceDetector = (snapshot) => {
  const findings: GovernanceFindingInput[] = [];

  if (snapshot.proxyType === "NONE" || snapshot.proxyType === null) {
    return findings;
  }

  // Rule 1: EOA admin (CRITICAL)
  if (
    snapshot.proxyAdminAddress !== null &&
    snapshot.proxyAdminIsContract === false
  ) {
    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "CRITICAL",
      publicTitle: "Proxy controlled by single key (EOA admin)",
      title: "Proxy admin is an externally owned account, not a multisig",
      description:
        "The proxy contract's admin is an externally owned account (EOA), " +
        "meaning a single private key has unilateral authority to upgrade " +
        "the protocol's implementation contract. An attacker who compromises " +
        "or coerces the admin's key can deploy malicious implementation code " +
        "(rug pull, drain funds, alter behavior) instantly with no governance " +
        "oversight. Industry standard requires upgrade authority to be " +
        "controlled by a Timelock + multisig combination.",
      evidence: {
        proxyType: snapshot.proxyType,
        proxyAdminAddress: snapshot.proxyAdminAddress,
        proxyAdminIsContract: false,
        proxyImplementation: snapshot.proxyImplementation,
      },
      affectedComponent: "proxy",
      references: [
        "https://blog.openzeppelin.com/proxy-patterns",
        "https://docs.openzeppelin.com/contracts/4.x/api/proxy#TransparentUpgradeableProxy",
      ],
      remediationHint:
        "Transfer proxy admin role to a Timelock-controlled multisig.",
      remediationDetailed:
        "1. Deploy a Gnosis Safe multisig (3-of-5 minimum, 4-of-7 preferred).\n" +
        "2. Deploy a TimelockController with minDelay >= 172800 seconds (48h).\n" +
        "3. Transfer proxy admin role to the Timelock:\n" +
        "   For TransparentUpgradeableProxy: ProxyAdmin.changeProxyAdmin(proxy, timelock)\n" +
        "   For UUPS: implementation._authorizeUpgrade modifier checks Timelock\n" +
        "4. Configure Timelock proposers to be the multisig address.\n" +
        "5. Document upgrade procedure and emergency response plan.",
      publicRank: 2,
    });
  }

  // Rule 2: CUSTOM proxy type (MEDIUM)
  if (snapshot.proxyType === "CUSTOM") {
    findings.push({
      detectorId: DETECTOR_ID,
      detectorVersion: DETECTOR_VERSION,
      severity: "MEDIUM",
      publicTitle: "Proxy uses non-standard pattern",
      title:
        "Proxy implementation does not match EIP-1967 transparent or EIP-1822 UUPS standards",
      description:
        "The protocol uses a proxy pattern that doesn't conform to the " +
        "widely-adopted EIP-1967 (transparent admin proxy) or EIP-1822 " +
        "(UUPS) standards. Custom proxy implementations require manual " +
        "security review since they lack the standardised invariants and " +
        "audited reference implementations of canonical patterns. Common " +
        "risks include: missing access control on the upgrade function, " +
        "storage collision between proxy and implementation, or admin slot " +
        "manipulation vulnerabilities.",
      evidence: {
        proxyType: "CUSTOM",
        proxyAdminAddress: snapshot.proxyAdminAddress,
        proxyImplementation: snapshot.proxyImplementation,
        proxyVerified: snapshot.proxyVerified,
      },
      affectedComponent: "proxy",
      references: [
        "https://eips.ethereum.org/EIPS/eip-1967",
        "https://eips.ethereum.org/EIPS/eip-1822",
        "https://blog.openzeppelin.com/upgrades-plugins-1-9",
      ],
      remediationHint:
        "Audit upgrade authorisation logic and consider migrating to EIP-1967 transparent or UUPS pattern.",
      remediationDetailed:
        "1. Document the custom proxy pattern's design rationale.\n" +
        "2. Audit upgrade function for:\n" +
        "   - Access control (who can call upgrade?)\n" +
        "   - Reentrancy in upgrade flow\n" +
        "   - Storage layout preservation across upgrades\n" +
        "3. Consider migrating to a standard pattern in the next major version:\n" +
        "   - EIP-1967 TransparentUpgradeableProxy (separate ProxyAdmin)\n" +
        "   - EIP-1822 UUPS (upgrade logic in implementation)\n" +
        "4. If migration is not feasible, formal verification of upgrade " +
        "   invariants is recommended.",
      publicRank: 2,
    });
  }

  return findings;
};
