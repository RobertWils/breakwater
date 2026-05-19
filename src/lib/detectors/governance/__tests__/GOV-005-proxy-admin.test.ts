// @vitest-environment node
import { describe, expect, it } from "vitest";

import { detectGov005 } from "../GOV-005-proxy-admin";

import {
  audiusLikeFixture,
  baseSnapshot,
  cleanUniswapV3Fixture,
  withProxy,
} from "./fixtures";

describe("GOV-005 detectGov005 (Plan 02 E.5)", () => {
  describe("No proxy present", () => {
    it("returns no findings when proxyType is NONE", () => {
      expect(detectGov005(baseSnapshot())).toHaveLength(0);
    });

    it("returns no findings when proxyType is null", () => {
      const snapshot = baseSnapshot({ proxyType: null });
      expect(detectGov005(snapshot)).toHaveLength(0);
    });
  });

  describe("Rule 1: EOA admin (CRITICAL)", () => {
    it("fires CRITICAL when EIP_1967_TRANSPARENT proxy has EOA admin", () => {
      const snapshot = withProxy(baseSnapshot(), {
        proxyAdminIsContract: false,
      });

      const findings = detectGov005(snapshot);
      const eoa = findings.find((f) =>
        f.title.includes("externally owned account"),
      );

      expect(eoa).toBeDefined();
      expect(eoa?.severity).toBe("CRITICAL");
      expect(eoa?.evidence.proxyAdminIsContract).toBe(false);
    });

    it("does not fire when admin is a contract", () => {
      const snapshot = withProxy(baseSnapshot(), {
        proxyAdminIsContract: true,
      });

      const eoa = detectGov005(snapshot).find((f) =>
        f.title.includes("externally owned account"),
      );
      expect(eoa).toBeUndefined();
    });

    it("does not fire when admin contract status is null (fail-closed on indeterminate)", () => {
      const snapshot = withProxy(baseSnapshot(), {
        proxyAdminIsContract: null,
      });

      const eoa = detectGov005(snapshot).find((f) =>
        f.title.includes("externally owned account"),
      );
      expect(eoa).toBeUndefined();
    });

    it("does not fire when proxyAdminAddress is null", () => {
      const snapshot = withProxy(baseSnapshot(), {
        proxyAdminAddress: null,
        proxyAdminIsContract: null,
      });

      const eoa = detectGov005(snapshot).find((f) =>
        f.title.includes("externally owned account"),
      );
      expect(eoa).toBeUndefined();
    });
  });

  describe("Rule 2: CUSTOM proxy type (MEDIUM)", () => {
    it("fires MEDIUM on CUSTOM proxy type (audius-like fixture)", () => {
      const findings = detectGov005(audiusLikeFixture);
      const custom = findings.find((f) => f.publicTitle.includes("non-standard"));

      expect(custom).toBeDefined();
      expect(custom?.severity).toBe("MEDIUM");
      expect(custom?.evidence.proxyType).toBe("CUSTOM");
    });

    it("does not fire on EIP_1967_TRANSPARENT", () => {
      const snapshot = withProxy(baseSnapshot());

      const custom = detectGov005(snapshot).find((f) =>
        f.publicTitle.includes("non-standard"),
      );
      expect(custom).toBeUndefined();
    });

    it("does not fire on EIP_1822_UUPS (reserved for Plan 03+ positive UUPS evidence)", () => {
      const snapshot = withProxy(baseSnapshot(), {
        proxyType: "EIP_1822_UUPS",
      });

      const custom = detectGov005(snapshot).find((f) =>
        f.publicTitle.includes("non-standard"),
      );
      expect(custom).toBeUndefined();
    });
  });

  describe("Combined scenarios", () => {
    it("returns no findings for cleanUniswapV3Fixture (EIP_1967 + contract admin)", () => {
      expect(detectGov005(cleanUniswapV3Fixture)).toHaveLength(0);
    });

    it("fires both Rule 1 and Rule 2 when CUSTOM proxy has EOA admin", () => {
      const snapshot = baseSnapshot({
        proxyType: "CUSTOM",
        proxyAdminAddress: "0xeoaAdmin",
        proxyAdminIsContract: false,
        proxyImplementation: "0xImpl",
        proxyVerified: false,
        implementationAbi: null,
      });

      const findings = detectGov005(snapshot);

      expect(findings).toHaveLength(2);
      const severities = findings.map((f) => f.severity);
      expect(severities).toContain("CRITICAL");
      expect(severities).toContain("MEDIUM");
    });

    it("audiusLikeFixture fires only MEDIUM (CUSTOM + indeterminate admin)", () => {
      // audiusLikeFixture has proxyAdminAddress: null AND
      // proxyAdminIsContract: null, so Rule 1 cannot fire. Only Rule 2
      // (CUSTOM) fires.
      const findings = detectGov005(audiusLikeFixture);
      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("MEDIUM");
    });
  });

  describe("Output structure", () => {
    it("Rule 1 (CRITICAL EOA admin) populates the full GovernanceFindingInput shape with publicRank: 1 (E.7 I3)", () => {
      const snapshot = withProxy(baseSnapshot(), {
        proxyAdminIsContract: false,
      });

      // Only Rule 1 fires here (proxyType is EIP_1967_TRANSPARENT,
      // not CUSTOM, so Rule 2 stays quiet).
      const findings = detectGov005(snapshot);
      expect(findings).toHaveLength(1);
      const finding = findings[0]!;

      expect(finding.detectorId).toBe("GOV-005");
      expect(finding.detectorVersion).toBe(1);
      expect(finding.severity).toBe("CRITICAL");
      expect(finding.publicTitle).toBeTruthy();
      expect(finding.title).toBeTruthy();
      expect(finding.description.length).toBeGreaterThan(100);
      expect(finding.evidence.proxyType).toBeTruthy();
      expect(finding.references.length).toBeGreaterThan(1);
      // E.7 I3: CRITICAL severity → publicRank 1 per defaultPublicRank.
      expect(finding.publicRank).toBe(1);
      expect(finding.affectedComponent).toBe("proxy");
    });

    it("Rule 2 (MEDIUM CUSTOM proxy) keeps publicRank: 2 (default for MEDIUM)", () => {
      const snapshot = baseSnapshot({
        proxyType: "CUSTOM",
        proxyAdminAddress: null,
        proxyImplementation: "0xImpl",
        proxyVerified: false,
        proxyAdminIsContract: null,
        implementationAbi: null,
      });

      const findings = detectGov005(snapshot);
      const r2 = findings.find((f) => f.severity === "MEDIUM");
      expect(r2).toBeDefined();
      expect(r2!.publicRank).toBe(2);
    });
  });
});
