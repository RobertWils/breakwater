import { serve } from "inngest/next";
import type { NextRequest } from "next/server";

import { assertProductionInngestConfig } from "@/lib/config";
import { inngest } from "@/lib/inngest/client";

const handlers = serve({
  client: inngest,
  functions: [],
});

export async function GET(req: NextRequest): Promise<Response> {
  assertProductionInngestConfig();
  return handlers.GET(req, undefined);
}

export async function POST(req: NextRequest): Promise<Response> {
  assertProductionInngestConfig();
  return handlers.POST(req, undefined);
}

export async function PUT(req: NextRequest): Promise<Response> {
  assertProductionInngestConfig();
  return handlers.PUT(req, undefined);
}
