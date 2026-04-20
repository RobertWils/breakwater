import { describe, it, expect } from "vitest";
import { shouldUseSignupUnlockTemplate } from "@/lib/resend";

// Helper: build a realistic NextAuth magic-link URL with an encoded callbackUrl.
function magicLink(callbackUrl?: string): string {
  const base =
    "http://localhost:3000/api/auth/callback/email?token=testtoken123&email=test%40example.com";
  if (callbackUrl === undefined) return base;
  return `${base}&callbackUrl=${encodeURIComponent(callbackUrl)}`;
}

describe("shouldUseSignupUnlockTemplate()", () => {
  it("returns true for /scan/ path with unlock=true", () => {
    expect(
      shouldUseSignupUnlockTemplate(
        magicLink("/scan/abc-123?unlock=true"),
      ),
    ).toBe(true);
  });

  it("returns false for /scan/ path without unlock=true", () => {
    expect(
      shouldUseSignupUnlockTemplate(magicLink("/scan/abc-123")),
    ).toBe(false);
  });

  it("returns false for root callbackUrl", () => {
    expect(shouldUseSignupUnlockTemplate(magicLink("/"))).toBe(false);
  });

  it("returns false when callbackUrl is absent", () => {
    expect(shouldUseSignupUnlockTemplate(magicLink())).toBe(false);
  });

  it("returns true for nested /scan/ sub-path with unlock=true", () => {
    expect(
      shouldUseSignupUnlockTemplate(
        magicLink("/scan/abc-123/some-other-thing?unlock=true"),
      ),
    ).toBe(true);
  });

  it("returns false for non-scan path even with unlock=true", () => {
    expect(
      shouldUseSignupUnlockTemplate(magicLink("/other/path?unlock=true")),
    ).toBe(false);
  });
});
