import type { NextAuthOptions } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import EmailProvider from "next-auth/providers/email";
import { prisma } from "@/lib/prisma";

const fromEmail =
  process.env.RESEND_FROM_EMAIL ?? "Breakwater <noreply@breakwater.local>";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    EmailProvider({
      from: fromEmail,
      sendVerificationRequest: async ({ identifier, url }) => {
        console.log(`[auth] (dev) magic link for ${identifier}: ${url}`);
      },
      maxAge: 24 * 60 * 60,
    }),
  ],
  pages: {
    verifyRequest: "/auth/verify-request",
  },
};
