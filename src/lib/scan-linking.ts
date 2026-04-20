import { prisma } from "@/lib/prisma";

export type LinkResult =
  | { ok: true; linkedCount: number }
  | { ok: false; error: string };

export async function linkAnonymousScans(params: {
  userId: string;
  userEmail: string | null | undefined;
}): Promise<LinkResult> {
  if (!params.userEmail) {
    console.warn("[scan-linking] No email provided, skipping");
    return { ok: true, linkedCount: 0 };
  }

  const normalizedEmail = params.userEmail.toLowerCase().trim();

  try {
    const result = await prisma.scan.updateMany({
      where: {
        submittedByUserId: null,
        submittedEmail: normalizedEmail,
      },
      data: {
        submittedByUserId: params.userId,
      },
    });

    console.log(
      `[scan-linking] Linked ${result.count} anonymous scans to user ${params.userId}`,
    );

    return { ok: true, linkedCount: result.count };
  } catch (err) {
    console.error("[scan-linking] Transaction failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: message };
  }
}
