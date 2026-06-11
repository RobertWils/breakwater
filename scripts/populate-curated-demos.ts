#!/usr/bin/env tsx
/**
 * Plan 04 Scope F — populate the curated multi-Contract demos with REAL
 * scan data (the never-written Plan 03 follow-up; spec §8 + Plan 04 spec
 * Phase F).
 *
 * WHAT THIS DOES
 * --------------
 * `prisma/seed.ts` already upserts the curated demo Protocol rows (Aave V3,
 * Uniswap V3) as `ownershipStatus: CURATED` metadata. This script adds the
 * one published demo Scan each protocol is supposed to point at
 * (`Protocol.latestDemoScanId`, spec §8.2), by running the curated graph
 * through the REAL `submitScan` pipeline — no fabricated findings, ever.
 *
 * It is purely additive: it does not modify executor / scoring /
 * response-builder / UI logic. It only drives the existing scan pipeline
 * and links its real output.
 *
 * WHY IT CANNOT JUST CALL submitScan (recon findings)
 * ---------------------------------------------------
 *   1. CURATED gate — `submitScan` (scan-submission.ts step 6) rejects any
 *      protocol with `ownershipStatus: CURATED`. The seeded demos are
 *      CURATED, so this script transiently flips the protocol to UNCLAIMED
 *      to open the gate and ALWAYS restores CURATED afterwards.
 *   2. Async execution — `submitScan` only emits a `scan.queued` Inngest
 *      event and returns 202; the detectors run later in the Inngest
 *      workers. This script therefore waits for the scan to reach a
 *      terminal state before publishing it.
 *
 * The decision/orchestration logic lives in (and is unit-tested via)
 * `populate-curated-demos.logic.ts`; this file is the live IO wiring.
 *
 * RUNTIME PRECONDITIONS (this is a LIVE-ENVIRONMENT operation)
 * -----------------------------------------------------------
 * Real detector output requires all of the following to be reachable from
 * wherever the script runs:
 *   - `DATABASE_URL` — the target DB (the same one that serves the demos).
 *   - The Inngest runtime actually processing `scan.queued` events — i.e.
 *     Inngest Cloud connected to the deployed app's `/api/inngest`, or a
 *     local `inngest dev` server connected to a running `next dev`.
 *     Without it the scan stays QUEUED, the wait times out, and NOTHING is
 *     published (fail-safe; no fabrication).
 *   - Live RPC (public fallback works) + Safe (anonymous tier works) +
 *     `ETHERSCAN_API_KEY` (optional but recommended — without it GOV-002 /
 *     proxy-ABI coverage degrades below the spec §14 promise; the demo would
 *     be real-but-thin). See docs/deployment-env.md.
 *
 * SAFETY MODEL
 * ------------
 * This triggers real scans (external RPC/Etherscan/Safe calls) and mutates
 * the demo-serving DB — i.e. a production mutation. It therefore DEFAULTS TO
 * DRY RUN and requires an explicit `--execute` to write. (`assertNotProduction`
 * is deliberately NOT used: the script's whole purpose is to populate the
 * environment that serves the demos.)
 *
 * GUARANTEES (enforced in populate-curated-demos.logic.ts, tested):
 *   - Idempotent: a demo already pointing at a complete scan with the right
 *     contract count is skipped.
 *   - Curated-gate safe: the protocol always ends CURATED (publish on
 *     success; finally-restore on every failure path).
 *   - No half-state: a failed/drifted scan is never linked.
 *   - Auditable: every decision + transition is logged.
 *
 * INVOCATION
 * ----------
 *   pnpm db:populate-curated-demos                 # DRY RUN (default, safe)
 *   pnpm db:populate-curated-demos -- --execute    # writes (real scans)
 *
 * The `--` separator makes pnpm forward the flag to the tsx subprocess.
 * Tune the per-scan wait with `POPULATE_SCAN_TIMEOUT_MS` (default 600000).
 */

import { PrismaClient, type ScanStatus } from "@prisma/client";

import { hashIp } from "@/lib/hash";
import { submitScan } from "@/lib/scan-submission";
import { ScanSubmissionError } from "@/lib/scan-submission/errors";

import {
  buildScanSubmissionInput,
  runPopulate,
  type PopulateDeps,
} from "./populate-curated-demos.logic";

const prisma = new PrismaClient();

const TERMINAL_SCAN_STATUSES: ReadonlySet<ScanStatus> = new Set<ScanStatus>([
  "COMPLETE",
  "PARTIAL_COMPLETE",
  "FAILED",
  "EXPIRED",
]);

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_SCAN_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

