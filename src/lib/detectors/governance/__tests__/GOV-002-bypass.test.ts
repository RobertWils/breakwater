// @vitest-environment node
import { describe, expect, it } from "vitest";

import { detectGov002 } from "../GOV-002-bypass";

import { baseSnapshot, cleanUniswapV3Fixture, withProxy } from "./fixtures";

const cleanProxyAbi = JSON.stringify([
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
]);

const bypassImplAbi = JSON.stringify([
  {
    type: "function",
    name: "transfer",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "emergencyWithdraw",
    inputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "forceUnlock",
    inputs: [],
    stateMutability: "nonpayable",
  },
]);

const protocolAbiWithBypass = JSON.stringify([
  { type: "function", name: "normalFn", inputs: [], stateMutability: "view" },
  {
    type: "function",
    name: "bypassTimelock",
    inputs: [],
    stateMutability: "nonpayable",
  },
]);

describe("GOV-002 detectGov002 (Plan 02 E.2)", () => {
  describe("Proxy contracts (uses implementationAbi)", () => {
    it("returns no findings on a clean implementation ABI", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: cleanProxyAbi,
      });

      expect(detectGov002(snapshot)).toHaveLength(0);
    });

    it("fires CRITICAL on emergency* functions in implementation ABI", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: bypassImplAbi,
      });

      const findings = detectGov002(snapshot);

      const emergency = findings.find(
        (f) => f.evidence.functionName === "emergencyWithdraw",
      );
      expect(emergency).toBeDefined();
      expect(emergency?.severity).toBe("CRITICAL");
      expect(emergency?.evidence.abiSource).toBe("implementation");
    });

    it("fires multiple findings for multiple bypass functions in one ABI", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: bypassImplAbi,
      });

      const findings = detectGov002(snapshot);

      expect(findings).toHaveLength(2);
      const names = findings.map((f) => f.evidence.functionName);
      expect(names).toContain("emergencyWithdraw");
      expect(names).toContain("forceUnlock");
    });
  });

  describe("Non-proxy contracts (uses protocolAbi)", () => {
    it("uses protocolAbi when proxyType is NONE", () => {
      const snapshot = baseSnapshot({
        proxyType: "NONE",
        protocolAbi: protocolAbiWithBypass,
      });

      const findings = detectGov002(snapshot);

      expect(findings).toHaveLength(1);
      expect(findings[0]!.evidence.functionName).toBe("bypassTimelock");
      expect(findings[0]!.evidence.abiSource).toBe("protocol");
    });

    it("returns no findings when protocolAbi is null (graceful skip)", () => {
      const snapshot = baseSnapshot({
        proxyType: "NONE",
        protocolAbi: null,
      });

      expect(detectGov002(snapshot)).toHaveLength(0);
    });
  });

  describe("Bypass pattern coverage", () => {
    const cases: Array<{ name: string; shouldFire: boolean; note: string }> = [
      { name: "emergencyPause", shouldFire: true, note: "emergency*" },
      { name: "emergencyWithdraw", shouldFire: true, note: "emergency*" },
      { name: "forceTransfer", shouldFire: true, note: "force*" },
      { name: "bypassTimelock", shouldFire: true, note: "bypass*" },
      { name: "skipTimelock", shouldFire: true, note: "skipTimelock" },
      { name: "adminExecute", shouldFire: true, note: "adminExecute" },
      { name: "rescueTokens", shouldFire: true, note: "rescue*" },
      // No-fire cases — names superficially similar but don't match the
      // CamelCase-after-prefix anchored regex.
      {
        name: "forge",
        shouldFire: false,
        note: "starts with force-prefix but no capital boundary",
      },
      { name: "transfer", shouldFire: false, note: "ordinary ERC20 method" },
      { name: "balanceOf", shouldFire: false, note: "ordinary ERC20 method" },
    ];

    for (const { name, shouldFire, note } of cases) {
      it(`${shouldFire ? "fires" : "does not fire"} on "${name}" (${note})`, () => {
        const abi = JSON.stringify([
          { type: "function", name, inputs: [], stateMutability: "nonpayable" },
        ]);
        const snapshot = withProxy(baseSnapshot(), {
          implementationAbi: abi,
        });

        const findings = detectGov002(snapshot);

        if (shouldFire) {
          expect(findings).toHaveLength(1);
          expect(findings[0]!.evidence.functionName).toBe(name);
        } else {
          expect(findings).toHaveLength(0);
        }
      });
    }
  });

  describe("Edge cases", () => {
    it("returns no findings when both ABIs are null", () => {
      // baseSnapshot defaults to proxyType:NONE + protocolAbi:null
      expect(detectGov002(baseSnapshot())).toHaveLength(0);
    });

    it("handles malformed JSON gracefully (no throw)", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: "{not valid json",
      });

      expect(detectGov002(snapshot)).toHaveLength(0);
    });

    it("handles non-array ABI (object instead of array) gracefully", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: '{"some": "object"}',
      });

      expect(detectGov002(snapshot)).toHaveLength(0);
    });

    it("skips non-function ABI entries (events, errors)", () => {
      const abi = JSON.stringify([
        { type: "event", name: "emergencyWithdraw", inputs: [] },
        { type: "error", name: "emergencyError", inputs: [] },
        { type: "function", name: "normalFn", inputs: [] },
      ]);
      const snapshot = withProxy(baseSnapshot(), { implementationAbi: abi });

      expect(detectGov002(snapshot)).toHaveLength(0);
    });

    it("does not duplicate findings for overloaded function names", () => {
      const abi = JSON.stringify([
        { type: "function", name: "emergencyWithdraw", inputs: [] },
        {
          type: "function",
          name: "emergencyWithdraw",
          inputs: [{ type: "address" }],
        },
      ]);
      const snapshot = withProxy(baseSnapshot(), { implementationAbi: abi });

      expect(detectGov002(snapshot)).toHaveLength(1);
    });
  });

  describe("Output structure", () => {
    it("clean Uniswap V3 fixture produces no findings", () => {
      // Fixture's implementationAbi is "[]" (empty array).
      expect(detectGov002(cleanUniswapV3Fixture)).toHaveLength(0);
    });

    it("every finding populates the full GovernanceFindingInput shape", () => {
      const snapshot = withProxy(baseSnapshot(), {
        implementationAbi: bypassImplAbi,
      });

      const findings = detectGov002(snapshot);

      findings.forEach((finding) => {
        expect(finding.detectorId).toBe("GOV-002");
        expect(finding.detectorVersion).toBe(1);
        expect(finding.severity).toBe("CRITICAL");
        expect(finding.publicTitle).toBeTruthy();
        expect(finding.title).toContain("matches");
        expect(finding.description).toBeTruthy();
        expect(finding.evidence.functionName).toBeTruthy();
        expect(finding.references.length).toBeGreaterThan(0);
        expect(finding.publicRank).toBe(1);
        expect(finding.affectedComponent).toBe("governance");
      });
    });
  });
});
