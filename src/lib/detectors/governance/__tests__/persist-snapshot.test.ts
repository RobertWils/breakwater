// @vitest-environment node
import type { GovernanceSnapshot } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    governanceSnapshot: {
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
    votingTokenAddress: null,
    votingSnapshotType: null,
    rawState: {},
    ...overrides,
  }) as GovernanceSnapshot;

describe("persistGovernanceSnapshot (Plan 02 D.4)", () => {
  beforeEach(() => {
    upsertMock.mockReset();
  });

  it("upserts a fully populated snapshot keyed on scanId", async () => {
    upsertMock.mockResolvedValueOnce(stubReturn({ scanId: "scan-1" }));

    await persistGovernanceSnapshot({
      scanId: "scan-1",
      snapshot: fullSnapshot,
    });

    expect(upsertMock).toHaveBeenCalledOnce();
    const args = upsertMock.mock.calls[0]![0];
    expect(args.where).toEqual({ scanId: "scan-1" });
    expect(args.create).toMatchObject({
      scanId: "scan-1",
      blockNumber: BigInt(20_000_000),
      hasGovernor: true,
      governorType: "OZ_GOVERNOR",
      proxyType: "EIP_1967_TRANSPARENT",
      multisigOwners: ["0x1", "0x2", "0x3", "0x4", "0x5"],
    });
  });

  it("upserts a minimal snapshot with all-null governance fields", async () => {
    upsertMock.mockResolvedValueOnce(stubReturn({ scanId: "scan-2" }));

    await persistGovernanceSnapshot({
      scanId: "scan-2",
      snapshot: minimalSnapshot,
    });

    const args = upsertMock.mock.calls[0]![0];
    expect(args.create).toMatchObject({
      scanId: "scan-2",
      hasGovernor: false,
      hasTimelock: false,
      hasMultisig: false,
      proxyType: "NONE",
      multisigOwners: [],
    });
  });

  it("bumps update.capturedAt to wall-clock now on re-snapshot", async () => {
    const beforeCall = Date.now();
    upsertMock.mockResolvedValueOnce(stubReturn());

    await persistGovernanceSnapshot({
      scanId: "scan-3",
      snapshot: fullSnapshot,
    });

    const args = upsertMock.mock.calls[0]![0];
    expect(args.update.capturedAt).toBeInstanceOf(Date);
    expect((args.update.capturedAt as Date).getTime()).toBeGreaterThanOrEqual(
      beforeCall,
    );
  });

  it("uses scanId as the WhereUniqueInput key", async () => {
    upsertMock.mockResolvedValueOnce(stubReturn());

    await persistGovernanceSnapshot({
      scanId: "unique-scan-id",
      snapshot: minimalSnapshot,
    });

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { scanId: "unique-scan-id" } }),
    );
  });

  it("preserves rawState as a JSON object", async () => {
    upsertMock.mockResolvedValueOnce(stubReturn());

    const snapshot: GovernanceSnapshotData = {
      ...fullSnapshot,
      rawState: {
        governor: { name: "TestGov", votingDelay: "7200" },
        proxy: { type: "EIP_1967_TRANSPARENT" },
      },
    };

    await persistGovernanceSnapshot({ scanId: "scan-4", snapshot });

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
      { scanId: "scan-5", snapshot: minimalSnapshot },
      txClient,
    );

    expect(txUpsert).toHaveBeenCalledOnce();
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("returns the persisted GovernanceSnapshot row", async () => {
    const persistedRow = stubReturn({ id: "snap-999", scanId: "scan-6" });
    upsertMock.mockResolvedValueOnce(persistedRow);

    const result = await persistGovernanceSnapshot({
      scanId: "scan-6",
      snapshot: fullSnapshot,
    });

    expect(result).toBe(persistedRow);
  });
});
