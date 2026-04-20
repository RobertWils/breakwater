import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { renderMagicLinkEmail } from "@/lib/email";

const fromEmail =
  process.env.RESEND_FROM_EMAIL ?? "Breakwater <noreply@breakwater.local>";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    EmailProvider({
      from: fromEmail,
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        const devMode =
          !resend ||
          (process.env.NODE_ENV === "development" &&
            process.env.FORCE_RESEND_IN_DEV !== "1");

        if (devMode) {
          console.log(`[auth] (dev) magic link for ${identifier}: ${url}`);
          return;
        }

        try {
          const result = await resend.emails.send({
            from: provider.from,
            to: identifier,
            subject: "Sign in to Breakwater",
            html: await renderMagicLinkEmail({ url }),
            text: `Sign in to Breakwater: ${url}`,
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
