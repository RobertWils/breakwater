import { describe, it, expect } from "vitest";
import { renderSigninEmail } from "@/lib/email";

describe("magic-link-signin email template", () => {
  const testUrl =
    "https://breakwater.example/api/auth/callback/email?token=abc123";

  it("renders without errors", async () => {
    await expect(renderSigninEmail({ url: testUrl })).resolves.toBeTruthy();
  });

  it("contains the magic link URL", async () => {
    const html = await renderSigninEmail({ url: testUrl });
    expect(html).toContain(testUrl);
  });

  it('contains "Sign in to Breakwater" heading text', async () => {
    const html = await renderSigninEmail({ url: testUrl });
    expect(html).toContain("Sign in to Breakwater");
  });

  it("brand colors present", async () => {
    const html = await renderSigninEmail({ url: testUrl });
    expect(html).toContain("#0C1C3A");
    expect(html).toContain("#14B8A6");
  });
});
