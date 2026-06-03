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
import { inngest } from "@/lib/inngest/client";
import { log } from "@/lib/logging";
import { checkIpRateLimit, DEDUPE_WINDOW_MS } from "@/lib/rate-limit";
import { createScanAttempt } from "@/lib/scan-attempt";
import { ScanErrors, ScanSubmissionError } from "@/lib/scan-submission/errors";
import {
  validateRelatedContracts,
  type NormalizedRelatedContract,
  type ScanSubmission,
} from "@/lib/schemas/scan";

import { ContractRole, ModuleName, Prisma } from "@prisma/client";

// Sentinel values for NOT NULL fields on ScanAttempt when full context is unavailable.
const SENTINEL_COOLDOWN_MALFORMED_JSON = "invalid:json";
const SENTINEL_COOLDOWN_SCHEMA = "invalid:schema";
const SENTINEL_COOLDOWN_ADDRESS = "invalid:address";
const SENTINEL_PAYLOAD_MALFORMED_JSON = "invalid:json";
const SENTINEL_PAYLOAD_SCHEMA = "invalid:schema";
const SENTINEL_PAYLOAD_ADDRESS = "invalid:address";

/**
 * Modules that have an Inngest handler registered in this build.
 *
 * Plan 02 ships only GOVERNANCE. ORACLE / SIGNER / FRONTEND are
 * scheduled for Plan 03+. ModuleRun rows for unimplemented modules
 * are created as SKIPPED with `errorMessage = "module_not_implemented"`
 * so the dispatcher's `markComplete` step doesn't hang waiting for a
 * handler that doesn't exist (Phase H manual smoke surfaced the hang).
 *
 * H.9 N1: typed as `ReadonlySet<ModuleName>` (was `<string>`) so the
 * compiler catches a typo or stale enum value at the source of truth
 * rather than after a runtime mismatch.
 *
 * When implementing a new module in a future plan:
 *   1. Add its Inngest function in `src/lib/inngest/functions/`.
 *   2. Register it in `src/app/api/inngest/route.ts`.
 *   3. Add the ModuleName enum value to this set.
 *   4. Update `scan-submission-integration.test.ts` assertions.
 *   5. Optionally update the ModuleCard SKIPPED copy to differentiate
 *      "Not included" vs "Coming soon" (see Phase G visual-polish
 *      backlog in NOTES.md).
 *
 * Exported so the completeness unit test in
 * `src/lib/__tests__/scan-submission-modules.test.ts` can assert that
 * every ModuleName enum value is either implemented or explicitly
 * acknowledged as a Plan 03+ placeholder.
 */
export const IMPLEMENTED_MODULES: ReadonlySet<ModuleName> = new Set<ModuleName>(
  [ModuleName.GOVERNANCE],
);

/**
 * Discriminator for why a ModuleRun ships SKIPPED. `null` means the
 * row will ship QUEUED (no skip condition triggered).
 *
 * Plan 03 §4.2 adds `role_not_applicable_to_module` between the
 * `module_not_implemented` and `domain_required` priority levels.
 */
export type SkipReason =
  | "module_disabled_by_user"
  | "module_not_implemented"
  | "role_not_applicable_to_module"
  | "domain_required"
  | null;

/**
 * Plan 03 §4.2 — applicable Contract roles per module. The GOVERNANCE
 * module skips TOKEN_CONTRACT (ERC-20 surface, not governance) and
 * DECLARED_BRIDGE (deferred to Plan 04 GOV-007). Future modules will
 * add their own entries here.
 */
const APPLICABLE_ROLES_BY_MODULE: Record<ModuleName, ReadonlySet<ContractRole>> = {
  [ModuleName.GOVERNANCE]: new Set<ContractRole>([
    ContractRole.PRIMARY,
    ContractRole.PROXY_IMPLEMENTATION,
    ContractRole.DECLARED_MULTISIG,
    ContractRole.TIMELOCK,
    ContractRole.RELATED,
  ]),
  // ORACLE / SIGNER / FRONTEND are not yet implemented; their entries
  // here are placeholders so the type is exhaustive. The
  // module_not_implemented gate fires before the role check for these.
  [ModuleName.ORACLE]: new Set<ContractRole>(),
  [ModuleName.SIGNER]: new Set<ContractRole>(),
  [ModuleName.FRONTEND]: new Set<ContractRole>(),
};

