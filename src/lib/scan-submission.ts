/**
 * Core scan submission flow — 12 steps per spec §5.1.
 *
 * Steps 1–6: read-only or ScanAttempt-only writes (pre-transaction).
 * Steps 7–11: inside a single Postgres transaction guarded by pg_advisory_xact_lock.
 * Step 12: return { scanId } 202.
 */

import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeAddress, isValidAddress } from "@/lib/addresses";
import { hashEmail, hashPayload } from "@/lib/hash";
import { cooldownKey as buildCooldownKey } from "@/lib/cooldown";
import { checkIpRateLimit, checkDedupe } from "@/lib/rate-limit";
import { ScanErrors, ScanSubmissionError } from "@/lib/scan-submission/errors";
import type { ScanSubmission } from "@/lib/schemas/scan";

// Sentinel values for NOT NULL fields on ScanAttempt when full context is unavailable.
const SENTINEL_COOLDOWN_MALFORMED_JSON = "invalid:json";
const SENTINEL_COOLDOWN_SCHEMA = "invalid:schema";
const SENTINEL_COOLDOWN_ADDRESS = "invalid:address";
const SENTINEL_PAYLOAD_MALFORMED_JSON = "invalid:json";
const SENTINEL_PAYLOAD_SCHEMA = "invalid:schema";
const SENTINEL_PAYLOAD_ADDRESS = "invalid:address";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveDisplayName(
  input: ScanSubmission,
  normalizedAddress: string,
): string {
  const shortAddr =
    normalizedAddress.slice(0, 6) + "..." + normalizedAddress.slice(-4);
  return `${input.chain} ${shortAddr}`;
}

function generateSlug(chain: string, normalizedAddress: string): string {
  const shortAddr = normalizedAddress.slice(0, 8);
  return `${chain.toLowerCase()}-${shortAddr}`.toLowerCase();
}

function generateIdempotencyKey(scanId: string, module: string): string {
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  return createHash("sha256")
    .update(`${scanId}:${module}:${hourBucket}`)
    .digest("hex");
}

// ─── Logging helpers (non-ACCEPTED outcomes) ──────────────────────────────────
// Each writes one ScanAttempt row outside the main transaction.
// Failures are swallowed — logging must not cascade.

async function logMalformedAttempt(params: {
  ipHash: string;
  userId: string | null;
  userAgent: string;
  reason: "invalid_json" | "schema";
}) {
  const cooldownKeyVal =
    params.reason === "invalid_json"
      ? SENTINEL_COOLDOWN_MALFORMED_JSON
      : SENTINEL_COOLDOWN_SCHEMA;
  const payloadHashVal =
    params.reason === "invalid_json"
      ? SENTINEL_PAYLOAD_MALFORMED_JSON
      : SENTINEL_PAYLOAD_SCHEMA;
  try {
    await prisma.scanAttempt.create({
      data: {
        ipHash: params.ipHash,
        userId: params.userId,
        userAgent: params.userAgent,
        cooldownKey: cooldownKeyVal,
        inputPayloadHash: payloadHashVal,
        status: "INVALID",
        reason: params.reason,
        scanId: null,
      },
    });
  } catch (err) {
    console.error("[scan-submission] Failed to log malformed attempt:", err);
  }
}

async function logInvalidAttempt(params: {
  ipHash: string;
  userId: string | null;
  userAgent: string;
  cooldownKey: string;
  inputPayloadHash: string;
  reason: string;
}) {
  try {
    await prisma.scanAttempt.create({
      data: {
        ipHash: params.ipHash,
        userId: params.userId,
        userAgent: params.userAgent,
        cooldownKey: params.cooldownKey,
        inputPayloadHash: params.inputPayloadHash,
        status: "INVALID",
        reason: params.reason,
        scanId: null,
      },
    });
  } catch (err) {
    console.error("[scan-submission] Failed to log invalid attempt:", err);
  }
}

