-- Plan 03 PR 1 additive migration.
-- Source of truth: spec §3.5 PR 1 section.
--
-- Manually crafted (not produced verbatim by `prisma migrate dev`) because
-- Prisma's auto-generation produces two divergences vs spec §3.5:
--   1. The `Scan.compositeScore -> averageContractScore` rename comes out
--      as DROP COLUMN + ADD COLUMN (data loss). Spec requires RENAME COLUMN.
--   2. New FKs to Contract pick up `ON DELETE SET NULL ON UPDATE CASCADE`
--      and the Contract->Scan FK picks up `ON UPDATE CASCADE`. Spec §3.5
--      specifies neither — child FKs are plain REFERENCES (Postgres
--      default ON DELETE NO ACTION), and the Contract->Scan FK is
--      ON DELETE CASCADE only.
--
-- All operations are additive or rename-only. No data loss. Plan 02 schema
-- is a near-strict subset of the post-migration schema (modulo the rename).

-- CreateEnum
CREATE TYPE "ContractRole" AS ENUM (
  'PRIMARY',
  'PROXY_IMPLEMENTATION',
  'DECLARED_MULTISIG',
  'DECLARED_BRIDGE',
  'TOKEN_CONTRACT',
  'TIMELOCK',
  'RELATED'
);

-- Scan column rename + new graph-aware composite columns + new partial-coverage flag.
-- Uses RENAME COLUMN (data-preserving) rather than Prisma's default DROP+ADD.
ALTER TABLE "Scan" RENAME COLUMN "compositeScore" TO "averageContractScore";
ALTER TABLE "Scan" ADD COLUMN "worstContractScore" INTEGER;
ALTER TABLE "Scan" ADD COLUMN "isPartialCoverage" BOOLEAN NOT NULL DEFAULT false;

-- GovernanceSnapshot: relax scanId to nullable + drop its @unique. New
-- contractId column lands nullable (no @unique yet — that's PR 2).
-- Note: spec §3.5 phrases this as `DROP CONSTRAINT
-- "GovernanceSnapshot_scanId_key"`. Plan 02's migration created the
-- @unique as a `CREATE UNIQUE INDEX` (Prisma's idiom for single-field
-- @unique), so the symmetric drop is `DROP INDEX`. Functionally identical
-- in Postgres for index-backed uniqueness.
ALTER TABLE "GovernanceSnapshot" ALTER COLUMN "scanId" DROP NOT NULL;
DROP INDEX "GovernanceSnapshot_scanId_key";
ALTER TABLE "GovernanceSnapshot" ADD COLUMN "contractId" TEXT;

-- ModuleRun + Finding: additive nullable contractId. PR 2 tightens
-- ModuleRun's contractId to NOT NULL and swaps the @@unique to include it.
ALTER TABLE "ModuleRun" ADD COLUMN "contractId" TEXT;
ALTER TABLE "Finding" ADD COLUMN "contractId" TEXT;

-- New Contract table per spec §3.1.
CREATE TABLE "Contract" (
  "id"              TEXT NOT NULL,
  "scanId"          TEXT NOT NULL,
  "address"         TEXT NOT NULL,
  "chain"           "Chain" NOT NULL,
  "role"            "ContractRole" NOT NULL,
  "label"           TEXT,
  "crossChainTwins" JSONB NOT NULL DEFAULT '[]',
  "isPrimary"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "compositeScore"  INTEGER,
  "compositeGrade"  "Grade",
  "isPartialGrade"  BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contract_scanId_address_key" ON "Contract"("scanId", "address");
CREATE INDEX "Contract_scanId_idx" ON "Contract"("scanId");

-- Foreign keys. Spec §3.5 specifies only `ON DELETE CASCADE` on
-- Contract.scanId. Child-table contractId FKs are plain REFERENCES
-- (Postgres default = NO ACTION on delete/update). No ON UPDATE clauses
-- are needed because cuid PKs are immutable; ON UPDATE CASCADE would
-- be a no-op but the spec keeps the SQL minimal.
ALTER TABLE "Contract"
  ADD CONSTRAINT "Contract_scanId_fkey"
  FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE;

ALTER TABLE "ModuleRun"
  ADD CONSTRAINT "ModuleRun_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id");

ALTER TABLE "Finding"
  ADD CONSTRAINT "Finding_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id");

ALTER TABLE "GovernanceSnapshot"
  ADD CONSTRAINT "GovernanceSnapshot_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id");
