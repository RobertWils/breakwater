-- Plan 05 Fase 1.1 — auto-discovery DB foundations (PURELY ADDITIVE).
--
-- This migration only ADDS: five enums, three nullable-or-defaulted columns
-- on "Contract", and two new tables ("ContractEdge", "DiscoveredContractCache").
-- It changes NO existing column, constraint, or index, so it cannot alter any
-- current scan / scoring / UI behaviour — nothing reads these new
-- fields/tables yet (the discovery pipeline lands in later scopes).
--
-- EXISTING-ROW BACKFILL (columns): "Contract"."discoverySource" and
-- "roleSource" are added NOT NULL DEFAULT 'MANUAL', so every pre-existing
-- Contract row is backfilled to MANUAL by the column default. In Postgres
-- 11+ adding a NOT NULL column with a constant default is a metadata-only
-- change (no table rewrite), safe against a large existing table.
--
-- SYNTHETIC-STAR EDGE BACKFILL (data) IS NOT INLINED HERE. The one edge-
-- creation in Fase 1 (a synthetic-star ContractEdge primary->sibling for
-- every existing non-primary Contract) is a SEPARATE, idempotent, dry-
-- runnable data script — `scripts/backfill-synthetic-star-edges.ts`
-- (`pnpm db:backfill-synthetic-star-edges`). This mirrors the Plan 03
-- schema-only-migration / data-only-backfill split (see
-- 20260603120000_plan_03_tighten_contract_id_constraints) and keeps the
-- prod data mutation under a manual, re-runnable command rather than
-- firing automatically on `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "EdgeKind" AS ENUM ('DEPENDS_ON');

-- CreateEnum
CREATE TYPE "EdgeConfidence" AS ENUM ('STRUCTURAL', 'STRUCTURAL_UNVERIFIED', 'CANDIDATE');

-- CreateEnum
CREATE TYPE "EdgeStatus" AS ENUM ('ACTIVE', 'STALE', 'REMOVED');

-- CreateEnum
CREATE TYPE "DiscoverySource" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "RoleSource" AS ENUM ('MANUAL', 'AUTO');

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "discoveredAs" JSONB,
ADD COLUMN     "discoverySource" "DiscoverySource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "roleSource" "RoleSource" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "ContractEdge" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "fromContractId" TEXT NOT NULL,
    "toContractId" TEXT NOT NULL,
    "edgeKind" "EdgeKind" NOT NULL DEFAULT 'DEPENDS_ON',
    "confidence" "EdgeConfidence" NOT NULL,
    "provenance" JSONB NOT NULL,
    "observedActive" BOOLEAN NOT NULL DEFAULT false,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastConfirmedAt" TIMESTAMP(3),
    "status" "EdgeStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "ContractEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredContractCache" (
    "id" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "address" TEXT NOT NULL,
    "bytecodeHash" TEXT,
    "verified" BOOLEAN,
    "abi" TEXT,
    "roleDetection" JSONB,
    "allowlisted" BOOLEAN,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredContractCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractEdge_protocolId_idx" ON "ContractEdge"("protocolId");

-- CreateIndex
CREATE INDEX "ContractEdge_toContractId_idx" ON "ContractEdge"("toContractId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractEdge_fromContractId_toContractId_edgeKind_key" ON "ContractEdge"("fromContractId", "toContractId", "edgeKind");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredContractCache_chain_address_key" ON "DiscoveredContractCache"("chain", "address");

-- AddForeignKey
ALTER TABLE "ContractEdge" ADD CONSTRAINT "ContractEdge_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractEdge" ADD CONSTRAINT "ContractEdge_fromContractId_fkey" FOREIGN KEY ("fromContractId") REFERENCES "Contract"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ContractEdge" ADD CONSTRAINT "ContractEdge_toContractId_fkey" FOREIGN KEY ("toContractId") REFERENCES "Contract"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