/**
 * Logs a ScanAttempt for internal configuration errors (e.g. missing env vars).
 * Written outside any transaction so the audit row survives rollbacks.
 * Swallows logging errors — must not cascade.
 */
async function logInternalErrorAttempt(params: {
  ipHash: string;
  userId: string | null;
  userAgent: string;
  cooldownKey: string;
  inputPayloadHash: string;
  reason: string;
}): Promise<void> {
  try {
    await prisma.scanAttempt.create({
      data: {
        ipHash: params.ipHash,
        userId: params.userId,
        userAgent: params.userAgent,
        cooldownKey: params.cooldownKey,
        inputPayloadHash: params.inputPayloadHash,
        status: "INVALID",
        reason: params.reason,
        scanId: null,
      },
    });
  } catch (err) {
    console.error("[scan-submission] Failed to log internal error attempt:", err);
  }
}

async function logRateLimitedAttempt(params: {
  ipHash: string;
  userId: string | null;
  userAgent: string;
  cooldownKey: string;
  inputPayloadHash: string;
  reason: "ip_hour" | "user_hour";
}) {
  try {
    await prisma.scanAttempt.create({
      data: {
        ipHash: params.ipHash,
        userId: params.userId,
        userAgent: params.userAgent,
        cooldownKey: params.cooldownKey,
        inputPayloadHash: params.inputPayloadHash,
        status: "RATE_LIMITED",
        reason: params.reason,
        scanId: null,
      },
    });
  } catch (err) {
    console.error("[scan-submission] Failed to log rate-limited attempt:", err);
  }
}

