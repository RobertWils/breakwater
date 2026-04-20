import "next-auth";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      organizationId: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    /**
     * Optional in type signature to satisfy @auth/core's AdapterUser
     * base type, which declares all custom fields as optional.
     *
     * At runtime, Prisma always returns the organizationId column
     * (null or string ID), so this value is present but may be null.
     *
     * Never access as `user.organizationId!` in code — always handle
     * the null case explicitly.
     */
    organizationId?: string | null;
  }
}
