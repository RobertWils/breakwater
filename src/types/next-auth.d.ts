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
    organizationId?: string | null;
  }
}
