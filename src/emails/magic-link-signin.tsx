import { EmailLayout } from "@/emails/_layout";

type MagicLinkSigninEmailProps = {
  url: string;
};

export function MagicLinkSigninEmail({ url }: MagicLinkSigninEmailProps) {
  return (
    <EmailLayout
      preview="Sign in to Breakwater"
      heading="Sign in to Breakwater"
      bodyText="Click the link below to sign in. This link expires in 24 hours."
      ctaLabel="Sign in to Breakwater"
      ctaUrl={url}
    />
  );
}

export default MagicLinkSigninEmail;
