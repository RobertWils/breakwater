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
export type SnapshotClient = {
  governanceSnapshot: {
    upsert: (args: {
      where: Prisma.GovernanceSnapshotWhereUniqueInput;
      create: Prisma.GovernanceSnapshotUncheckedCreateInput;
      update: Prisma.GovernanceSnapshotUncheckedUpdateInput;
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

  return client.governanceSnapshot.upsert({
    where: { scanId },
    create: { scanId, ...data },
    update: { ...data, capturedAt: new Date() },
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
