import { PrismaClient, OwnershipStatus } from "@prisma/client";

import {
  CURATED_DEMO_GRAPHS,
  SINGLE_CONTRACT_DEMOS,
} from "./curated-demos";

const prisma = new PrismaClient();

// Production detection across deployment platforms.
// - NODE_ENV: standard Node.js convention
// - VERCEL_ENV: Vercel's environment indicator (production | preview | development)
// - RAILWAY_ENVIRONMENT_NAME: Railway's environment name per official docs
//   https://docs.railway.com/variables/reference (note: NOT RAILWAY_ENVIRONMENT,
//   which is a common mistake — that variable does not exist)
function assertNotProduction() {
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.RAILWAY_ENVIRONMENT_NAME === "production";

  if (!isProduction) return;

  if (process.env.FORCE_SEED === "1") {
    console.warn("FORCE_SEED=1 set — proceeding with production seed.");
    return;
  }

  console.error(
    "Seed blocked: NODE_ENV/VERCEL_ENV/RAILWAY_ENVIRONMENT_NAME indicates production.\n" +
      "Seeding is dev/preview only. For production metadata changes, write an explicit migration.\n" +
      "Override with FORCE_SEED=1 if this is intentional.",
  );
  process.exit(1);
}

/**
 * Plan 03 Phase H.2 / H.3 — seed Protocol rows for the curated demos.
 *
 * Multi-Contract demo graphs (Aave V3, Uniswap V3) live in
 * `./curated-demos.ts` and follow spec §8.1 verbatim. This seed file
 * upserts Protocol rows with the canonical primary address + display
 * metadata; it does NOT create Scan / Contract / ModuleRun / Finding /
 * GovernanceSnapshot rows for the curated demo graphs because those
 * require real RPC + detector output to populate honestly.
 *
 * The actual multi-Contract demo Scans are populated at Phase I deploy
 * time by a follow-up step (manual `submitScan` invocation or
 * `scripts/populate-curated-demos.ts`) that consumes
 * `CURATED_DEMO_GRAPHS` from `./curated-demos.ts` and runs real
 * detectors. That separation keeps fabrication out of the seed while
 * preserving spec §8.2's "each curated demo has exactly one published
 * demo scan with N Contract rows" invariant once Phase I runs.
 */
async function main() {
  assertNotProduction();

  // Plan 03 multi-Contract demos — Protocol row only; the curated
  // graph rides in `CURATED_DEMO_GRAPHS` for Phase I population.
  const multiContractSeeds = Object.values(CURATED_DEMO_GRAPHS);

  // Single-Contract demos (Plan 01 baseline preserved verbatim).
  const singleContractSeeds = SINGLE_CONTRACT_DEMOS;

  let upserted = 0;

  for (const s of multiContractSeeds) {
    await prisma.protocol.upsert({
      where: {
        chain_primaryContractAddress: {
          chain: s.chain,
          primaryContractAddress: s.primaryContractAddress,
        },
      },
      update: {
        displayName: s.displayName,
        domain: s.domain,
        expectedRiskProfile: s.expectedRiskProfile,
        ownershipStatus: OwnershipStatus.CURATED,
        organizationId: "system-breakwater",
        slug: s.slug,
      },
      create: {
        slug: s.slug,
        displayName: s.displayName,
        chain: s.chain,
        primaryContractAddress: s.primaryContractAddress,
        // Plan 03 §3.4 — `Protocol.extraContractAddresses` is
        // deprecated. The structured `relatedContracts` graph lives
        // in `CURATED_DEMO_GRAPHS` and is consumed by Phase I's
        // populate step; this column stays `[]` going forward.
        extraContractAddresses: [],
        domain: s.domain,
        ownershipStatus: OwnershipStatus.CURATED,
        organizationId: "system-breakwater",
        expectedRiskProfile: s.expectedRiskProfile,
      },
    });
    upserted += 1;
  }

  for (const s of singleContractSeeds) {
    await prisma.protocol.upsert({
      where: {
        chain_primaryContractAddress: {
          chain: s.chain,
          primaryContractAddress: s.primaryContractAddress,
        },
      },
      update: {
        displayName: s.displayName,
        domain: s.domain,
        expectedRiskProfile: s.expectedRiskProfile,
        ownershipStatus: OwnershipStatus.CURATED,
        organizationId: "system-breakwater",
        slug: s.slug,
      },
      create: {
        slug: s.slug,
        displayName: s.displayName,
        chain: s.chain,
        primaryContractAddress: s.primaryContractAddress,
        extraContractAddresses: [],
        domain: s.domain,
        ownershipStatus: OwnershipStatus.CURATED,
        organizationId: "system-breakwater",
        expectedRiskProfile: s.expectedRiskProfile,
      },
    });
    upserted += 1;
  }

  console.log(
    `Seeded ${upserted} CURATED protocols (${multiContractSeeds.length} multi-Contract + ${singleContractSeeds.length} single-Contract).`,
  );
  console.log(
    "  Multi-Contract demo Scans (Aave V3, Uniswap V3) are populated separately\n" +
      "  at Phase I deploy time — see prisma/curated-demos.ts for the canonical\n" +
      "  relatedContracts graphs and Phase I docs for the populate command.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
