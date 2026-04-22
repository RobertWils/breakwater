import { createElement } from "react";
import { render } from "@react-email/components";
import { MagicLinkSigninEmail } from "@/emails/magic-link-signin";
import { MagicLinkSignupUnlockEmail } from "@/emails/magic-link-signup-unlock";

export async function renderSigninEmail({
  url,
}: {
  url: string;
}): Promise<string> {
  return render(createElement(MagicLinkSigninEmail, { url }));
}

export async function renderSignupUnlockEmail({
  url,
}: {
  url: string;
}): Promise<string> {
  return render(createElement(MagicLinkSignupUnlockEmail, { url }));
}
