import type {
  GovernanceSnapshot,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

import type { GovernanceSnapshotData } from "./types";

/**
 * Structural client type covering both the top-level PrismaClient and
 * the in-transaction client passed by `prisma.$transaction(async (tx) => …)`.
 * Same convention as `ScanAttemptClient` in `src/lib/scan-attempt.ts` —
 * keeps the public API decoupled from Prisma's specific union types.
 */
// Plan 03 §3.5 PR 1: the structural shape widens from a single `upsert` to
// the findFirst → update OR create pattern that the function implementation
// now uses (see persistGovernanceSnapshot for the rationale: scanId is no
// longer @unique so atomic upsert is unavailable until Phase E re-keys this
// on contractId).
//
// The method signatures here are deliberately narrow concrete forms that
// match the function's exact call shape. Prisma's generic
// `GovernanceSnapshotDelegate` is too wide for `vi.fn<T>()` to satisfy
// (it carries `<T extends FindFirstArgs>` generics that don't survive
// erasure into a mock); the real Prisma delegate is structurally
// compatible with the narrow form below at every call site we make.
export type SnapshotClient = {
  governanceSnapshot: {
    findFirst: (args: {
      where: { scanId: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
    update: (args: {
      where: { id: string };
      data: Prisma.GovernanceSnapshotUncheckedUpdateInput;
    }) => Promise<GovernanceSnapshot>;
    create: (args: {
      data: Prisma.GovernanceSnapshotUncheckedCreateInput;
    }) => Promise<GovernanceSnapshot>;
  };
};

export interface PersistSnapshotContext {
  scanId: string;
  snapshot: GovernanceSnapshotData;
}

/**
 * Persist a governance snapshot to the GovernanceSnapshot table.
 *
 * Uses upsert keyed on `scanId` (unique per spec §3 + B.1 schema):
 *   - First write for a scan: insert.
 *   - Re-snapshot (e.g., orchestrator retry): overwrite all detector-
 *     derived fields and bump `capturedAt` to wall-clock now.
 *
 * The `client` parameter accepts both the top-level `prisma` and an
 * in-transaction `tx` client. Phase F's executeScan can call this
 * inside a transaction alongside ModuleRun status updates so the
 * snapshot lands atomically with the run record.
 */
export async function persistGovernanceSnapshot(
  context: PersistSnapshotContext,
  client: SnapshotClient = prisma,
): Promise<GovernanceSnapshot> {
  const { scanId, snapshot } = context;
  const data = mapSnapshotToCreate(snapshot);

  // Plan 03 §3.5 PR 1: `GovernanceSnapshot.scanId` is no longer @unique,
  // so the Plan 02 atomic `upsert({ where: { scanId } })` no longer
  // type-checks. We split into findFirst → update OR create. This is
  // safe under the actual Inngest retry model (step retries are
  // sequential, not concurrent), and the surrounding tx isolates against
  // cross-function races. Phase E re-keys this on contractId and
  // restores a proper @unique-backed upsert at that layer.
  const existing = await client.governanceSnapshot.findFirst({
    where: { scanId },
    select: { id: true },
  });
  if (existing) {
    return client.governanceSnapshot.update({
      where: { id: existing.id },
      data: { ...data, capturedAt: new Date() },
    });
  }
  return client.governanceSnapshot.create({
    data: { scanId, ...data },
  });
}

/**
 * Map a GovernanceSnapshotData into the Prisma scalar-only shape
 * accepted by both create and update inputs. Fields are 1:1 with the
 * schema (verified during Phase D.4 pre-flight); enum values flow
 * through unchanged because both producer (snapshot type) and consumer
 * (Prisma client) import the same enum from `@prisma/client`.
 */
function mapSnapshotToCreate(
  data: GovernanceSnapshotData,
): Omit<Prisma.GovernanceSnapshotUncheckedCreateInput, "scanId"> {
  return {
    blockNumber: data.blockNumber,
    capturedAt: data.capturedAt,

    hasGovernor: data.hasGovernor,
    governorAddress: data.governorAddress,
    governorType: data.governorType,
    governorVersion: data.governorVersion,

    hasTimelock: data.hasTimelock,
    timelockAddress: data.timelockAddress,
    timelockMinDelay: data.timelockMinDelay,
    timelockAdmin: data.timelockAdmin,
    timelockAdminIsContract: data.timelockAdminIsContract,

    hasMultisig: data.hasMultisig,
    multisigAddress: data.multisigAddress,
    multisigThreshold: data.multisigThreshold,
    multisigOwnerCount: data.multisigOwnerCount,
    multisigOwners: data.multisigOwners,

    proxyType: data.proxyType,
    proxyAdminAddress: data.proxyAdminAddress,
    proxyImplementation: data.proxyImplementation,
    proxyVerified: data.proxyVerified,
    proxyAdminIsContract: data.proxyAdminIsContract,
    implementationAbi: data.implementationAbi,
    protocolAbi: data.protocolAbi,

    votingTokenAddress: data.votingTokenAddress,
    votingSnapshotType: data.votingSnapshotType,

    rawState: data.rawState as Prisma.InputJsonValue,
  };
}
