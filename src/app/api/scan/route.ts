/**
 * POST /api/scan — Scan submission endpoint.
 * Implements the 12-step flow per spec §5.1.
 * Steps 1–6: read-only / ScanAttempt logging (pre-transaction).
 * Steps 7–11: atomic transaction with pg_advisory_xact_lock.
 * Step 12: return { scanId } 202.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { assertProductionHashSalts } from "@/lib/config";
import { hashIp } from "@/lib/hash";
import { ScanSubmissionSchema } from "@/lib/schemas/scan";
import {
  submitScan,
  logMalformedAttempt,
} from "@/lib/scan-submission";
import { ScanSubmissionError } from "@/lib/scan-submission/errors";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Enforce production salt requirements at request-time. Called inside the
  // handler (not at module load) so Next.js page-data collection during
  // `next build` does not trigger the assertion before env vars are read.
  assertProductionHashSalts();

  // ── Extract request metadata before body parse ──
  // These must be outside the try block so the catch can use them for
  // best-effort ScanAttempt logging on unexpected errors (§5.1 audit trail).
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const userAgent = req.headers.get("user-agent") ?? "unknown";

  // ── Compute ipHash early so logging always has it ──
  const ipSalt = process.env.SCAN_IP_SALT ?? "";
  let ipHash: string;
  try {
    ipHash = hashIp(ip, ipSalt);
  } catch {
    // Salt is missing in dev — fall back to a sentinel so the route stays functional.
    // assertProductionHashSalts() ensures this path is unreachable in production.
    ipHash = "no-salt";
  }

  // Declare userId outside the try so the catch can use the last-known value.
  let userId: string | null = null;

  try {
    // ── Resolve session (inside try so session errors are caught) ──
    const session = await getServerSession(authOptions);
    userId = (session?.user as { id?: string } | undefined)?.id ?? null;
    const userEmail =
      (session?.user as { email?: string } | undefined)?.email ?? null;

    // ── Parse JSON body ──
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      await logMalformedAttempt({ ipHash, userId, userAgent, reason: "invalid_json" });
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    // ── Zod validation ──
    const parsed = ScanSubmissionSchema.safeParse(rawBody);
    if (!parsed.success) {
      await logMalformedAttempt({ ipHash, userId, userAgent, reason: "schema" });
      return NextResponse.json(
        { error: "validation_error", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // ── Core submission flow ──
    const result = await submitScan({
      input: parsed.data,
      userId,
      userEmail,
      ip,
      ipHash,
      userAgent,
    });

    return NextResponse.json(
      { scanId: result.scanId },
      { status: result.statusCode },
    );
  } catch (err) {
    if (err instanceof ScanSubmissionError) {
      // submitScan already logged the appropriate ScanAttempt row — no double-log.
      return NextResponse.json(
        { error: err.code, message: err.message, ...err.details },
        {
          status: err.statusCode,
          headers: err.headers,
        },
      );
    }

    // Unexpected error: log best-effort ScanAttempt with sentinel values so the
    // audit trail records the attempt (§5.1). Use INVALID status with
    // "internal_error" reason, matching the pattern of other non-accepted paths.
    console.error("[POST /api/scan] Unexpected error:", err);
    try {
      const { prisma } = await import("@/lib/prisma");
      const { createScanAttempt } = await import("@/lib/scan-attempt");
      await createScanAttempt(prisma, {
        ipHash,
        userId,
        userAgent,
        cooldownKey: "internal:error",
        inputPayloadHash: "internal:error",
        status: "INVALID",
        reason: "internal_error",
        scanId: null,
      });
    } catch (logErr) {
      console.error("[POST /api/scan] Failed to log internal error attempt:", logErr);
    }
    return NextResponse.json(
      { error: "internal_error", message: "An unexpected error occurred" },
      { status: 500 },
    );
  }
}
