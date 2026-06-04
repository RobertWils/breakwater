// @vitest-environment node
import type { GovernanceSnapshot } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    governanceSnapshot: {
      // Plan 03 §3.5 PR 2: persistGovernanceSnapshot is a single atomic
      // upsert keyed on the contractId unique. Mock exposes only upsert.
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

import {
  persistGovernanceSnapshot,
  type SnapshotClient,
} from "../persist-snapshot";
import type { GovernanceSnapshotData } from "../types";

const upsertMock = vi.mocked(prisma.governanceSnapshot.upsert);

const fullSnapshot: GovernanceSnapshotData = {
  blockNumber: BigInt(20_000_000),
  capturedAt: new Date("2026-05-06T16:00:00Z"),

  hasGovernor: true,
  governorAddress: "0xgov",
  governorType: "OZ_GOVERNOR",
  governorVersion: "1",

  hasTimelock: true,
  timelockAddress: "0xtimelock",
  timelockMinDelay: 172_800,
  timelockAdmin: "0xadmin",
  timelockAdminIsContract: true,

  hasMultisig: true,
  multisigAddress: "0xsafe",
  multisigThreshold: 3,
  multisigOwnerCount: 5,
  multisigOwners: ["0x1", "0x2", "0x3", "0x4", "0x5"],

  proxyType: "EIP_1967_TRANSPARENT",
  proxyAdminAddress: "0xproxyadmin",
  proxyImplementation: "0ximpl",
  proxyVerified: true,
  proxyAdminIsContract: true,
  implementationAbi: '[{"name":"transfer"}]',
  protocolAbi: null,

  votingTokenAddress: null,
  votingSnapshotType: null,

  rawState: { test: "data" },
};

const minimalSnapshot: GovernanceSnapshotData = {
  blockNumber: BigInt(20_000_001),
  capturedAt: new Date("2026-05-06T16:00:00Z"),

  hasGovernor: false,
  governorAddress: null,
  governorType: null,
  governorVersion: null,

  hasTimelock: false,
  timelockAddress: null,
  timelockMinDelay: null,
  timelockAdmin: null,
  timelockAdminIsContract: null,

  hasMultisig: false,
  multisigAddress: null,
  multisigThreshold: null,
  multisigOwnerCount: null,
  multisigOwners: [],

  proxyType: "NONE",
  proxyAdminAddress: null,
  proxyImplementation: null,
  proxyVerified: false,
  proxyAdminIsContract: null,
  implementationAbi: null,
  protocolAbi: null,

  votingTokenAddress: null,
  votingSnapshotType: null,

  rawState: {},
};

const stubReturn = (overrides: Partial<GovernanceSnapshot> = {}) =>
  ({
    id: "snap-x",
    scanId: "scan-x",
    blockNumber: BigInt(0),
    capturedAt: new Date(),
    hasGovernor: false,
    governorAddress: null,
    governorType: null,
    governorVersion: null,
    hasTimelock: false,
    timelockAddress: null,
    timelockMinDelay: null,
    timelockAdmin: null,
    timelockAdminIsContract: null,
    hasMultisig: false,
    multisigAddress: null,
    multisigThreshold: null,
    multisigOwnerCount: null,
    multisigOwners: [],
    proxyType: null,
    proxyAdminAddress: null,
    proxyImplementation: null,
    proxyVerified: false,
    proxyAdminIsContract: null,
    implementationAbi: null,
    protocolAbi: null,
    votingTokenAddress: null,
    votingSnapshotType: null,
    rawState: {},
    ...overrides,
  }) as GovernanceSnapshot;

describe("persistGovernanceSnapshot (Plan 03 §3.5 PR 2 — atomic upsert keyed on contractId unique)", () => {
  beforeEach(() => {
    upsertMock.mockReset();
  });

  it("upserts a fully populated snapshot — create payload carries scanId + contractId + all fields", async () => {
    upsertMock.mockResolvedValueOnce(stubReturn({ scanId: "scan-1" }));

    await persistGovernanceSnapshot({
      scanId: "scan-1",
      contractId: "contract-1",
      snapshot: fullSnapshot,
    });

    expect(upsertMock).toHaveBeenCalledOnce();
    const args = upsertMock.mock.calls[0]![0];
    // Keyed on the contractId unique PR 2 added — this is what makes the
    // upsert atomic (no findFirst→write gap).
    expect(args.where).toEqual({ contractId: "contract-1" });
    expect(args.create).toMatchObject({
      scanId: "scan-1",
      contractId: "contract-1",
      blockNumber: BigInt(20_000_000),
      hasGovernor: true,
      governorType: "OZ_GOVERNOR",
      proxyType: "EIP_1967_TRANSPARENT",
      multisigOwners: ["0x1", "0x2", "0x3", "0x4", "0x5"],
    });
  });

  it("upsert create payload for a minimal snapshot — all-null governance fields", async () => {
    upsertMock.mockResolvedValueOnce(stubReturn({ scanId: "scan-2" }));

    await persistGovernanceSnapshot({
      scanId: "scan-2",
      contractId: "contract-2",
      snapshot: minimalSnapshot,
    });

    const args = upsertMock.mock.calls[0]![0];
    expect(args.create).toMatchObject({
      scanId: "scan-2",
      contractId: "contract-2",
      hasGovernor: false,
      hasTimelock: false,
      hasMultisig: false,
      proxyType: "NONE",
      multisigOwners: [],
    });
  });

  it("upsert update payload bumps capturedAt to now (re-snapshot path)", async () => {
    const beforeCall = Date.now();
    upsertMock.mockResolvedValueOnce(stubReturn({ id: "snap-existing" }));

    await persistGovernanceSnapshot({
      scanId: "scan-3",
      contractId: "contract-3",
      snapshot: fullSnapshot,
    });

    expect(upsertMock).toHaveBeenCalledOnce();
    const args = upsertMock.mock.calls[0]![0];
    expect(args.update.capturedAt).toBeInstanceOf(Date);
    expect((args.update.capturedAt as Date).getTime()).toBeGreaterThanOrEqual(
      beforeCall,
    );
  });

  it("keys the upsert on the contractId unique (Plan 03 §5.3.1 idempotency invariant — atomic, no findFirst→write gap)", async () => {
    upsertMock.mockResolvedValueOnce(stubReturn());

    await persistGovernanceSnapshot({
      scanId: "scan-x",
      contractId: "unique-contract-id",
      snapshot: minimalSnapshot,
    });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contractId: "unique-contract-id" } }),
    );
  });

  it("preserves rawState as a JSON object in the upsert create payload", async () => {
    upsertMock.mockResolvedValueOnce(stubReturn());

    const snapshot: GovernanceSnapshotData = {
      ...fullSnapshot,
      rawState: {
        governor: { name: "TestGov", votingDelay: "7200" },
        proxy: { type: "EIP_1967_TRANSPARENT" },
      },
    };

    await persistGovernanceSnapshot({
      scanId: "scan-4",
      contractId: "contract-4",
      snapshot,
    });

    const args = upsertMock.mock.calls[0]![0];
    expect(args.create.rawState).toEqual({
      governor: { name: "TestGov", votingDelay: "7200" },
      proxy: { type: "EIP_1967_TRANSPARENT" },
    });
  });

  it("routes through a custom client when one is provided (transaction support)", async () => {
    const txUpsert = vi
      .fn<SnapshotClient["governanceSnapshot"]["upsert"]>()
      .mockResolvedValueOnce(stubReturn({ scanId: "scan-5" }));
    const txClient: SnapshotClient = {
      governanceSnapshot: { upsert: txUpsert },
    };

    await persistGovernanceSnapshot(
      { scanId: "scan-5", contractId: "contract-5", snapshot: minimalSnapshot },
      txClient,
    );

    expect(txUpsert).toHaveBeenCalledOnce();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("returns the persisted GovernanceSnapshot row from the upsert", async () => {
    const persistedRow = stubReturn({ id: "snap-999", scanId: "scan-6" });
    upsertMock.mockResolvedValueOnce(persistedRow);

    const result = await persistGovernanceSnapshot({
      scanId: "scan-6",
      contractId: "contract-6",
      snapshot: fullSnapshot,
    });

    expect(result).toBe(persistedRow);
  });
});
