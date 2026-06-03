/**
 * GET /api/scan/[id]/status — lightweight polling endpoint.
 *
 * Plan 03 §7.3 — per-Contract polling shape. Returns one entry per
 * Contract on the scan, each with its own per-(Contract, module)
 * ModuleRun statuses. `useScanPolling` consumes this for the
 * per-Contract status pulses inside each ContractCard.
 *
 * Used by the `useScanPolling` hook so /scan/[id] can transition
 * QUEUED → RUNNING → COMPLETE without re-fetching the full ~2 KB
 * scan body.
 *
 * Cache-Control per spec §6.2 (Plan 02 carry-over):
 *   - Non-terminal (QUEUED, RUNNING, PARTIAL_COMPLETE) → no-store
 *   - Terminal (COMPLETE, FAILED, EXPIRED) → private, max-age=60
 *
 * Drift vs spec §6.3 payload: `updatedAt` is omitted. The Scan model
 * has `createdAt` + `completedAt` but no `@updatedAt`; spec listed
 * `updatedAt` against a column that doesn't exist. The polling hook
 * only reads `data.status` + `data.contracts`, so the field is unused
 * downstream. Adding an `updatedAt` column is a Plan 04+ schema
 * change if needed.
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
        contracts: {
          select: {
            id: true,
            address: true,
            label: true,
            role: true,
            isPrimary: true,
            moduleRuns: {
              orderBy: { module: "asc" },
              select: {
                module: true,
                status: true,
                grade: true,
              },
            },
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
        contracts: scan.contracts.map((c) => ({
          id: c.id,
          address: c.address,
          label: c.label,
          role: c.role,
          isPrimary: c.isPrimary,
          modules: c.moduleRuns,
        })),
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
