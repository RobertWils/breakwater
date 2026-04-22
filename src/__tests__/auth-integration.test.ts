// @vitest-environment node
// Integration test for the scan-linking flow invoked by NextAuth's
// events.signIn callback. Uses the real Prisma client against
// DATABASE_URL — skipped cleanly in CI when DATABASE_URL is unset.
//
// Scope: exercise signInEvent end-to-end at the DB layer. Does NOT go
// through NextAuth HTTP endpoints (no server boot, no session cookies,
// no Resend). The goal is to validate OUR code path — linkAnonymousScans
// called from the signIn event — not NextAuth internals.

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { randomBytes } from "node:crypto";
import { Chain, OwnershipStatus } from "@prisma/client";

// auth.ts imports EmailProvider at module top-level, which require()s
// nodemailer — a peer dep not installed in this workspace. signInEvent
// itself never touches email delivery, so stubbing the provider factory
// is safe and keeps the test focused on the scan-linking path.
vi.mock("next-auth/providers/email", () => ({
  default: vi.fn(() => ({ id: "email", type: "email" })),
}));

// @auth/prisma-adapter is only needed to build authOptions.adapter.
// signInEvent doesn't call it — stub it out to keep the import graph
// clean and avoid any adapter-side state during the test.
vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn(() => ({})),
}));

// @/lib/resend reads process.env at module eval time for client init.
// Stubbing avoids triggering any env validation the real resend.ts
// performs on import. signInEvent path doesn't touch Resend.
vi.mock("@/lib/resend", () => ({
  resend: null,
  fromEmail: "test@example.com",
  isDevMode: vi.fn(() => true),
  assertProductionConfig: vi.fn(),
  shouldUseSignupUnlockTemplate: vi.fn(() => false),
}));

// @/lib/email renders React Email templates — not exercised by
// signInEvent. Stub for symmetry with auth-callbacks.test.ts.
vi.mock("@/lib/email", () => ({
  renderSigninEmail: vi.fn(),
  renderSignupUnlockEmail: vi.fn(),
}));

// IMPORTANT: prisma and scan-linking are NOT mocked. We want real
// DB writes to verify the full flow.
import { prisma } from "@/lib/prisma";
import { signInEvent } from "@/lib/auth";

const hasDb = !!process.env.DATABASE_URL;

