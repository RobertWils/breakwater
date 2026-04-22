import { describe, it, expect } from "vitest";
import { renderSignupUnlockEmail } from "@/lib/email";

describe("magic-link-signup-unlock email template", () => {
  // React Email HTML-encodes & as &amp; inside href attributes, so the URL
  // below has no bare & — it is a realistic NextAuth token URL that happens
  // to have no additional query params after callbackUrl.
  const testUrl =
    "https://breakwater.example/api/auth/callback/email?callbackUrl=%2Fscan%2Fabc-123%3Funlock%3Dtrue";

  it("renders without errors", async () => {
    await expect(
      renderSignupUnlockEmail({ url: testUrl }),
    ).resolves.toBeTruthy();
  });

  it("contains the magic link URL", async () => {
    const html = await renderSignupUnlockEmail({ url: testUrl });
    expect(html).toContain(testUrl);
  });

  it('contains "Unlock your scan findings" heading text', async () => {
    const html = await renderSignupUnlockEmail({ url: testUrl });
    expect(html).toContain("Unlock your scan findings");
  });

  it('CTA label text "View your scan findings" present', async () => {
    const html = await renderSignupUnlockEmail({ url: testUrl });
    expect(html).toContain("View your scan findings");
  });

  it("brand colors present", async () => {
    const html = await renderSignupUnlockEmail({ url: testUrl });
    expect(html).toContain("#0C1C3A");
    expect(html).toContain("#14B8A6");
  });
});
