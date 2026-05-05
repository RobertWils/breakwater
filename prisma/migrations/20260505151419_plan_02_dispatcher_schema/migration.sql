-- CreateEnum
CREATE TYPE "GovernorType" AS ENUM ('OZ_GOVERNOR', 'COMPOUND_BRAVO', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ProxyType" AS ENUM ('EIP_1967_TRANSPARENT', 'EIP_1822_UUPS', 'CUSTOM', 'NONE');

-- CreateEnum
CREATE TYPE "VotingSnapshotType" AS ENUM ('BLOCK_BASED', 'CURRENT_BALANCE', 'NONE');

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "snapshotBlockNumber" BIGINT;

-- AlterTable
ALTER TABLE "ModuleRun" ADD COLUMN     "inngestEventId" TEXT,
ADD COLUMN     "inngestRunId" TEXT;

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "dispatchedAt" TIMESTAMP(3),
ADD COLUMN     "executionStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GovernanceSnapshot" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hasGovernor" BOOLEAN NOT NULL DEFAULT false,
    "governorAddress" TEXT,
    "governorType" "GovernorType",
    "governorVersion" TEXT,
    "hasTimelock" BOOLEAN NOT NULL DEFAULT false,
    "timelockAddress" TEXT,
    "timelockMinDelay" INTEGER,
    "timelockAdmin" TEXT,
    "hasMultisig" BOOLEAN NOT NULL DEFAULT false,
    "multisigAddress" TEXT,
    "multisigThreshold" INTEGER,
    "multisigOwnerCount" INTEGER,
    "multisigOwners" TEXT[],
    "proxyType" "ProxyType",
    "proxyAdminAddress" TEXT,
    "proxyImplementation" TEXT,
    "proxyVerified" BOOLEAN NOT NULL DEFAULT false,
    "proxyAdminIsContract" BOOLEAN,
    "implementationAbi" TEXT,
    "votingTokenAddress" TEXT,
    "votingSnapshotType" "VotingSnapshotType",
    "rawState" JSONB NOT NULL,

    CONSTRAINT "GovernanceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceSnapshot_scanId_key" ON "GovernanceSnapshot"("scanId");

-- CreateIndex
CREATE INDEX "GovernanceSnapshot_scanId_idx" ON "GovernanceSnapshot"("scanId");

-- AddForeignKey
ALTER TABLE "GovernanceSnapshot" ADD CONSTRAINT "GovernanceSnapshot_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
