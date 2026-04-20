import { prisma } from "@/lib/prisma";

export async function linkAnonymousScans(params: {
  userId: string;
  userEmail: string | null | undefined;
}): Promise<{ linkedCount: number; failedCount: number }> {
  if (!params.userEmail) {
    console.warn("[scan-linking] No email provided, skipping");
    return { linkedCount: 0, failedCount: 0 };
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

    return { linkedCount: result.count, failedCount: 0 };
  } catch (err) {
    console.error("[scan-linking] Transaction failed:", err);
    return { linkedCount: 0, failedCount: -1 };
  }
}
