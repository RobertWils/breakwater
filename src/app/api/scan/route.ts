/**
 * POST /api/scan — Scan submission endpoint.
 * Implements the 12-step flow per spec §5.1.
 * Steps 1–6: read-only / ScanAttempt logging (pre-transaction).
 * Steps 7–11: atomic transaction with pg_advisory_xact_lock.
 * Step 12: return { scanId } 202.
 */

import { assertProductionHashSalts } from "@/lib/config";
// Called once at module load to enforce production salt requirements.
assertProductionHashSalts();

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hashIp } from "@/lib/hash";
import { ScanSubmissionSchema } from "@/lib/schemas/scan";
import {
  submitScan,
  logMalformedAttempt,
} from "@/lib/scan-submission";
import { ScanSubmissionError } from "@/lib/scan-submission/errors";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Extract request metadata before body parse ──
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

  // ── Resolve session ──
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
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
  try {
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
      return NextResponse.json(
        { error: err.code, message: err.message, ...err.details },
        {
          status: err.statusCode,
          headers: err.headers,
        },
      );
    }

    console.error("[POST /api/scan] Unexpected error:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