/**
 * H.9 N2: pure, exported priority-resolution for the skip reason on
 * a ModuleRun row. Priority order (first match wins):
 *   1. `module_disabled_by_user` — user explicit opt-out beats other
 *      reasons because their intent is the most useful audit signal.
 *   2. `module_not_implemented` — no Inngest handler; beats role and
 *      domain checks because "we cannot run this module at all" is a
 *      more fundamental reason than "we'd need different input."
 *   3. `role_not_applicable_to_module` — Plan 03 §4.2. The module is
 *      implemented but doesn't apply to this Contract's role (e.g.,
 *      GOVERNANCE on a TOKEN_CONTRACT or DECLARED_BRIDGE).
 *   4. `domain_required` — the FRONTEND-needs-domain case.
 *
 * Returns `null` when none of the four conditions trigger — the
 * caller seeds the row as QUEUED with `errorMessage: null`.
 *
 * Pure function with no IO — unit-testable without the integration
 * fixture cost. See `scan-submission-modules.test.ts`.
 */
export function computeSkipReason(params: {
  module: ModuleName;
  role: ContractRole;
  enabled: boolean;
  implemented: boolean;
  requiresDomain: boolean;
  hasDomain: boolean;
}): SkipReason {
  if (!params.enabled) return "module_disabled_by_user";
  if (!params.implemented) return "module_not_implemented";
  if (!APPLICABLE_ROLES_BY_MODULE[params.module].has(params.role)) {
    return "role_not_applicable_to_module";
  }
  if (params.requiresDomain && !params.hasDomain) return "domain_required";
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveDisplayName(
  input: ScanSubmission,
  normalizedAddress: string,
): string {
  const shortAddr =
    normalizedAddress.slice(0, 6) + "..." + normalizedAddress.slice(-4);
  return `${input.chain} ${shortAddr}`;
}

export function generateSlug(
  chain: string,
  normalizedAddress: string,
): string {
  // 14-char prefix: "0x" + 12 hex chars on Ethereum, 14 base58 chars on Solana.
  // Reduces collision probability ~65k× vs the prior 8-char prefix. See Plan 02
  // B.3 for the bump rationale.
  const shortAddr = normalizedAddress.slice(0, 14);
  return `${chain.toLowerCase()}-${shortAddr}`.toLowerCase();
}

function generateIdempotencyKey(
  scanId: string,
  module: string,
  contractId: string,
): string {
  const hourBucket = Math.floor(Date.now() / (60 * 60 * 1000));
  return createHash("sha256")
    .update(`${scanId}:${module}:${contractId}:${hourBucket}`)
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
    await createScanAttempt(prisma, {
      ipHash: params.ipHash,
      userId: params.userId,
      userAgent: params.userAgent,
      cooldownKey: cooldownKeyVal,
      inputPayloadHash: payloadHashVal,
      status: "INVALID",
      reason: params.reason,
      scanId: null,
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
    await createScanAttempt(prisma, {
      ipHash: params.ipHash,
      userId: params.userId,
      userAgent: params.userAgent,
      cooldownKey: params.cooldownKey,
      inputPayloadHash: params.inputPayloadHash,
      status: "INVALID",
      reason: params.reason,
      scanId: null,
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
    await createScanAttempt(prisma, {
      ipHash: params.ipHash,
      userId: params.userId,
      userAgent: params.userAgent,
      cooldownKey: params.cooldownKey,
      inputPayloadHash: params.inputPayloadHash,
      status: "INVALID",
      reason: params.reason,
      scanId: null,
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
    await createScanAttempt(prisma, {
      ipHash: params.ipHash,
      userId: params.userId,
      userAgent: params.userAgent,
      cooldownKey: params.cooldownKey,
      inputPayloadHash: params.inputPayloadHash,
      status: "RATE_LIMITED",
      reason: params.reason,
      scanId: null,
    });
  } catch (err) {
    console.error("[scan-submission] Failed to log rate-limited attempt:", err);
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

  // ── Step 1b (Plan 03 §4.1): per-related-contract address validation ──
  // The new `relatedContracts` array goes through isValidAddress just like
  // the primary + legacy extras above. This catches malformed entries
  // before the normalization + dedup step below.
  for (let i = 0; i < input.relatedContracts.length; i++) {
    const entry = input.relatedContracts[i]!;
    if (!isValidAddress(input.chain, entry.address)) {
      await logInvalidAttempt({
        ipHash,
        userId,
        userAgent,
        cooldownKey: SENTINEL_COOLDOWN_ADDRESS,
        inputPayloadHash: SENTINEL_PAYLOAD_ADDRESS,
        reason: `invalid_relatedContracts`,
      });
      throw ScanErrors.invalidAddress(input.chain, entry.address, {
        field: "relatedContracts",
        index: i,
      });
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

  // ── Step 2b (Plan 03 §4.1): merge legacy extras into relatedContracts +
  //    run validateRelatedContracts ──
  // Legacy `extraContractAddresses` plain strings normalise to RELATED-role
  // entries so a single validation pass covers both submission shapes. The
  // helper handles primary-address-in-related (misconfiguration vs silent
  // dedupe) and inter-related deduplication.
  const mergedRelated = [
    ...input.relatedContracts.map((entry) => ({
      ...entry,
      address: normalizeAddress(input.chain, entry.address),
    })),
    ...normalizedExtras.map((addr) => ({
      address: addr,
      role: "RELATED" as const,
      label: undefined,
      crossChainTwins: [] as { chain: string; address: string }[],
    })),
  ];
  const relatedResult = validateRelatedContracts(normalizedAddress, mergedRelated);
  if (!relatedResult.ok) {
    await logInvalidAttempt({
      ipHash,
      userId,
      userAgent,
      cooldownKey: SENTINEL_COOLDOWN_ADDRESS,
      inputPayloadHash: SENTINEL_PAYLOAD_ADDRESS,
      reason: relatedResult.code,
    });
    throw ScanErrors.primaryAddressInRelated(
      relatedResult.details.address,
      relatedResult.details.role,
    );
  }
  const normalizedRelatedContracts: NormalizedRelatedContract[] =
    relatedResult.normalized;

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

  // ── Step 4: Payload dedupe is now performed INSIDE the transaction
  //    after the advisory lock (Plan 02 C.4 — I1 fix). The earlier
  //    pre-transaction check was racy: two concurrent identical POSTs
  //    could both observe "no existing scan" before either's tx had
  //    committed an ACCEPTED ScanAttempt. Moving dedupe under the
  //    advisory lock serialises identical submissions on the cooldown
  //    key so the second one sees the first's committed ACCEPTED row.

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

    // Step 7b: Payload dedupe inside the lock (C.4 I1).
    // Concurrent identical POSTs serialise on the advisory lock; the second
    // arrival now sees the first's committed ACCEPTED ScanAttempt and
    // returns the same scanId with statusCode 200 instead of double-creating.
    const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const dedupeMatch = await tx.scanAttempt.findFirst({
      where: {
        ipHash,
        inputPayloadHash: payloadHash,
        status: "ACCEPTED",
        attemptedAt: { gte: dedupeSince },
        scanId: { not: null },
      },
      orderBy: { attemptedAt: "desc" },
      select: { scanId: true },
    });
    if (dedupeMatch?.scanId) {
      await createScanAttempt(tx, {
        ipHash,
        userId,
        userAgent,
        cooldownKey: key,
        inputPayloadHash: payloadHash,
        status: "DUPLICATE",
        reason: "dedupe_recent_identical",
        scanId: dedupeMatch.scanId,
      });
      return {
        type: "duplicate",
        scanId: dedupeMatch.scanId,
      } as const;
    }

    // Step 7c: Cooldown check inside lock
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

      await createScanAttempt(tx, {
        ipHash,
        userId,
        userAgent,
        cooldownKey: key,
        inputPayloadHash: payloadHash,
        status: "RATE_LIMITED",
        reason: "protocol_cooldown",
        scanId: null,
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
          // Plan 03 §3.4: `Protocol.extraContractAddresses` is superseded
          // by the new Contract model. New scans no longer write this
          // column (the related-contract data lives on Contract rows
          // via §4.2). The column stays on the schema for backward-compat
          // reads of pre-Plan-03 Protocol rows but is dead data going
          // forward — initialise as `[]` here, never updated again.
          extraContractAddresses: [],
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
        // Plan 03 §3.5 PR 1: `compositeScore` renamed to `averageContractScore`.
        averageContractScore: null,
        worstContractScore: null,
        compositeGrade: null,
        isPartialGrade: false,
        isPartialCoverage: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      select: { id: true },
    });

    // Step 9b (Plan 03 §4.2): Create Contract rows. The PRIMARY row is
    // always created from `primaryContractAddress`; one additional row
    // per normalized related contract from `normalizedRelatedContracts`
    // (which already merges the legacy `extraContractAddresses` shape and
    // ran through validateRelatedContracts). The Contract.scan FK
    // cascades on delete, so a tx rollback after this point cleanly
    // removes the rows alongside the parent Scan.
    const primaryContract = await tx.contract.create({
      data: {
        scanId: scan.id,
        address: normalizedAddress,
        chain: input.chain,
        role: ContractRole.PRIMARY,
        isPrimary: true,
        label: null,
        crossChainTwins: [],
      },
      select: { id: true, address: true, role: true },
    });
    const relatedContractRows: { id: string; address: string; role: ContractRole }[] =
      [];
    for (const entry of normalizedRelatedContracts) {
      const row = await tx.contract.create({
        data: {
          scanId: scan.id,
          address: entry.address,
          chain: input.chain,
          role: entry.role as ContractRole,
          isPrimary: false,
          label: entry.label ?? null,
          crossChainTwins: entry.crossChainTwins,
        },
        select: { id: true, address: true, role: true },
      });
      relatedContractRows.push(row);
    }
    const allContractRows = [primaryContract, ...relatedContractRows];

    // Step 10 (Plan 03 §4.2): Create ModuleRun rows per (Contract, module)
    // pair. The H.6 + H.9 N2 priority resolution still applies; Plan 03
    // §4.2 adds `role_not_applicable_to_module` between the
    // module_not_implemented and domain_required priority levels (see
    // `computeSkipReason`).
    //
    // The legacy @@unique([scanId, module]) was dropped in PR 1's
    // `plan_03_drop_modulerun_legacy_unique` migration so N×M rows per
    // scan can coexist. PR 2's tightening adds the new composite unique
    // (scanId, module, contractId) once contractId is NOT NULL across
    // all historical rows.
    const moduleRuns: Prisma.ModuleRunCreateManyInput[] = [];
    for (const contract of allContractRows) {
      for (const name of Object.values(ModuleName) as ModuleName[]) {
        const enabled = (input.modulesEnabled as string[]).includes(name);
        const implemented = IMPLEMENTED_MODULES.has(name);
        const requiresDomain = name === ModuleName.FRONTEND;
        const hasDomain = !!input.domain;

        const skipReason = computeSkipReason({
          module: name,
          role: contract.role,
          enabled,
          implemented,
          requiresDomain,
          hasDomain,
        });

        moduleRuns.push({
          scanId: scan.id,
          contractId: contract.id,
          module: name,
          status: skipReason ? "SKIPPED" : "QUEUED",
          errorMessage: skipReason,
          idempotencyKey: generateIdempotencyKey(scan.id, name, contract.id),
          inputSnapshot: {
            chain: input.chain,
            contractAddress: contract.address,
            contractRole: contract.role,
            normalizedAddress,
            extraContractAddresses: normalizedExtras,
            domain: input.domain ?? null,
            multisigs: normalizedMultisigs,
            modulesEnabled: input.modulesEnabled,
          },
          attemptCount: 0,
          rpcCallsUsed: 0,
          detectorVersions: {},
        });
      }
    }

    // H.9 BLOCKER Layer B (Plan 03 extension): reject scans where every
    // (Contract, module) pair would ship SKIPPED (zero runnable across
    // the entire graph). Plan 02 checked per-module; Plan 03 checks
    // across the flattened (Contract × Module) matrix. Throws before
    // `createMany` so no ModuleRun rows persist; the throw also rolls
    // back the Scan + Contract rows this tx callback already created.
    if (!moduleRuns.some((m) => m.status === "QUEUED")) {
      throw ScanErrors.noRunnableModules(
        Array.from(IMPLEMENTED_MODULES).sort(),
      );
    }

    await tx.moduleRun.createMany({ data: moduleRuns });

    // Step 11: Write ACCEPTED ScanAttempt. ACCEPTED rows store reason=null
    // since "accepted" carried no information beyond the status itself
    // (Plan 02 B.3 — ScanAttempt.reason made nullable).
    await createScanAttempt(tx, {
      ipHash,
      userId,
      userAgent,
      cooldownKey: key,
      inputPayloadHash: payloadHash,
      status: "ACCEPTED",
      reason: null,
      scanId: scan.id,
    });

    return {
      type: "success",
      scanId: scan.id,
      protocolId: protocol.id,
    } as const;
  });

  if (txResult.type === "cooldown_hit") {
    throw ScanErrors.protocolCooldown(txResult.retryAfterSec);
  }

  if (txResult.type === "duplicate") {
    // Identical-payload re-submission absorbed inside the lock (C.4 I1).
    // Same shape as the prior pre-tx duplicate path: 200 + original scanId.
    return { scanId: txResult.scanId, statusCode: 200 };
  }

  // C.2.5: Lifecycle log — scan row exists, request was accepted (202).
  log({
    event: "scan.submitted",
    scanId: txResult.scanId,
    chain: input.chain,
    modulesEnabled: input.modulesEnabled,
  });

  // C.2 / C.4 (I2 + B2): Emit scan.queued for the dispatcher (executeScan).
  // Two-phase best-effort:
  //   Phase A — send the event with a deterministic Inngest event id so a
  //             retry of submitScan for the same scan is server-side
  //             deduplicated (B2 idempotency).
  //   Phase B — record inngestEventId + dispatchedAt on the Scan row so
  //             recovery jobs can tell "event sent" from "scan orphaned":
  //               inngestEventId NOT NULL → event was sent
  //               dispatchedAt    NULL    → DB write of (A)'s receipt failed
  //                                          but the event is already in flight.
  // Each phase has its own try/catch (I2) so a Phase B failure does not
  // mask Phase A success.
  let sentInngestEventId: string | undefined;
  try {
    const sendResult = await inngest.send({
      id: `scan:${txResult.scanId}:queued`,
      name: "scan.queued",
      data: {
        scanId: txResult.scanId,
        protocolId: txResult.protocolId,
        chain: input.chain,
        primaryContractAddress: normalizedAddress,
        modulesEnabled: input.modulesEnabled,
      },
    });
    sentInngestEventId = sendResult.ids[0];
  } catch (err) {
    console.error(
      "[scan-submission] Inngest emission failed for scan.queued:",
      err,
    );
    // Phase A failed: scan exists, no event sent. A recovery job can
    // identify the scan via inngestEventId IS NULL AND status='QUEUED'.
    return { scanId: txResult.scanId, statusCode: 202 };
  }

  // Phase A succeeded — emission is in flight. Persist the receipt.
  try {
    await prisma.scan.update({
      where: { id: txResult.scanId },
      data: {
        dispatchedAt: new Date(),
        inngestEventId: sentInngestEventId ?? null,
      },
    });
  } catch (err) {
    console.error(
      "[scan-submission] dispatchedAt/inngestEventId update failed:",
      err,
    );
    // Recovery semantics: inngestEventId may still be null in the DB
    // even though the event was sent. A recovery job MUST treat
    // dispatchedAt IS NULL as "uncertain" rather than "not dispatched"
    // and reconcile via the Inngest dashboard if the scan stalls.
  }

  log({
    event: "scan.dispatched",
    scanId: txResult.scanId,
    inngestEventId: sentInngestEventId,
  });

  return { scanId: txResult.scanId, statusCode: 202 };
}

// Re-export for route handler usage
export { logMalformedAttempt };
export type { ScanSubmissionError };
