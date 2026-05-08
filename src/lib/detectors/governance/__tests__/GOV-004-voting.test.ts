// @vitest-environment node
import { describe, expect, it } from "vitest";

import { detectGov004 } from "../GOV-004-voting";

import {
  baseSnapshot,
  cleanUniswapV3Fixture,
  withGovernor,
} from "./fixtures";

describe("GOV-004 detectGov004 (Plan 02 E.4)", () => {
  describe("No governor present", () => {
    it("returns no findings when hasGovernor is false", () => {
      expect(detectGov004(baseSnapshot())).toHaveLength(0);
    });
  });

  describe("Rule 1: CURRENT_BALANCE voting (vulnerable)", () => {
    it("fires HIGH when votingSnapshotType is CURRENT_BALANCE", () => {
      const snapshot = withGovernor(baseSnapshot(), {
        votingSnapshotType: "CURRENT_BALANCE",
      });

      const findings = detectGov004(snapshot);

      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("HIGH");
      expect(findings[0]!.publicRank).toBe(2);
      expect(findings[0]!.evidence.votingSnapshotType).toBe("CURRENT_BALANCE");
      expect(findings[0]!.title).toContain("current-balance voting");
    });

    it("references Beanstalk in description and references", () => {
      const snapshot = withGovernor(baseSnapshot(), {
        votingSnapshotType: "CURRENT_BALANCE",
      });

      const finding = detectGov004(snapshot)[0]!;

      expect(finding.description).toContain("Beanstalk");
      expect(
        finding.references.some((r) => r.toLowerCase().includes("beanstalk")),
      ).toBe(true);
    });
  });

  describe("Rule 2: Undetermined voting type (defensive INFO)", () => {
    it("fires INFO when votingSnapshotType is null", () => {
      const snapshot = withGovernor(baseSnapshot(), {
        votingSnapshotType: null,
      });

      const findings = detectGov004(snapshot);

      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("INFO");
      expect(findings[0]!.publicRank).toBe(3);
      expect(findings[0]!.title).toContain("Could not determine");
    });

    it("does NOT fire HIGH (avoids false positive on undetermined)", () => {
      const snapshot = withGovernor(baseSnapshot(), {
        votingSnapshotType: null,
      });

      const findings = detectGov004(snapshot);

      const highSev = findings.find((f) => f.severity === "HIGH");
      expect(highSev).toBeUndefined();
    });
  });

  describe("Safe voting mechanism (BLOCK_BASED)", () => {
    it("returns no findings when votingSnapshotType is BLOCK_BASED", () => {
      const snapshot = withGovernor(baseSnapshot(), {
        votingSnapshotType: "BLOCK_BASED",
      });

      expect(detectGov004(snapshot)).toHaveLength(0);
    });
  });

  describe("cleanUniswapV3Fixture (uses withGovernor default BLOCK_BASED)", () => {
    it("returns no findings (BLOCK_BASED default → safe)", () => {
      // E.4 set withGovernor's default votingSnapshotType to BLOCK_BASED;
      // cleanUniswapV3Fixture inherits this, so GOV-004 stays quiet on
      // the canonical clean baseline.
      expect(detectGov004(cleanUniswapV3Fixture)).toHaveLength(0);
    });
  });

  describe("Output structure", () => {
    it("CURRENT_BALANCE finding populates the full GovernanceFindingInput shape", () => {
      const snapshot = withGovernor(baseSnapshot(), {
        votingSnapshotType: "CURRENT_BALANCE",
      });

      const finding = detectGov004(snapshot)[0]!;

      expect(finding.detectorId).toBe("GOV-004");
      expect(finding.detectorVersion).toBe(1);
      expect(finding.publicTitle).toBeTruthy();
      expect(finding.title).toBeTruthy();
      expect(finding.description.length).toBeGreaterThan(100);
      expect(finding.evidence.governorAddress).toBeDefined();
      expect(finding.references.length).toBeGreaterThanOrEqual(2);
      expect(finding.remediationHint).toBeTruthy();
      expect(finding.remediationDetailed).toBeTruthy();
      expect(finding.affectedComponent).toBe("governor");
    });

    it("INFO finding populates the full GovernanceFindingInput shape", () => {
      const snapshot = withGovernor(baseSnapshot(), {
        votingSnapshotType: null,
      });

      const finding = detectGov004(snapshot)[0]!;

      expect(finding.detectorId).toBe("GOV-004");
      expect(finding.severity).toBe("INFO");
      expect(finding.evidence.votingSnapshotType).toBeNull();
      expect(finding.references.length).toBeGreaterThanOrEqual(1);
      expect(finding.affectedComponent).toBe("governor");
    });
  });
});
