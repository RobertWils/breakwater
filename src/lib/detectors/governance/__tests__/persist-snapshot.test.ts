// @vitest-environment node
import type { GovernanceSnapshot } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    governanceSnapshot: {
      // Plan 03 §3.5 PR 1: persistGovernanceSnapshot's atomic upsert is
      // replaced with findFirst → create / update (scanId no longer
      // @unique). Mocks updated to match.
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

import {
  persistGovernanceSnapshot,
  type SnapshotClient,
} from "../persist-snapshot";
import type { GovernanceSnapshotData } from "../types";

const findFirstMock = vi.mocked(prisma.governanceSnapshot.findFirst);
const createMock = vi.mocked(prisma.governanceSnapshot.create);
const updateMock = vi.mocked(prisma.governanceSnapshot.update);

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

describe("persistGovernanceSnapshot (Plan 02 D.4, Plan 03 §3.5 PR 1)", () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    createMock.mockReset();
    updateMock.mockReset();
  });

  it("creates a fully populated snapshot when none exists for the scan", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    createMock.mockResolvedValueOnce(stubReturn({ scanId: "scan-1" }));

    await persistGovernanceSnapshot({
      scanId: "scan-1",
      snapshot: fullSnapshot,
    });

    expect(findFirstMock).toHaveBeenCalledOnce();
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { scanId: "scan-1" },
      select: { id: true },
    });
    expect(createMock).toHaveBeenCalledOnce();
    const args = createMock.mock.calls[0]![0];
    expect(args.data).toMatchObject({
      scanId: "scan-1",
      blockNumber: BigInt(20_000_000),
      hasGovernor: true,
      governorType: "OZ_GOVERNOR",
      proxyType: "EIP_1967_TRANSPARENT",
      multisigOwners: ["0x1", "0x2", "0x3", "0x4", "0x5"],
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("creates a minimal snapshot with all-null governance fields", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    createMock.mockResolvedValueOnce(stubReturn({ scanId: "scan-2" }));

    await persistGovernanceSnapshot({
      scanId: "scan-2",
      snapshot: minimalSnapshot,
    });

    const args = createMock.mock.calls[0]![0];
    expect(args.data).toMatchObject({
      scanId: "scan-2",
      hasGovernor: false,
      hasTimelock: false,
      hasMultisig: false,
      proxyType: "NONE",
      multisigOwners: [],
    });
  });

  it("updates the existing row on re-snapshot, bumping capturedAt to now", async () => {
    const beforeCall = Date.now();
    // vi.mocked(...) widens the mock's resolved-value type to the full
    // Prisma delegate's return type; stubReturn supplies the full record
    // even though the function only reads `.id` (select: { id: true }).
    findFirstMock.mockResolvedValueOnce(stubReturn({ id: "snap-existing" }));
    updateMock.mockResolvedValueOnce(stubReturn({ id: "snap-existing" }));

    await persistGovernanceSnapshot({
      scanId: "scan-3",
      snapshot: fullSnapshot,
    });

    expect(updateMock).toHaveBeenCalledOnce();
    const args = updateMock.mock.calls[0]![0];
    expect(args.where).toEqual({ id: "snap-existing" });
    expect(args.data.capturedAt).toBeInstanceOf(Date);
    expect((args.data.capturedAt as Date).getTime()).toBeGreaterThanOrEqual(
      beforeCall,
    );
    expect(createMock).not.toHaveBeenCalled();
  });

  it("locates the existing row by scanId on findFirst", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    createMock.mockResolvedValueOnce(stubReturn());

    await persistGovernanceSnapshot({
      scanId: "unique-scan-id",
      snapshot: minimalSnapshot,
    });

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { scanId: "unique-scan-id" },
      select: { id: true },
    });
  });

  it("preserves rawState as a JSON object", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    createMock.mockResolvedValueOnce(stubReturn());

    const snapshot: GovernanceSnapshotData = {
      ...fullSnapshot,
      rawState: {
        governor: { name: "TestGov", votingDelay: "7200" },
        proxy: { type: "EIP_1967_TRANSPARENT" },
      },
    };

    await persistGovernanceSnapshot({ scanId: "scan-4", snapshot });

    const args = createMock.mock.calls[0]![0];
    expect(args.data.rawState).toEqual({
      governor: { name: "TestGov", votingDelay: "7200" },
      proxy: { type: "EIP_1967_TRANSPARENT" },
    });
  });

  it("routes through a custom client when one is provided (transaction support)", async () => {
    const txFindFirst = vi
      .fn<SnapshotClient["governanceSnapshot"]["findFirst"]>()
      .mockResolvedValueOnce(null);
    const txCreate = vi
      .fn<SnapshotClient["governanceSnapshot"]["create"]>()
      .mockResolvedValueOnce(stubReturn({ scanId: "scan-5" }));
    const txUpdate = vi
      .fn<SnapshotClient["governanceSnapshot"]["update"]>();
    const txClient: SnapshotClient = {
      governanceSnapshot: {
        findFirst: txFindFirst,
        create: txCreate,
        update: txUpdate,
      },
    };

    await persistGovernanceSnapshot(
      { scanId: "scan-5", snapshot: minimalSnapshot },
      txClient,
    );

    expect(txFindFirst).toHaveBeenCalledOnce();
    expect(txCreate).toHaveBeenCalledOnce();
    expect(findFirstMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns the persisted GovernanceSnapshot row from create", async () => {
    const persistedRow = stubReturn({ id: "snap-999", scanId: "scan-6" });
    findFirstMock.mockResolvedValueOnce(null);
    createMock.mockResolvedValueOnce(persistedRow);

    const result = await persistGovernanceSnapshot({
      scanId: "scan-6",
      snapshot: fullSnapshot,
    });

    expect(result).toBe(persistedRow);
  });
});