async function logDuplicateAttempt(params: {
  ipHash: string;
  userId: string | null;
  userAgent: string;
  cooldownKey: string;
  inputPayloadHash: string;
  scanId: string;
}) {
  try {
    await prisma.scanAttempt.create({
      data: {
        ipHash: params.ipHash,
        userId: params.userId,
        userAgent: params.userAgent,
        cooldownKey: params.cooldownKey,
        inputPayloadHash: params.inputPayloadHash,
        status: "DUPLICATE",
        reason: "dedupe_recent_identical",
        scanId: params.scanId,
      },
    });
  } catch (err) {
    console.error("[scan-submission] Failed to log duplicate attempt:", err);
  }
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface SubmitScanParams {
  input: ScanSubmission;
  userId: string | null;
  userEmail: string | null;
  ip: string;
  ipHash: string; // pre-computed by route handler
  userAgent: string;
}

export interface SubmitScanResult {
  scanId: string;
  statusCode: 200 | 202;
}

// ─── Main flow ────────────────────────────────────────────────────────────────

export async function submitScan(
  params: SubmitScanParams,
): Promise<SubmitScanResult> {
  const { input, userId, ipHash, userAgent } = params;

  // ── Step 1 (address pre-validation) ──
  // Validate ALL addresses before any normalization. On failure, log and throw.
  const allAddresses = [
    { value: input.primaryContractAddress, field: "primaryContractAddress", index: -1 },
    ...input.extraContractAddresses.map((a, i) => ({
      value: a,
      field: "extraContractAddresses",
      index: i,
    })),
    ...input.multisigs.map((a, i) => ({
      value: a,
      field: "multisigs",
      index: i,
    })),
  ];

  for (const { value, field, index } of allAddresses) {
    if (!isValidAddress(input.chain, value)) {
      await logInvalidAttempt({
        ipHash,
        userId,
        userAgent,
        cooldownKey: SENTINEL_COOLDOWN_ADDRESS,
        inputPayloadHash: SENTINEL_PAYLOAD_ADDRESS,
        reason: `invalid_${field}`,
      });
      throw ScanErrors.invalidAddress(input.chain, value, { field, index });
    }
  }

  // ── Step 2: Normalize all addresses ──
  const normalizedAddress = normalizeAddress(input.chain, input.primaryContractAddress);
  const normalizedExtras = input.extraContractAddresses.map((a) =>
    normalizeAddress(input.chain, a),
  );
  const normalizedMultisigs = input.multisigs.map((a) =>
    normalizeAddress(input.chain, a),
  );

  // ── Step 2 cont: Compute hashes and cooldown key ──
  const payloadHash = hashPayload({
    chain: input.chain,
    normalizedAddress,
    extraContractAddresses: normalizedExtras,
    domain: input.domain,
    multisigs: normalizedMultisigs,
    modulesEnabled: input.modulesEnabled,
  });
  const key = buildCooldownKey(input.chain, normalizedAddress);

  // ── Step 3: IP rate limit ──
  const rateLimit = await checkIpRateLimit({ ipHash, userId });
  if (!rateLimit.allowed) {
    const reason = userId !== null ? "user_hour" : "ip_hour";
    await logRateLimitedAttempt({
      ipHash,
      userId,
      userAgent,
      cooldownKey: key,
      inputPayloadHash: payloadHash,
      reason,
    });
    throw ScanErrors.rateLimited(
      userId !== null ? "user" : "ip",
      rateLimit.retryAfterSec,
    );
  }

  // ── Step 4: Payload dedupe ──
  const { existingScanId } = await checkDedupe({ ipHash, inputPayloadHash: payloadHash });
  if (existingScanId !== null) {
    await logDuplicateAttempt({
      ipHash,
      userId,
      userAgent,
      cooldownKey: key,
      inputPayloadHash: payloadHash,
      scanId: existingScanId,
    });
    return { scanId: existingScanId, statusCode: 200 };
  }

  // ── Step 5: Protocol lookup (read-only) ──
  const existingProtocol = await prisma.protocol.findUnique({
    where: {
      chain_primaryContractAddress: {
        chain: input.chain,
        primaryContractAddress: normalizedAddress,
      },
    },
    select: {
      id: true,
      slug: true,
      ownershipStatus: true,
      latestDemoScanId: true,
    },
  });

  // ── Step 6: Curated check (before transaction) ──
  if (existingProtocol?.ownershipStatus === "CURATED") {
    await logInvalidAttempt({
      ipHash,
      userId,
      userAgent,
      cooldownKey: key,
      inputPayloadHash: payloadHash,
      reason: "protocol_is_curated",
    });
    throw ScanErrors.curatedProtocol(
      existingProtocol.latestDemoScanId,
      existingProtocol.slug,
    );
  }

  // ── Steps 7–11: Transaction with advisory lock ──
  const COOLDOWN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

  const txResult = await prisma.$transaction(async (tx) => {
    // Step 7a: Acquire advisory lock (transaction-scoped, auto-released on commit/rollback)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

    // Step 7b: Cooldown check inside lock
    const cooldownSince = new Date(Date.now() - COOLDOWN_WINDOW_MS);
    const recentAccepted = await tx.scanAttempt.count({
      where: {
        cooldownKey: key,
        status: "ACCEPTED",
        attemptedAt: { gte: cooldownSince },
      },
    });

    if (recentAccepted > 0) {
      // Cooldown releases when NEWEST accepted row ages out.
      const newest = await tx.scanAttempt.findFirst({
        where: {
          cooldownKey: key,
          status: "ACCEPTED",
          attemptedAt: { gte: cooldownSince },
        },
        orderBy: { attemptedAt: "desc" },
        select: { attemptedAt: true },
      });
      const retryAfterMs = newest
        ? newest.attemptedAt.getTime() + COOLDOWN_WINDOW_MS - Date.now()
        : COOLDOWN_WINDOW_MS;
      const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));

      await tx.scanAttempt.create({
        data: {
          ipHash,
          userId,
          userAgent,
          cooldownKey: key,
          inputPayloadHash: payloadHash,
          status: "RATE_LIMITED",
          reason: "protocol_cooldown",
          scanId: null,
        },
      });

      return { type: "cooldown_hit", retryAfterSec } as const;
    }

    // Step 8: Upsert Protocol (only if lookup returned null)
    let protocol: { id: string };
    if (existingProtocol) {
      protocol = existingProtocol;
    } else {
      protocol = await tx.protocol.create({
        data: {
          chain: input.chain,
          primaryContractAddress: normalizedAddress,
          extraContractAddresses: normalizedExtras,
          domain: input.domain ?? null,
          displayName: deriveDisplayName(input, normalizedAddress),
          slug: generateSlug(input.chain, normalizedAddress),
          ownershipStatus: "UNCLAIMED",
          organizationId: null,
          knownMultisigs: normalizedMultisigs,
          expectedRiskProfile: null,
        },
        select: { id: true },
      });
    }

    // Step 9: Create Scan
    const emailSalt = process.env.SCAN_EMAIL_SALT ?? "";

    // Assert SCAN_EMAIL_SALT is set when submittedEmail is present.
    // Silent null-fallback would break the C.4 scan-linking invariant.
    // This write uses `prisma` (not `tx`) so the audit row commits independently
    // of the transaction rollback triggered by the throw below.
    if (input.submittedEmail && !emailSalt) {
      await logInternalErrorAttempt({
        ipHash,
        userId,
        userAgent,
        cooldownKey: key,
        inputPayloadHash: payloadHash,
        reason: "missing_email_salt",
      });
      throw new Error(
        "[scan-submission] SCAN_EMAIL_SALT required when submittedEmail present",
      );
    }

    const scan = await tx.scan.create({
      data: {
        protocolId: protocol.id,
        status: "QUEUED",
        submittedByUserId: userId,
        submittedEmail: input.submittedEmail?.toLowerCase().trim() ?? null,
        // emailSalt is guaranteed non-empty here when submittedEmail is present
        // (assertion above ensures it). hashEmail() also throws on empty salt.
        submittedEmailHash: input.submittedEmail
          ? hashEmail(input.submittedEmail, emailSalt)
          : null,
        ipHash,
        userAgent,
        compositeScore: null,
        compositeGrade: null,
        isPartialGrade: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    // Step 10: Create 4 ModuleRun rows
    const allModules = ["GOVERNANCE", "ORACLE", "SIGNER", "FRONTEND"] as const;
    const moduleRuns = allModules.map((module) => {
      const enabled = (input.modulesEnabled as string[]).includes(module);
      const requiresDomain = module === "FRONTEND";
      const hasDomain = !!input.domain;
      const shouldSkip = !enabled || (requiresDomain && !hasDomain);
      return {
        scanId: scan.id,
        module,
        status: shouldSkip ? ("SKIPPED" as const) : ("QUEUED" as const),
        idempotencyKey: generateIdempotencyKey(scan.id, module),
        inputSnapshot: {
          chain: input.chain,
          normalizedAddress,
          extraContractAddresses: normalizedExtras,
          domain: input.domain ?? null,
          multisigs: normalizedMultisigs,
          modulesEnabled: input.modulesEnabled,
        },
        attemptCount: 0,
        rpcCallsUsed: 0,
        detectorVersions: {},
      };
    });
    await tx.moduleRun.createMany({ data: moduleRuns });

    // Step 11: Write ACCEPTED ScanAttempt
    await tx.scanAttempt.create({
      data: {
        ipHash,
        userId,
        userAgent,
        cooldownKey: key,
        inputPayloadHash: payloadHash,
        status: "ACCEPTED",
        reason: "accepted",
        scanId: scan.id,
      },
    });

    return { type: "success", scanId: scan.id } as const;
  });

  if (txResult.type === "cooldown_hit") {
    throw ScanErrors.protocolCooldown(txResult.retryAfterSec);
  }

  return { scanId: txResult.scanId, statusCode: 202 };
}

// Re-export for route handler usage
export { logMalformedAttempt };
export type { ScanSubmissionError };
