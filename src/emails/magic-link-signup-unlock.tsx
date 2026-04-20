import { EmailLayout } from "@/emails/_layout";

type MagicLinkSignupUnlockEmailProps = {
  url: string;
};

export function MagicLinkSignupUnlockEmail({
  url,
}: MagicLinkSignupUnlockEmailProps) {
  return (
    <EmailLayout
      preview="Unlock your Breakwater scan findings"
      heading="Unlock your scan findings"
      bodyText="Your Breakwater security scan is ready. Click below to view the full findings. This link expires in 24 hours."
      ctaLabel="View your scan findings"
      ctaUrl={url}
      // TODO (Plan 02): pass protocol name here for "You scanned <Protocol>" personalization.
    />
  );
}

export default MagicLinkSignupUnlockEmail;