// `describe.skipIf(condition)` skips the suite when the condition is
// truthy — Vitest 4 supports this at the describe level. When
// DATABASE_URL is unset we want to skip, so the condition we pass is
// `!hasDb` ("skip if no DB").
describe.skipIf(!hasDb)("auth integration — signInEvent scan linking", () => {
  // Unique per-test-run email prefix keeps concurrent / repeated runs
  // from colliding on the User.email unique index or Scan.submittedEmail
  // matching rows leftover from a crashed prior run.
  const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  const testEmail = `test-${runId}@breakwater.test`;
  const otherEmail = `other-${runId}@breakwater.test`;

  // Fresh Protocol per run — seed protocols are shared, we want full
  // isolation so the afterAll cleanup can delete it without touching
  // anything real.
  let protocolId: string;

  // Track every ID we create so cleanup is deterministic even if a
  // test aborts mid-way. Cleanup is idempotent: deleteMany on an
  // already-empty set is a no-op.
  const createdUserIds: string[] = [];
  const createdScanIds: string[] = [];
  const createdOtherUserIds: string[] = [];

  beforeEach(async () => {
    // Create an UNCLAIMED protocol for scan foreign keys. Using
    // randomBytes in the contract address keeps each run isolated
    // from concurrent runs against the same DB.
    const contractAddress = `0x${randomBytes(20).toString("hex")}`;
    const proto = await prisma.protocol.create({
      data: {
        slug: `test-linking-${runId}`,
        displayName: "Integration Test Protocol",
        chain: Chain.ETHEREUM,
        primaryContractAddress: contractAddress,
        extraContractAddresses: [],
        ownershipStatus: OwnershipStatus.UNCLAIMED,
      },
    });
    protocolId = proto.id;
  });

  afterEach(async () => {
    // Order matters: Scan.submittedByUserId → User, and
    // Scan.protocolId → Protocol. Delete scans first, then users,
    // then the protocol. deleteMany is idempotent — safe even when
    // the test already cleaned up.
    if (createdScanIds.length) {
      await prisma.scan.deleteMany({
        where: { id: { in: createdScanIds } },
      });
      createdScanIds.length = 0;
    }

    const allUserIds = [...createdUserIds, ...createdOtherUserIds];
    if (allUserIds.length) {
      // Sessions / accounts reference User; we don't create any
      // directly (signInEvent doesn't), but clean just in case a
      // future change adds them. Cascade-deletes handle it at the
      // DB level, but being explicit here guards against a schema
      // change that drops the cascade.
      await prisma.session.deleteMany({
        where: { userId: { in: allUserIds } },
      });
      await prisma.account.deleteMany({
        where: { userId: { in: allUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: allUserIds } },
      });
      createdUserIds.length = 0;
      createdOtherUserIds.length = 0;
    }

    // Protocol cleanup per test — each `beforeEach` creates a fresh
    // one. If a beforeEach failed before creating the protocol,
    // protocolId is still set from a previous iteration but that row
    // was already deleted; deleteMany on an empty match is a no-op.
    if (protocolId) {
      await prisma.protocol.deleteMany({ where: { id: protocolId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Helper: create a scan with the spec-required fields. Reading
  // prisma/schema.prisma, Scan requires: protocolId, ipHash,
  // userAgent, expiresAt. All others are optional / defaulted.
  async function createScan(params: {
    submittedEmail: string | null;
    submittedByUserId: string | null;
  }) {
    const scan = await prisma.scan.create({
      data: {
        protocolId,
        submittedEmail: params.submittedEmail,
        submittedByUserId: params.submittedByUserId,
        ipHash: "test-ip-hash",
        userAgent: "integration-test/1.0",
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    createdScanIds.push(scan.id);
    return scan;
  }

  it("links a single anonymous scan to a newly signed-in user", async () => {
    // Arrange: one anonymous scan + a matching user.
    const anonScan = await createScan({
      submittedEmail: testEmail,
      submittedByUserId: null,
    });

    const user = await prisma.user.create({
      data: { email: testEmail },
    });
    createdUserIds.push(user.id);

    // Act: simulate the NextAuth signIn event firing after magic-link
    // verification. signInEvent calls linkAnonymousScans internally.
    await signInEvent({
      user: { id: user.id, email: user.email, organizationId: null },
      account: null,
      isNewUser: true,
    });

    // Assert: the scan is now bound to the user.
    const after = await prisma.scan.findUnique({ where: { id: anonScan.id } });
    expect(after).not.toBeNull();
    expect(after!.submittedByUserId).toBe(user.id);
  });

  it("links all anonymous scans for the same email in one pass", async () => {
    // Arrange: 3 anonymous scans, same email, no user yet.
    const scans = await Promise.all([
      createScan({ submittedEmail: testEmail, submittedByUserId: null }),
      createScan({ submittedEmail: testEmail, submittedByUserId: null }),
      createScan({ submittedEmail: testEmail, submittedByUserId: null }),
    ]);

    const user = await prisma.user.create({ data: { email: testEmail } });
    createdUserIds.push(user.id);

    // Act.
    await signInEvent({
      user: { id: user.id, email: user.email, organizationId: null },
      account: null,
      isNewUser: true,
    });

    // Assert: all 3 scans now reference this user. Query by id-set,
    // not by email, so we isolate to the rows this test created.
    const after = await prisma.scan.findMany({
      where: { id: { in: scans.map((s) => s.id) } },
    });
    expect(after).toHaveLength(3);
    for (const scan of after) {
      expect(scan.submittedByUserId).toBe(user.id);
    }
  });

  it("does not re-bind scans already claimed by a different user", async () => {
    // Arrange: another user already owns a scan under their own email.
    const otherUser = await prisma.user.create({
      data: { email: otherEmail },
    });
    createdOtherUserIds.push(otherUser.id);

    const otherScan = await createScan({
      submittedEmail: otherEmail,
      submittedByUserId: otherUser.id,
    });

    // Plus an anonymous scan for our test email.
    const ownAnonScan = await createScan({
      submittedEmail: testEmail,
      submittedByUserId: null,
    });

    // New user for testEmail signs in.
    const user = await prisma.user.create({ data: { email: testEmail } });
    createdUserIds.push(user.id);

    // Act.
    await signInEvent({
      user: { id: user.id, email: user.email, organizationId: null },
      account: null,
      isNewUser: true,
    });

    // Assert: other user's scan is untouched.
    const otherAfter = await prisma.scan.findUnique({
      where: { id: otherScan.id },
    });
    expect(otherAfter!.submittedByUserId).toBe(otherUser.id);

    // Our anonymous scan is linked to the new user.
    const ownAfter = await prisma.scan.findUnique({
      where: { id: ownAnonScan.id },
    });
    expect(ownAfter!.submittedByUserId).toBe(user.id);
  });
});
