// @vitest-environment node
/**
 * Plan 03 Phase H.2 — curated demo metadata audit.
 *
 * This test pins every Aave V3 + Uniswap V3 graph entry against spec
 * §8.1's tables verbatim (lines 792-807 of
 * docs/superpowers/specs/2026-05-19-breakwater-plan-03-design.md).
 * A change to any address, role, or label MUST also update the spec —
 * the test prevents silent drift between the spec table and the seed.
 *
 * Why the assertion shape matches the spec table layout (rather than
 * a flexible "contains these addresses" form): the spec's address +
 * role + label triples ARE the canonical definition. Asserting on
 * each triple individually catches the case where someone adds a
 * new contract or reorders the table without updating the spec.
 */

import { describe, expect, it } from "vitest";
import { ContractRole } from "@prisma/client";

import {
  CURATED_DEMO_GRAPHS,
  SINGLE_CONTRACT_DEMOS,
} from "../curated-demos";

describe("CURATED_DEMO_GRAPHS — Aave V3 (spec §8.1 lines 792-799)", () => {
  const aave = CURATED_DEMO_GRAPHS["aave-v3-ethereum"];

  it("exists with slug aave-v3-ethereum and chain ETHEREUM", () => {
    expect(aave).toBeDefined();
    expect(aave!.slug).toBe("aave-v3-ethereum");
    expect(aave!.chain).toBe("ETHEREUM");
  });

  it("PRIMARY = 0x87870Bca…/Aave V3 Pool (lowercased for Plan 02 storage convention)", () => {
    // Spec §8.1 line 796 — PRIMARY row.
    expect(aave!.primaryContractAddress).toBe(
      "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
    );
    expect(aave!.primaryLabel).toBe("Aave V3 Pool");
  });

  it("relatedContracts has 3 entries — PROXY_IMPLEMENTATION + TIMELOCK + DECLARED_MULTISIG", () => {
    expect(aave!.relatedContracts).toHaveLength(3);
  });

  it("PROXY_IMPLEMENTATION = 0xacFe…/Pool Implementation V3.x (spec line 797)", () => {
    const impl = aave!.relatedContracts.find(
      (c) => c.role === ContractRole.PROXY_IMPLEMENTATION,
    );
    expect(impl).toBeDefined();
    expect(impl!.address).toBe("0xacFe4511CE883C14c4eA40563F176C3C09b4c47C");
    expect(impl!.label).toBe("Pool Implementation V3.x");
  });

  it("TIMELOCK = 0xEE56…/Short Executor (spec line 798)", () => {
    const tl = aave!.relatedContracts.find(
      (c) => c.role === ContractRole.TIMELOCK,
    );
    expect(tl).toBeDefined();
    expect(tl!.address).toBe("0xEE56e2B3D491590B5b31738cC34d5232F378a8D5");
    expect(tl!.label).toBe("Short Executor (governance timelock)");
  });

  it("DECLARED_MULTISIG = 0xEC56…/Aave Guardian (3-of-5) (spec line 799)", () => {
    const ms = aave!.relatedContracts.find(
      (c) => c.role === ContractRole.DECLARED_MULTISIG,
    );
    expect(ms).toBeDefined();
    expect(ms!.address).toBe("0xEC568fffba86c094cf06b22134B23074DFE2252c");
    expect(ms!.label).toBe("Aave Guardian (3-of-5)");
  });

  it("expectedRiskProfile = A (Aave's calibration target)", () => {
    expect(aave!.expectedRiskProfile).toBe("A");
  });
});

describe("CURATED_DEMO_GRAPHS — Uniswap V3 (spec §8.1 lines 801-807)", () => {
  const uni = CURATED_DEMO_GRAPHS["uniswap-v3-ethereum"];

  it("exists with slug uniswap-v3-ethereum and chain ETHEREUM", () => {
    expect(uni).toBeDefined();
    expect(uni!.slug).toBe("uniswap-v3-ethereum");
    expect(uni!.chain).toBe("ETHEREUM");
  });

  it("PRIMARY = 0xE592…/Uniswap V3 SwapRouter (spec line 805 — reassigned from Plan 02 Factory)", () => {
    // Spec §8.1 reassigns PRIMARY from the Plan 02 Factory address
    // (0x1f98...) to the SwapRouter. The Factory is preserved as a
    // RELATED entry below.
    expect(uni!.primaryContractAddress).toBe(
      "0xe592427a0aece92de3edee1f18e0157c05861564",
    );
    expect(uni!.primaryLabel).toBe("Uniswap V3 SwapRouter");
  });

  it("relatedContracts has 2 entries — both RELATED", () => {
    expect(uni!.relatedContracts).toHaveLength(2);
    for (const c of uni!.relatedContracts) {
      expect(c.role).toBe(ContractRole.RELATED);
    }
  });

  it("RELATED #1 = 0x1F98…/UniswapV3Factory (spec line 806)", () => {
    const factory = uni!.relatedContracts.find(
      (c) => c.label === "UniswapV3Factory",
    );
    expect(factory).toBeDefined();
    expect(factory!.address).toBe(
      "0x1F98431c8aD98523631AE4a59f267346ea31F984",
    );
  });

  it("RELATED #2 = 0x000…/Permit2 (allowance manager) (spec line 807)", () => {
    const permit2 = uni!.relatedContracts.find(
      (c) => c.label === "Permit2 (allowance manager)",
    );
    expect(permit2).toBeDefined();
    expect(permit2!.address).toBe(
      "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    );
  });

  it("expectedRiskProfile = B (Uniswap V3's calibration target)", () => {
    expect(uni!.expectedRiskProfile).toBe("B");
  });
});

describe("SINGLE_CONTRACT_DEMOS — Drift (Plan 01 baseline carry-over)", () => {
  it("Drift is preserved with its case-sensitive Solana program id", () => {
    const drift = SINGLE_CONTRACT_DEMOS.find((d) => d.slug === "drift-solana");
    expect(drift).toBeDefined();
    expect(drift!.chain).toBe("SOLANA");
    // Solana program ids are case-sensitive — must NOT be lowercased.
    expect(drift!.primaryContractAddress).toBe(
      "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    );
    expect(drift!.expectedRiskProfile).toBe("F");
  });
});

describe("CURATED_DEMO_GRAPHS — invariants", () => {
  it("every multi-Contract demo has at least one related contract (otherwise it should be a single-Contract demo)", () => {
    for (const demo of Object.values(CURATED_DEMO_GRAPHS)) {
      expect(demo.relatedContracts.length).toBeGreaterThan(0);
    }
  });

  it("no related contract duplicates the demo's PRIMARY address (case-insensitive)", () => {
    for (const demo of Object.values(CURATED_DEMO_GRAPHS)) {
      const primary = demo.primaryContractAddress.toLowerCase();
      for (const rc of demo.relatedContracts) {
        expect(rc.address.toLowerCase()).not.toBe(primary);
      }
    }
  });

  it("related-contract addresses are unique within each demo (case-insensitive)", () => {
    for (const demo of Object.values(CURATED_DEMO_GRAPHS)) {
      const addrs = demo.relatedContracts.map((c) => c.address.toLowerCase());
      expect(new Set(addrs).size).toBe(addrs.length);
    }
  });
});
