/**
 * IP and user rate-limit helpers, and payload dedupe check.
 * All checks query the ScanAttempt table (no Redis).
 * Cooldown check lives inside the transaction in scan-submission.ts — not here.
 */

import { prisma } from "@/lib/prisma";

const IP_RATE_LIMIT_UNAUTH = 3;
const IP_RATE_LIMIT_AUTH = 10;
const IP_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function checkIpRateLimit(params: {
  ipHash: string;
  userId: string | null;
}): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const isAuth = params.userId !== null;
  const limit = isAuth ? IP_RATE_LIMIT_AUTH : IP_RATE_LIMIT_UNAUTH;
  const since = new Date(Date.now() - IP_RATE_WINDOW_MS);

  // Auth users: rate limit per userId (cross-device).
  // Unauth users: rate limit per ipHash.
  const whereFilter = isAuth
    ? {
        userId: params.userId,
        status: "ACCEPTED" as const,
        attemptedAt: { gte: since },
      }
    : {
        ipHash: params.ipHash,
        status: "ACCEPTED" as const,
        attemptedAt: { gte: since },
      };

  const count = await prisma.scanAttempt.count({ where: whereFilter });
  if (count < limit) return { allowed: true, retryAfterSec: 0 };

  // Rate limit releases when OLDEST accepted row ages out of window.
  const oldest = await prisma.scanAttempt.findFirst({
    where: whereFilter,
    orderBy: { attemptedAt: "asc" },
    select: { attemptedAt: true },
  });
  const retryAfterMs = oldest
    ? oldest.attemptedAt.getTime() + IP_RATE_WINDOW_MS - Date.now()
    : IP_RATE_WINDOW_MS;
  return {
    allowed: false,
    retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

export const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export async function checkDedupe(params: {
  ipHash: string;
  inputPayloadHash: string;
}): Promise<{ existingScanId: string | null }> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const recent = await prisma.scanAttempt.findFirst({
    where: {
      ipHash: params.ipHash,
      inputPayloadHash: params.inputPayloadHash,
      status: "ACCEPTED",
      attemptedAt: { gte: since },
      scanId: { not: null },
    },
    orderBy: { attemptedAt: "desc" },
    select: { scanId: true },
  });
  return { existingScanId: recent?.scanId ?? null };
}