// Synthetic operator IP namespace. A per-demo IP keeps each demo's
// submission isolated from the 3/hr unauth IP rate limit and makes the
// audit (ScanAttempt) rows attributable to this script. The salt is not
// security-sensitive here — these are public demo contracts, not user IPs.
const IP_SALT = process.env.SCAN_IP_SALT ?? "populate-curated-demos";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeLiveDeps(): PopulateDeps {
  const timeoutMs = Number.parseInt(
    process.env.POPULATE_SCAN_TIMEOUT_MS ?? "",
    10,
  );
  const scanTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_SCAN_TIMEOUT_MS;

  return {
    async readProtocolState(demo) {
      const protocol = await prisma.protocol.findUnique({
        where: { slug: demo.slug },
        select: {
          ownershipStatus: true,
          latestDemoScanId: true,
          latestDemoScan: {
            select: {
              status: true,
              _count: { select: { contracts: true } },
            },
          },
        },
      });
      if (!protocol) {
        return {
          exists: false,
          ownershipStatus: null,
          latestDemoScanId: null,
          linkedScanStatus: null,
          linkedScanContractCount: null,
        };
      }
      return {
        exists: true,
        ownershipStatus: protocol.ownershipStatus,
        latestDemoScanId: protocol.latestDemoScanId,
        linkedScanStatus: protocol.latestDemoScan?.status ?? null,
        linkedScanContractCount:
          protocol.latestDemoScan?._count.contracts ?? null,
      };
    },

    async setOwnership(demo, status) {
      await prisma.protocol.update({
        where: { slug: demo.slug },
        data: { ownershipStatus: status },
      });
    },

    async submit(demo) {
      const input = buildScanSubmissionInput(demo);
      const ip = `populate:${demo.slug}`;
      try {
        const res = await submitScan({
          input,
          userId: null,
          userEmail: null,
          ip,
          ipHash: hashIp(ip, IP_SALT),
          userAgent: "breakwater-populate-curated-demos",
        });
        return { scanId: res.scanId };
      } catch (err) {
        // A recent populate run (within the 10-min protocol cooldown) means
        // a scan for this protocol already exists — reuse the latest rather
        // than failing the whole run. Any other error propagates.
        if (
          err instanceof ScanSubmissionError &&
          err.code === "protocol_cooldown"
        ) {
          const latest = await prisma.scan.findFirst({
            where: { protocol: { slug: demo.slug } },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });
          if (latest) return { scanId: latest.id };
        }
        throw err;
      }
    },

    async waitForScan(scanId) {
      const deadline = Date.now() + scanTimeoutMs;
      // First read happens immediately; loop until terminal or timeout.
      for (;;) {
        const scan = await prisma.scan.findUnique({
          where: { id: scanId },
          select: { status: true, _count: { select: { contracts: true } } },
        });
        const status: ScanStatus = scan?.status ?? "FAILED";
        const contractCount = scan?._count.contracts ?? 0;
        if (TERMINAL_SCAN_STATUSES.has(status) || Date.now() >= deadline) {
          // On timeout we return the current (likely QUEUED/RUNNING) status;
          // the orchestrator treats any non-published status as an error and
          // declines to publish.
          return { status, contractCount };
        }
        await sleep(POLL_INTERVAL_MS);
      }
    },

    async publishDemoScan(demo, scanId) {
      // Single update = atomic link + CURATED restore.
      await prisma.protocol.update({
        where: { slug: demo.slug },
        data: { latestDemoScanId: scanId, ownershipStatus: "CURATED" },
      });
    },

    log(line) {
      console.log(`[populate-demos] ${line}`);
    },
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "[populate-demos] DATABASE_URL is required — point it at the DB that serves the demos.",
    );
    process.exit(1);
  }

  // Safe by default: dry-run unless --execute is passed explicitly.
  const execute = process.argv.includes("--execute");
  const dryRun = !execute || process.argv.includes("--dry-run");

  console.log(
    `[populate-demos] curated demo population — ${dryRun ? "DRY RUN" : "EXECUTE (writes real scans)"}`,
  );
  if (!dryRun) {
    console.log(
      "[populate-demos] EXECUTE mode: this submits REAL scans (live RPC/Etherscan/Safe) and\n" +
        "[populate-demos] requires the Inngest runtime to be processing events, or scans will\n" +
        "[populate-demos] never complete and nothing will be published.",
    );
  }

  const summary = await runPopulate(makeLiveDeps(), { dryRun });

  console.log(`[populate-demos] complete: ${JSON.stringify(summary, null, 2)}`);

  if (summary.errors > 0) {
    console.error(
      `[populate-demos] ${summary.errors} demo(s) errored — investigate before re-running.`,
    );
    process.exit(1);
  }
}

// Only run main() when invoked as a script; tests import the logic module
// directly and run their own assertions.
const invokedDirectly = process.argv[1]?.endsWith("populate-curated-demos.ts");
if (invokedDirectly) {
  main()
    .catch((e) => {
      console.error("[populate-demos] fatal error:", e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
