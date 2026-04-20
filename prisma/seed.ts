import { PrismaClient, Chain, OwnershipStatus, Grade } from "@prisma/client";

const prisma = new PrismaClient();

function assertNotProduction() {
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.RAILWAY_ENVIRONMENT === "production";

  if (!isProduction) return;

  if (process.env.FORCE_SEED === "1") {
    console.warn("FORCE_SEED=1 set — proceeding with production seed.");
    return;
  }

  console.error(
    "Seed blocked: NODE_ENV/VERCEL_ENV/RAILWAY_ENVIRONMENT indicates production.\n" +
      "Seeding is dev/preview only. For production metadata changes, write an explicit migration.\n" +
      "Override with FORCE_SEED=1 if this is intentional.",
  );
  process.exit(1);
}

async function main() {
  assertNotProduction();

  const seeds = [
    {
      slug: "aave-v3-ethereum",
      displayName: "Aave V3",
      chain: Chain.ETHEREUM,
      primaryContractAddress: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", // pool address, lowercase
      extraContractAddresses: [],
      domain: "aave.com",
      expectedRiskProfile: Grade.A,
    },
    {
      slug: "uniswap-v3-ethereum",
      displayName: "Uniswap V3",
      chain: Chain.ETHEREUM,
      primaryContractAddress: "0x1f98431c8ad98523631ae4a59f267346ea31f984", // factory, lowercase
      extraContractAddresses: [],
      domain: "uniswap.org",
      expectedRiskProfile: Grade.B,
    },
    {
      slug: "drift-solana",
      displayName: "Drift",
      chain: Chain.SOLANA,
      primaryContractAddress: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH", // program ID, preserve case
      extraContractAddresses: [],
      domain: "drift.trade",
      expectedRiskProfile: Grade.F,
    },
  ];

  for (const s of seeds) {
    await prisma.protocol.upsert({
      where: { chain_primaryContractAddress: { chain: s.chain, primaryContractAddress: s.primaryContractAddress } },
      update: {
        displayName: s.displayName,
        domain: s.domain,
        expectedRiskProfile: s.expectedRiskProfile,
      },
      create: {
        slug: s.slug,
        displayName: s.displayName,
        chain: s.chain,
        primaryContractAddress: s.primaryContractAddress,
        extraContractAddresses: s.extraContractAddresses,
        domain: s.domain,
        ownershipStatus: OwnershipStatus.CURATED,
        organizationId: "system-breakwater",
        expectedRiskProfile: s.expectedRiskProfile,
      },
    });
  }

  console.log(`Seeded ${seeds.length} CURATED protocols.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
