-- Plan 03 §3.5 PR 2 — constraint-tightening migration.
--
-- ⚠️  PREREQUISITE — BACKFILL MUST HAVE RUN FIRST.
-- The three `SET NOT NULL` statements below FAIL (correctly, as a guard)
-- if ANY row still has `contractId IS NULL`. Before this migration is
-- applied to a target DB, `scripts/backfill-plan-03-contracts.ts`
-- (`pnpm db:backfill-plan-03-contracts`) MUST have run against that DB
-- and the soak check MUST show zero NULL contractId rows:
--
--   SELECT
--     (SELECT COUNT(*) FROM "ModuleRun"          WHERE "contractId" IS NULL),
--     (SELECT COUNT(*) FROM "GovernanceSnapshot" WHERE "contractId" IS NULL),
--     (SELECT COUNT(*) FROM "Finding"            WHERE "contractId" IS NULL);
--
-- All three must be 0. In production this was verified post-backfill
-- before PR 2 was opened. Fresh/dev DBs created straight from migrations
-- have no rows, so the constraint applies trivially. The backfill is a
-- SEPARATE, idempotent, dry-runnable data script — it is intentionally
-- NOT inlined here (schema-only migration / data-only backfill split).
--
-- The legacy `ModuleRun_scanId_module_key` unique was already dropped in
-- PR 1 (`20260522180000_plan_03_drop_modulerun_legacy_unique`); PR 2 only
-- ADDs the new composite unique now that contractId is NOT NULL on every
-- row. No DROP is issued here.
--
-- Unique constraints are emitted as Prisma's `CREATE UNIQUE INDEX` idiom
-- (the form `@@unique` / `@unique` generate). In Postgres this is
-- functionally identical to the spec's `ALTER TABLE ... ADD CONSTRAINT
-- ... UNIQUE`, and the index names match the spec's constraint names
-- verbatim — see the symmetric DROP INDEX note in PR 1's migration.
--
-- Source of truth: spec §3.5 PR 2 (frozen on commit 8103195).

-- AlterTable
ALTER TABLE "Finding" ALTER COLUMN "contractId" SET NOT NULL;

-- AlterTable
ALTER TABLE "GovernanceSnapshot" ALTER COLUMN "contractId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ModuleRun" ALTER COLUMN "contractId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "GovernanceSnapshot_contractId_key" ON "GovernanceSnapshot"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "ModuleRun_scanId_module_contractId_key" ON "ModuleRun"("scanId", "module", "contractId");
