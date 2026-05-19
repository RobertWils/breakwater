// @vitest-environment node
import { describe, expect, it } from "vitest";

import { detectGov001 } from "../GOV-001-timelock";

import {
  baseSnapshot,
  cleanUniswapV3Fixture,
  driftLikeFixture,
  withGovernor,
  withTimelock,
} from "./fixtures";

describe("GOV-001 detectGov001 (Plan 02 E.1)", () => {
  describe("Rule 1: Governor without Timelock", () => {
    it("fires CRITICAL when governor present but no timelock (driftLikeFixture)", () => {
      const findings = detectGov001(driftLikeFixture);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        detectorId: "GOV-001",
        severity: "CRITICAL",
        publicTitle: "Governance executes without timelock delay",
        affectedComponent: "governor",
      });
      expect(findings[0]!.evidence.hasGovernor).toBe(true);
      expect(findings[0]!.evidence.hasTimelock).toBe(false);
    });

    it("does not fire when neither governor nor timelock present", () => {
      const findings = detectGov001(baseSnapshot());
      expect(findings).toHaveLength(0);
    });

    it("does not fire when timelock is present (no governor)", () => {
      // Default withTimelock = 48h delay + contract admin → fully clean
      const snapshot = withTimelock(baseSnapshot());
      const findings = detectGov001(snapshot);
      expect(findings).toHaveLength(0);
    });
  });

  describe("Rule 2: Insufficient Timelock delay", () => {
    it("fires CRITICAL when timelock minDelay < 48h", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockMinDelay: 86_400, // 24h
      });

      const findings = detectGov001(snapshot);

      const delayFinding = findings.find(
        (f) => f.evidence.timelockMinDelay === 86_400,
      );
      expect(delayFinding).toBeDefined();
      expect(delayFinding?.severity).toBe("CRITICAL");
      expect(delayFinding?.evidence.hoursActual).toBe(24);
    });

    it("does not fire when timelock minDelay equals 48h (boundary)", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockMinDelay: 172_800,
      });

      const findings = detectGov001(snapshot);

      const delayFinding = findings.find((f) =>
        f.title.includes("below 48h threshold"),
      );
      expect(delayFinding).toBeUndefined();
    });

    it("does not fire when timelock minDelay above 48h", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockMinDelay: 259_200, // 72h
      });

      const findings = detectGov001(snapshot);

      const delayFinding = findings.find((f) =>
        f.title.includes("below 48h threshold"),
      );
      expect(delayFinding).toBeUndefined();
    });

    it("does not fire when timelock minDelay is null (indeterminate)", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockMinDelay: null,
      });

      const findings = detectGov001(snapshot);

      const delayFinding = findings.find((f) =>
        f.title.includes("below 48h threshold"),
      );
      expect(delayFinding).toBeUndefined();
    });
  });

  describe("Rule 3: EOA admin", () => {
    it("fires CRITICAL when timelock admin is EOA", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockAdminIsContract: false,
      });

      const findings = detectGov001(snapshot);

      const eoaFinding = findings.find((f) =>
        f.title.includes("externally owned account"),
      );
      expect(eoaFinding).toBeDefined();
      expect(eoaFinding?.severity).toBe("CRITICAL");
    });

    it("does not fire when admin is a contract", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockAdminIsContract: true,
      });

      const findings = detectGov001(snapshot);

      const eoaFinding = findings.find((f) =>
        f.title.includes("externally owned account"),
      );
      expect(eoaFinding).toBeUndefined();
    });

    it("does not fire when admin contract status is null (fail closed on indeterminate)", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockAdminIsContract: null,
      });

      const findings = detectGov001(snapshot);

      const eoaFinding = findings.find((f) =>
        f.title.includes("externally owned account"),
      );
      expect(eoaFinding).toBeUndefined();
    });

    it("does not fire when timelock has no admin (admin null)", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockAdmin: null,
        timelockAdminIsContract: null,
      });

      const findings = detectGov001(snapshot);

      const eoaFinding = findings.find((f) =>
        f.title.includes("externally owned account"),
      );
      expect(eoaFinding).toBeUndefined();
    });
  });

  describe("Combined scenarios", () => {
    it("returns empty findings for cleanUniswapV3Fixture", () => {
      const findings = detectGov001(cleanUniswapV3Fixture);
      expect(findings).toHaveLength(0);
    });

    it("fires multiple findings when multiple rules trigger (delay + EOA admin)", () => {
      const snapshot = withTimelock(withGovernor(baseSnapshot()), {
        timelockMinDelay: 3_600, // 1h
        timelockAdminIsContract: false,
      });

      const findings = detectGov001(snapshot);

      expect(findings.length).toBeGreaterThanOrEqual(2);
      expect(findings.every((f) => f.severity === "CRITICAL")).toBe(true);
    });
  });

  describe("Output structure (contract checks)", () => {
    it("every finding populates the full GovernanceFindingInput shape", () => {
      const findings = detectGov001(driftLikeFixture);

      findings.forEach((finding) => {
        expect(finding.detectorId).toBe("GOV-001");
        expect(finding.detectorVersion).toBe(1);
        expect(finding.severity).toBeDefined();
        expect(finding.publicTitle).toBeTruthy();
        expect(finding.title).toBeTruthy();
        expect(finding.description).toBeTruthy();
        expect(finding.evidence).toBeDefined();
        expect(finding.references.length).toBeGreaterThan(0);
        expect(finding.remediationHint).toBeTruthy();
        expect(finding.remediationDetailed).toBeTruthy();
        expect(finding.publicRank).toBe(1);
      });
    });
  });
});
