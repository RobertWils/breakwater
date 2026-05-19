/**
 * GET /api/scan/[id]/status — lightweight polling endpoint (Plan 02 G.1).
 *
 * Returns status-level data only (no findings, no protocol, no error
 * stacks). Used by the Phase G.2 `useScanPolling` hook so /scan/[id]
 * can transition QUEUED → RUNNING → COMPLETE without re-fetching the
 * full ~2 KB scan body. Target payload ≤200 bytes (spec §6.3).
 *
 * Cache-Control per spec §6.2:
 *   - Non-terminal (QUEUED, RUNNING, PARTIAL_COMPLETE) → no-store
 *   - Terminal (COMPLETE, FAILED, EXPIRED) → private, max-age=60
 *
 * Drift vs spec §6.3 payload: `updatedAt` is omitted. The Scan model
 * has `createdAt` + `completedAt` but no `@updatedAt`; spec listed
 * `updatedAt` against a column that doesn't exist. The polling hook
 * only reads `data.status`, so the field is unused downstream. Adding
 * an `updatedAt` column is a Plan 03+ schema change if needed.
 */

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { UUID_REGEX } from "@/lib/uuid";

export const dynamic = "force-dynamic";

const TERMINAL_SCAN_STATUSES = ["COMPLETE", "FAILED", "EXPIRED"] as const;

function cacheControlFor(status: string): string {
  return (TERMINAL_SCAN_STATUSES as readonly string[]).includes(status)
    ? "private, max-age=60"
    : "no-store";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json(
      { error: "invalid_scan_id", message: "Scan ID must be a valid UUID" },
      { status: 400 },
    );
  }

  try {
    const scan = await prisma.scan.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        status: true,
        modules: {
          orderBy: { module: "asc" },
          select: {
            module: true,
            status: true,
            grade: true,
          },
        },
      },
    });

    if (!scan) {
      return NextResponse.json(
        { error: "scan_not_found", message: "No scan found with this ID" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      {
        id: scan.id,
        status: scan.status,
        modules: scan.modules,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": cacheControlFor(scan.status),
        },
      },
    );
  } catch (err) {
    // No success-path logging — this endpoint is polled every 3 s by
    // useScanPolling, so success logs would flood. Errors only.
    console.error("[scan-status] Error fetching scan status:", err);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to fetch scan status" },
      { status: 500 },
    );
  }
}
