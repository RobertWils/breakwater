import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import { prisma } from "@/lib/prisma";
import { renderSigninEmail, renderSignupUnlockEmail } from "@/lib/email";
import {
  resend,
  fromEmail,
  isDevMode,
  assertProductionConfig,
  shouldUseSignupUnlockTemplate,
} from "@/lib/resend";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    EmailProvider({
      from: fromEmail,
      sendVerificationRequest: async ({ identifier, url }) => {
        assertProductionConfig();

        if (isDevMode()) {
          console.log(`[auth] (dev) magic link for ${identifier}: ${url}`);
          return;
        }

        const isScanUnlock = shouldUseSignupUnlockTemplate(url);

        console.log(
          `[auth] Using template: ${isScanUnlock ? "signup-unlock" : "signin"}`,
        );

        // TODO (Plan 02): extract protocol context from callbackUrl for
        // "You scanned <Protocol>" personalization in the signup-unlock template.

        const { html, subject } = isScanUnlock
          ? {
              html: await renderSignupUnlockEmail({ url }),
              subject: "Unlock your Breakwater scan findings",
            }
          : {
              html: await renderSigninEmail({ url }),
              subject: "Sign in to Breakwater",
            };

        // Narrowing: assertProductionConfig + isDevMode guarantee `resend`
        // is non-null here, but TypeScript can't follow that cross-file
        // invariant. A local check makes the assumption explicit and
        // surfaces any future flow-control regression loudly instead of
        // crashing on a null read.
        const client = resend;
        if (!client) {
          throw new Error(
            "[auth] Resend client unexpectedly null after production/dev checks. This indicates a bug in resend.ts or auth.ts flow control.",
          );
        }

        try {
          const result = await client.emails.send({
            from: fromEmail,
            to: identifier,
            subject,
            html,
            text: `${subject}: ${url}`,
          });

          if (result.error) {
            console.error("[auth] Resend error:", result.error);
            throw new Error(
              `Failed to send verification email: ${result.error.message}`,
            );
          }
        } catch (err) {
          console.error("[auth] Magic link delivery failed:", err);
          throw err;
        }
      },
      maxAge: 24 * 60 * 60,
    }),
  ],
  pages: {
    verifyRequest: "/auth/verify-request",
  },
};
