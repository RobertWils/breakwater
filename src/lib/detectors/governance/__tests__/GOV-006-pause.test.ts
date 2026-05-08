// @vitest-environment node
import { describe, expect, it } from "vitest";

import { detectGov006 } from "../GOV-006-pause";

import {
  audiusLikeFixture,
  baseSnapshot,
  cleanUniswapV3Fixture,
  withProxy,
} from "./fixtures";

const abiWithPause = JSON.stringify([
  {
    type: "function",
    name: "transfer",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "pause",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unpause",
    inputs: [],
    stateMutability: "nonpayable",
  },
]);

const abiWithEmergencyStop = JSON.stringify([
  { type: "function", name: "normalFn", inputs: [], stateMutability: "view" },
  {
    type: "function",
    name: "emergencyStop",
    inputs: [],
    stateMutability: "nonpayable",
  },
]);

const abiWithoutPause = JSON.stringify([
  {
    type: "function",
    name: "transfer",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    stateMutability: "view",
  },
]);

describe("GOV-006 detectGov006 (Plan 02 E.6)", () => {
  describe("No proxy present", () => {
    it("returns no findings when proxyType is NONE", () => {
      expect(detectGov006(baseSnapshot())).toHaveLength(0);
    });

    it("returns no findings when proxyType is null", () => {
      expect(detectGov006(baseSnapshot({ proxyType: null }))).toHaveLength(0);
    });
  });

  describe("ABI unavailable (graceful skip)", () => {
    it("returns no findings when implementationAbi is null", () => {
      const snapshot = withProxy(baseSnapshot(), { implementationAbi: null });
      expect(detectGov006(snapshot)).toHaveLength(0);
    });

    it("returns no findings when implementationAbi is empty string", () => {
      const snapshot = withProxy(baseSnapshot(), { implementationAbi: "" });
      expect(detectGov006(snapshot)).toHaveLength(0);
    });
  });

  describe("Pause mechanism present (quiet)", () => {
    it("quiet when ABI has pause()", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: abiWithPause,
      });
      expect(detectGov006(snapshot)).toHaveLength(0);
    });

    it("quiet when ABI has emergencyStop()", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: abiWithEmergencyStop,
      });
      expect(detectGov006(snapshot)).toHaveLength(0);
    });

    it("quiet when only paused() (getter) is present — implies Pausable inheritance", () => {
      const abi = JSON.stringify([
        { type: "function", name: "transfer", inputs: [] },
        {
          type: "function",
          name: "paused",
          inputs: [],
          stateMutability: "view",
        },
      ]);
      const snapshot = withProxy(baseSnapshot(), { implementationAbi: abi });
      expect(detectGov006(snapshot)).toHaveLength(0);
    });
  });

  describe("Pause pattern coverage", () => {
    const cases: Array<{ name: string; shouldQuiet: boolean; note: string }> =
      [
        { name: "pause", shouldQuiet: true, note: "OZ canonical" },
        { name: "unpause", shouldQuiet: true, note: "OZ canonical" },
        { name: "paused", shouldQuiet: true, note: "OZ getter" },
        { name: "_pause", shouldQuiet: true, note: "OZ internal" },
        { name: "pauseAll", shouldQuiet: true, note: "case-insensitive" },
        { name: "emergencyStop", shouldQuiet: true, note: "Yearn pattern" },
        { name: "EmergencyStop", shouldQuiet: true, note: "case-insensitive" },
        { name: "emergencyPause", shouldQuiet: true, note: "common variant" },
        { name: "circuitBreaker", shouldQuiet: true, note: "MakerDAO style" },
        {
          name: "CircuitBreaker",
          shouldQuiet: true,
          note: "case-insensitive",
        },
        { name: "kill", shouldQuiet: true, note: "killable contracts" },
        { name: "shutdown", shouldQuiet: true, note: "Aave style" },
        { name: "Shutdown", shouldQuiet: true, note: "case-insensitive" },
        { name: "transfer", shouldQuiet: false, note: "ordinary ERC20" },
        {
          name: "pauseToken",
          shouldQuiet: false,
          note: "anchored regex — pause-prefix without exact match",
        },
        {
          name: "killSwitch",
          shouldQuiet: false,
          note: "anchored regex — kill-prefix without exact match",
        },
      ];

    for (const { name, shouldQuiet, note } of cases) {
      it(`${shouldQuiet ? "quiet" : "fires MEDIUM"} for "${name}" (${note})`, () => {
        const abi = JSON.stringify([
          { type: "function", name, inputs: [] },
          { type: "function", name: "transfer", inputs: [] },
        ]);
        const snapshot = withProxy(baseSnapshot(), {
          implementationAbi: abi,
        });

        const findings = detectGov006(snapshot);

        if (shouldQuiet) {
          expect(findings).toHaveLength(0);
        } else {
          expect(findings).toHaveLength(1);
          expect(findings[0]!.severity).toBe("MEDIUM");
        }
      });
    }
  });

  describe("Pause mechanism absent (fires MEDIUM)", () => {
    it("fires MEDIUM when proxy ABI lacks all pause patterns", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: abiWithoutPause,
      });

      const findings = detectGov006(snapshot);

      expect(findings).toHaveLength(1);
      expect(findings[0]!.severity).toBe("MEDIUM");
      expect(findings[0]!.publicRank).toBe(3);
      expect(findings[0]!.evidence.pausePatternMatched).toBe(false);
    });

    it("fires MEDIUM on CUSTOM proxy without pause", () => {
      const snapshot = baseSnapshot({
        proxyType: "CUSTOM",
        proxyAdminAddress: null,
        proxyImplementation: "0xImpl",
        proxyVerified: true,
        proxyAdminIsContract: null,
        implementationAbi: abiWithoutPause,
      });

      const findings = detectGov006(snapshot);

      expect(findings).toHaveLength(1);
      expect(findings[0]!.evidence.proxyType).toBe("CUSTOM");
    });
  });

  describe("Edge cases", () => {
    it("handles malformed JSON gracefully (no throw, no findings)", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: "{not valid json",
      });
      expect(detectGov006(snapshot)).toHaveLength(0);
    });

    it("handles non-array ABI gracefully (no throw, no findings)", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: '{"some": "object"}',
      });
      expect(detectGov006(snapshot)).toHaveLength(0);
    });

    it("returns no findings when ABI parses to empty function array (E.7 I1 — info-absent, not proof-of-absence)", () => {
      const snapshot = withProxy(baseSnapshot(), { implementationAbi: "[]" });
      expect(detectGov006(snapshot)).toHaveLength(0);
    });

    it("returns no findings when ABI has only events/errors (filters to empty function set, E.7 I1)", () => {
      // After filtering events/errors, the function array is empty —
      // we have no positive evidence that pause is missing. Skip
      // rather than fire a false-positive MEDIUM.
      const abi = JSON.stringify([
        { type: "event", name: "pause", inputs: [] },
        { type: "error", name: "Paused", inputs: [] },
      ]);
      const snapshot = withProxy(baseSnapshot(), { implementationAbi: abi });

      expect(detectGov006(snapshot)).toHaveLength(0);
    });
  });

  describe("Combined scenarios (named fixtures)", () => {
    it("cleanUniswapV3Fixture stays quiet (E.7 I2 — pause-capable ABI)", () => {
      // After E.7 I2, withProxy default implementationAbi includes
      // pause/unpause/paused (OZ Pausable canonical). GOV-006 finds
      // those patterns and stays quiet — the clean baseline is now
      // truly clean across all 6 detectors.
      expect(detectGov006(cleanUniswapV3Fixture)).toHaveLength(0);
    });

    it("audiusLikeFixture: implementationAbi is null → quiet skip", () => {
      // audiusLikeFixture explicitly carries implementationAbi: null
      // (Etherscan didn't have an ABI for the non-standard impl).
      // GOV-006 graceful-skips rather than firing on absent data.
      expect(detectGov006(audiusLikeFixture)).toHaveLength(0);
    });
  });

  describe("Output structure", () => {
    it("every finding populates the full GovernanceFindingInput shape", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: abiWithoutPause,
      });

      const findings = detectGov006(snapshot);

      findings.forEach((finding) => {
        expect(finding.detectorId).toBe("GOV-006");
        expect(finding.detectorVersion).toBe(1);
        expect(finding.severity).toBe("MEDIUM");
        expect(finding.publicTitle).toBeTruthy();
        expect(finding.title).toBeTruthy();
        expect(finding.description).toContain("pause");
        expect(finding.evidence.abiFunctionCount).toBeGreaterThan(0);
        expect(finding.references.length).toBeGreaterThan(2);
        expect(finding.publicRank).toBe(3);
        expect(finding.affectedComponent).toBe("proxy");
      });
    });
  });
});
