// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/scan-linking", () => ({
  linkAnonymousScans: vi.fn(),
}));

// Prisma must be mocked before auth.ts is imported (auth.ts imports prisma at module level).
vi.mock("@/lib/prisma", () => ({
  prisma: {
    scan: { updateMany: vi.fn() },
  },
}));

// auth.ts pulls in EmailProvider which requires nodemailer (peer dep not installed).
vi.mock("next-auth/providers/email", () => ({
  default: vi.fn(() => ({ id: "email", type: "email" })),
}));

// auth.ts pulls in PrismaAdapter from @auth/prisma-adapter.
vi.mock("@auth/prisma-adapter", () => ({
  PrismaAdapter: vi.fn(() => ({})),
}));

// auth.ts imports from @/lib/resend — stub the parts used at module eval time.
vi.mock("@/lib/resend", () => ({
  resend: null,
  fromEmail: "test@example.com",
  isDevMode: vi.fn(() => true),
  assertProductionConfig: vi.fn(),
  shouldUseSignupUnlockTemplate: vi.fn(() => false),
}));

// auth.ts imports from @/lib/email for template rendering.
vi.mock("@/lib/email", () => ({
  renderSigninEmail: vi.fn(),
  renderSignupUnlockEmail: vi.fn(),
}));

import { signInEvent } from "@/lib/auth";
import { linkAnonymousScans } from "@/lib/scan-linking";

const mockLink = linkAnonymousScans as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("signInEvent()", () => {
  it("calls linkAnonymousScans with userId and userEmail", async () => {
    mockLink.mockResolvedValueOnce({ linkedCount: 2, failedCount: 0 });

    await signInEvent({
      user: { id: "u1", email: "a@b.com" },
      account: null,
      isNewUser: false,
    });

    expect(mockLink).toHaveBeenCalledOnce();
    expect(mockLink).toHaveBeenCalledWith({
      userId: "u1",
      userEmail: "a@b.com",
    });
  });

  it("swallows errors from linkAnonymousScans and logs them", async () => {
    const thrown = new Error("DB down");
    mockLink.mockRejectedValueOnce(thrown);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Must not throw.
    await expect(
      signInEvent({
        user: { id: "u2", email: "fail@example.com" },
        account: null,
      }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[auth] Failed to link anonymous scans for user",
      "u2",
      thrown,
    );

    errorSpy.mockRestore();
  });
});
