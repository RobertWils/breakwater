import { createElement } from "react";
import { render } from "@react-email/components";
import { MagicLinkEmail } from "@/emails/magic-link";

export async function renderMagicLinkEmail({
  url,
}: {
  url: string;
}): Promise<string> {
  return render(createElement(MagicLinkEmail, { url }));
}
