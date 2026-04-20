import { describe, it, expect } from "vitest";
import { renderMagicLinkEmail } from "@/lib/email";

describe("magic-link email template", () => {
  const testUrl = "https://breakwater.example/auth/callback/email?token=abc123";

  it("renders the magic link URL", async () => {
    const html = await renderMagicLinkEmail({ url: testUrl });
    expect(html).toContain(testUrl);
  });

  it("includes the signin heading/CTA copy", async () => {
    const html = await renderMagicLinkEmail({ url: testUrl });
    expect(html).toContain("Sign in to Breakwater");
  });

  it("applies the Breakwater dark palette", async () => {
    const html = await renderMagicLinkEmail({ url: testUrl });
    expect(html).toContain("#0C1C3A");
    expect(html).toContain("#14B8A6");
  });
});
