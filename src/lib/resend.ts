import { Resend } from "resend";

export const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// Module-level (not Strategy B): fromEmail is static per deploy and
// doesn't need runtime re-evaluation the way the devMode checks do.
export const fromEmail =
  process.env.EMAIL_FROM ?? "Breakwater <noreply@breakwater.local>";

// Reads env at call time so tests can override process.env.
export function isDevMode(): boolean {
  const hasKey = Boolean(process.env.RESEND_API_KEY);
  if (!hasKey) return true;
  if (
    process.env.NODE_ENV === "development" &&
    process.env.FORCE_RESEND_IN_DEV !== "1"
  ) {
    return true;
  }
  return false;
}

// Reads env at call time so tests can override process.env.
export function assertProductionConfig(): void {
  if (process.env.NODE_ENV === "production" && !process.env.RESEND_API_KEY) {
    throw new Error(
      "[auth] RESEND_API_KEY is required in production. Magic link delivery cannot proceed.",
    );
  }
}

/**
 * Returns true when the magic-link URL indicates the user is arriving
 * from a scan-unlock flow (callbackUrl contains /scan/ and unlock=true).
 * Accepts the full NextAuth magic-link URL; callbackUrl is URL-encoded in
 * the query string and decoded automatically by URLSearchParams.
 */
export function shouldUseSignupUnlockTemplate(url: string): boolean {
  let callbackUrl: string | null;
  try {
    callbackUrl = new URL(url).searchParams.get("callbackUrl");
  } catch {
    return false;
  }
  if (!callbackUrl) return false;
  // Parse callbackUrl as a relative URL so /scan/ and unlock=true checks
  // work on the decoded path+query (not URL-encoded variants).
  return (
    callbackUrl.includes("/scan/") && callbackUrl.includes("unlock=true")
  );
}
