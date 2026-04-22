-- Seeds the System Organization that owns all CURATED Protocols.
-- Idempotent: safe to re-run in any environment.
INSERT INTO "Organization" ("id", "name", "kind", "createdAt", "updatedAt")
VALUES ('system-breakwater', 'Breakwater', 'SYSTEM', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
