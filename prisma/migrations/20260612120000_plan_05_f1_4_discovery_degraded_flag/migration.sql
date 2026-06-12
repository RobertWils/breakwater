-- Plan 05 Fase 1.4 — detect-and-attach degraded flag (PURELY ADDITIVE).
--
-- One defaulted boolean on "Scan", set true when the discovery/attach step
-- hits a hard failure and the scan continues on its manual contracts only (a
-- single failing discovery must not sink a whole scan). A degraded scan must
-- not imply full-coverage certainty; a later phase surfaces it as a UI badge.
-- NOT NULL DEFAULT false is metadata-only in Postgres 11+ (no table rewrite),
-- and existing rows read false. Changes no existing behaviour — nothing reads
-- this column yet beyond the flag-setter.

-- AlterTable
ALTER TABLE "Scan" ADD COLUMN     "discoveryDegraded" BOOLEAN NOT NULL DEFAULT false;

