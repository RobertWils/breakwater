// @vitest-environment node
import { describe, expect, it } from "vitest";

import { detectGov003 } from "../GOV-003-multisig";

import {
  baseSnapshot,
  beanstalkLikeFixture,
  cleanUniswapV3Fixture,
  withMultisig,
} from "./fixtures";

describe("GOV-003 detectGov003 (Plan 02 E.3)", () => {
  describe("No multisig present", () => {
    it("returns no findings when hasMultisig is false", () => {
      expect(detectGov003(baseSnapshot())).toHaveLength(0);
    });
  });

  describe("Rule 1: threshold below minimum (3)", () => {
    it("fires HIGH when threshold is 1", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 1,
        multisigOwnerCount: 5,
      });

      const findings = detectGov003(snapshot);
      const r1 = findings.find((f) =>
        f.title.includes("below 3-signature minimum"),
      );

      expect(r1).toBeDefined();
      expect(r1?.severity).toBe("HIGH");
      expect(r1?.evidence.multisigThreshold).toBe(1);
    });

    it("fires HIGH when threshold is 2", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 2,
        multisigOwnerCount: 5,
      });

      const r1 = detectGov003(snapshot).find((f) =>
        f.title.includes("below 3-signature minimum"),
      );
      expect(r1).toBeDefined();
    });

    it("does not fire when threshold equals 3 (boundary)", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 3,
        multisigOwnerCount: 5,
      });

      const r1 = detectGov003(snapshot).find((f) =>
        f.title.includes("below 3-signature minimum"),
      );
      expect(r1).toBeUndefined();
    });
  });

  describe("Rule 2: owner count below minimum (4)", () => {
    it("fires HIGH when ownerCount is 2", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 1,
        multisigOwnerCount: 2,
        multisigOwners: ["0x1", "0x2"],
      });

      const r2 = detectGov003(snapshot).find((f) =>
        f.title.includes("below 4-signer minimum"),
      );
      expect(r2).toBeDefined();
      expect(r2?.severity).toBe("HIGH");
    });

    it("fires HIGH when ownerCount is 3", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 2,
        multisigOwnerCount: 3,
        multisigOwners: ["0x1", "0x2", "0x3"],
      });

      const r2 = detectGov003(snapshot).find((f) =>
        f.title.includes("below 4-signer minimum"),
      );
      expect(r2).toBeDefined();
    });

    it("does not fire when ownerCount equals 4 (boundary)", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 3,
        multisigOwnerCount: 4,
        multisigOwners: ["0x1", "0x2", "0x3", "0x4"],
      });

      const r2 = detectGov003(snapshot).find((f) =>
        f.title.includes("below 4-signer minimum"),
      );
      expect(r2).toBeUndefined();
    });
  });

  describe("Rule 3: threshold ratio above 50%", () => {
    it("fires HIGH when ratio is 80% (4-of-5)", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 4,
        multisigOwnerCount: 5,
      });

      const r3 = detectGov003(snapshot).find((f) =>
        f.title.includes("above 50%"),
      );
      expect(r3).toBeDefined();
      expect(r3?.severity).toBe("HIGH");
      expect(r3?.evidence.concentrationRatio).toBe(0.8);
    });

    it("fires HIGH at 60% (3-of-5)", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 3,
        multisigOwnerCount: 5,
      });

      const r3 = detectGov003(snapshot).find((f) =>
        f.title.includes("above 50%"),
      );
      expect(r3).toBeDefined();
    });

    it("does not fire at exactly 50% (3-of-6, boundary)", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 3,
        multisigOwnerCount: 6,
        multisigOwners: ["0x1", "0x2", "0x3", "0x4", "0x5", "0x6"],
      });

      const r3 = detectGov003(snapshot).find((f) =>
        f.title.includes("above 50%"),
      );
      expect(r3).toBeUndefined();
    });

    it("does not fire when ratio is below 50% (3-of-7)", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 3,
        multisigOwnerCount: 7,
        multisigOwners: [
          "0x1",
          "0x2",
          "0x3",
          "0x4",
          "0x5",
          "0x6",
          "0x7",
        ],
      });

      const r3 = detectGov003(snapshot).find((f) =>
        f.title.includes("above 50%"),
      );
      expect(r3).toBeUndefined();
    });

    it("suppresses Rule 3 when Rules 1 or 2 already fire (1-of-2)", () => {
      // 1-of-2 trips Rule 1 + Rule 2; Rule 3 (50% ratio) is suppressed
      // so the same underlying weakness doesn't produce three findings.
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 1,
        multisigOwnerCount: 2,
        multisigOwners: ["0x1", "0x2"],
      });

      const findings = detectGov003(snapshot);
      const r3 = findings.find((f) => f.title.includes("above 50%"));
      expect(r3).toBeUndefined();

      expect(findings).toHaveLength(2);
      const titles = findings.map((f) => f.title);
      expect(titles.some((t) => t.includes("below 3-signature"))).toBe(true);
      expect(titles.some((t) => t.includes("below 4-signer"))).toBe(true);
    });
  });

  describe("Combined scenarios (named fixtures)", () => {
    it("returns no findings for cleanUniswapV3Fixture (3-of-7 after E.3 update)", () => {
      // E.3 updated withMultisig default to 3-of-7 so the clean baseline
      // trips none of GOV-003's three rules.
      expect(detectGov003(cleanUniswapV3Fixture)).toHaveLength(0);
    });

    it("fires Rules 1 + 2 for beanstalkLikeFixture (1-of-2)", () => {
      const findings = detectGov003(beanstalkLikeFixture);

      expect(findings).toHaveLength(2);
      expect(findings.every((f) => f.severity === "HIGH")).toBe(true);
      const r3 = findings.find((f) => f.title.includes("above 50%"));
      expect(r3).toBeUndefined();
    });

    it("returns empty findings for healthy 3-of-7 multisig", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 3,
        multisigOwnerCount: 7,
        multisigOwners: [
          "0x1",
          "0x2",
          "0x3",
          "0x4",
          "0x5",
          "0x6",
          "0x7",
        ],
      });

      expect(detectGov003(snapshot)).toHaveLength(0);
    });
  });

  describe("Defensive null handling", () => {
    it("returns no findings when threshold is null", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: null,
        multisigOwnerCount: 5,
      });

      expect(detectGov003(snapshot)).toHaveLength(0);
    });

    it("returns no findings when ownerCount is null", () => {
      const snapshot = withMultisig(baseSnapshot(), {
        multisigThreshold: 3,
        multisigOwnerCount: null,
      });

      expect(detectGov003(snapshot)).toHaveLength(0);
    });
  });

  describe("Output structure", () => {
    it("every finding populates the full GovernanceFindingInput shape", () => {
      const findings = detectGov003(beanstalkLikeFixture);

      findings.forEach((finding) => {
        expect(finding.detectorId).toBe("GOV-003");
        expect(finding.detectorVersion).toBe(1);
        expect(finding.severity).toBe("HIGH");
        expect(finding.publicTitle).toBeTruthy();
        expect(finding.title).toBeTruthy();
        expect(finding.description).toBeTruthy();
        expect(finding.evidence.multisigAddress).toBeDefined();
        expect(finding.references.length).toBeGreaterThan(0);
        expect(finding.publicRank).toBe(2);
        expect(finding.affectedComponent).toBe("multisig");
      });
    });
  });
});
