import { Chain, ContractRole, Grade } from "@prisma/client";

/**
 * Plan 03 Phase H.2 / H.3 — curated multi-Contract demo metadata
 * (spec §8.1 addresses VERBATIM).
 *
 * SPEC §8.1 RESOLUTION (drift note):
 * The spec gives the exact address + role + label tuples for each
 * curated demo. It does NOT prescribe whether the seed file creates
 * the demo Scan + Contract rows itself (static seed) or whether the
 * seed only records the canonical graph metadata and a separate
 * deploy-time step runs real detectors to populate findings (live-
 * runnable). This module takes the live-runnable path per the
 * dispatch brief's "create the seed structure + document the
 * populate command; don't fake snapshot/finding data" guidance.
 *
 * Concretely:
 *   - `prisma/seed.ts` upserts Protocol rows using `primaryContractAddress`
 *     from this module and records the related-contracts list on
 *     each row (for the §8.1 demo graph).
 *   - The actual demo Scan + Contract + ModuleRun + Finding +
 *     GovernanceSnapshot rows are NOT created by the seed — they're
 *     populated at Phase I deploy time by invoking `submitScan` (or
 *     a dedicated `scripts/populate-curated-demos.ts` follow-up)
 *     against a real RPC + Etherscan + Safe Transaction Service
 *     pair, with `relatedContracts` sourced from this module's
 *     `CURATED_DEMO_GRAPHS`.
 *
 * Address provenance: every entry below is copied verbatim from
 * spec §8.1's tables (the spec is at
 * docs/superpowers/specs/2026-05-19-breakwater-plan-03-design.md
 * lines 792-808). Do not modify these without updating the spec
 * first — Codex review #5 / Phase G remediation precedent applies.
 */

export interface CuratedRelatedContract {
  address: string;
  role: ContractRole;
  label: string;
}

export interface CuratedDemo {
  slug: string;
  displayName: string;
  chain: Chain;
  domain: string;
  /**
   * The protocol's "headline" contract. Plan 02 stored this on
   * `Protocol.primaryContractAddress`; Plan 03 elevates it to a
   * Contract row with role PRIMARY at populate time. Lowercased per
   * the Plan 02 storage convention.
   */
  primaryContractAddress: string;
  primaryLabel: string;
  /**
   * The grade Breakwater expects this protocol to receive when the
   * curated graph is scanned end-to-end. Used as a calibration
   * target — surfaces if a future detector regression drifts the
   * graded outcome.
   */
  expectedRiskProfile: Grade;
  /**
   * Spec §8.1 related-contracts graph. Excludes the PRIMARY row
   * (that's `primaryContractAddress` above). Populated at Phase I
   * deploy time as Contract rows with role + label set verbatim.
   * Addresses preserve the spec's casing for screen-reader address
   * pronunciation; submitScan normalises to lowercase for storage.
   */
  relatedContracts: CuratedRelatedContract[];
}

/**
 * Curated demo graphs per spec §8.1. Keyed by slug for reliable
 * lookup from `submitScan` / populate scripts.
 *
 * NOTE: `extraContractAddresses` on Protocol is deprecated as of
 * Plan 03 §3.4 — `relatedContracts` is the new shape. Don't pipe
 * these addresses through the deprecated column.
 */
export const CURATED_DEMO_GRAPHS: Record<string, CuratedDemo> = {
  // Spec §8.1 Aave V3 table (lines 792-799). 4 contracts total:
  // PRIMARY + 1 PROXY_IMPLEMENTATION + 1 TIMELOCK + 1 DECLARED_MULTISIG.
  "aave-v3-ethereum": {
    slug: "aave-v3-ethereum",
    displayName: "Aave V3",
    chain: Chain.ETHEREUM,
    domain: "aave.com",
    primaryContractAddress: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
    primaryLabel: "Aave V3 Pool",
    expectedRiskProfile: Grade.A,
    relatedContracts: [
      {
        address: "0xacFe4511CE883C14c4eA40563F176C3C09b4c47C",
        role: ContractRole.PROXY_IMPLEMENTATION,
        label: "Pool Implementation V3.x",
      },
      {
        address: "0xEE56e2B3D491590B5b31738cC34d5232F378a8D5",
        role: ContractRole.TIMELOCK,
        label: "Short Executor (governance timelock)",
      },
      {
        address: "0xEC568fffba86c094cf06b22134B23074DFE2252c",
        role: ContractRole.DECLARED_MULTISIG,
        label: "Aave Guardian (3-of-5)",
      },
    ],
  },

  // Spec §8.1 Uniswap V3 table (lines 801-807). 3 contracts total:
  // PRIMARY + 2 RELATED.
  //
  // Note: Plan 02 baseline seeded `primaryContractAddress` =
  // 0x1f98431c8ad98523631ae4a59f267346ea31f984 (UniswapV3Factory).
  // Spec §8.1 reassigns PRIMARY to the SwapRouter
  // (0xE592...) and demotes the Factory to a RELATED entry. The
  // Plan 02 baseline address is preserved as a RELATED contract per
  // §8.1, so any historical Plan 02 demo scans that ran against the
  // old factory address won't suddenly point at an unknown contract
  // — they're now part of the multi-Contract graph as RELATED.
  "uniswap-v3-ethereum": {
    slug: "uniswap-v3-ethereum",
    displayName: "Uniswap V3",
    chain: Chain.ETHEREUM,
    domain: "uniswap.org",
    primaryContractAddress: "0xe592427a0aece92de3edee1f18e0157c05861564",
    primaryLabel: "Uniswap V3 SwapRouter",
    expectedRiskProfile: Grade.B,
    relatedContracts: [
      {
        address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
        role: ContractRole.RELATED,
        label: "UniswapV3Factory",
      },
      {
        address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        role: ContractRole.RELATED,
        label: "Permit2 (allowance manager)",
      },
    ],
  },
};

/**
 * Plan 01 baseline demo retained verbatim — Drift is single-Contract
 * by design (Solana program; the related-contract graph concept maps
 * differently). Listed here so seed.ts has one canonical source for
 * every curated demo, multi-Contract or not.
 */
export const SINGLE_CONTRACT_DEMOS: Pick<
  CuratedDemo,
  "slug" | "displayName" | "chain" | "domain" | "primaryContractAddress" | "expectedRiskProfile"
>[] = [
  {
    slug: "drift-solana",
    displayName: "Drift",
    chain: Chain.SOLANA,
    // Program ID — preserve case (Solana is case-sensitive in the
    // address-derivation layer, unlike EVM).
    primaryContractAddress: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    domain: "drift.trade",
    expectedRiskProfile: Grade.F,
  },
];
