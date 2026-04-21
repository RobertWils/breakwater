/**
 * GET /api/scan/[id] — Tier-gated scan read endpoint.
 * Returns scan data with findings shaped per §5.3 visibility rules.
 * GAP 3: scanId is the shared secret — no ownership check.
 * GAP 7: session presence → tier=email, absence → tier=unauth.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getScan } from "@/lib/scan-response";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!UUID_REGEX.test(params.id)) {
    return NextResponse.json(
      { error: "invalid_scan_id", message: "Scan ID must be a valid UUID" },
      { status: 400 },
    );
  }

  try {
    // ── Resolve session inside try so auth errors are caught (§5.1) ──
    const session = await getServerSession(authOptions);
    // Plan 01: only unauth vs email. "paid" tier is a placeholder for future subscription check.
    const tier = session?.user?.id ? "email" : "unauth";

    const scan = await getScan({ scanId: params.id, tier });

    if (!scan) {
      return NextResponse.json(
        { error: "scan_not_found", message: "No scan found with this ID" },
        { status: 404 },
      );
    }

    return NextResponse.json(scan, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (err) {
    console.error("[scan-response] Error fetching scan:", err);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to fetch scan" },
      { status: 500 },
    );
  }
}
