"use server";

import { runWithAuditContext } from "~/lib/auditContext";
import {
  completeMilestoneWithCascade,
  type CompleteMilestoneInput,
  type CompleteMilestoneResult,
} from "~/lib/services/milestoneCompletion";
import { getServerAuthSession } from "~/server/auth";

/**
 * Completes a milestone and, if confirmed, its active dependent test runs and
 * sessions, as well as descendant milestones. The work lives in
 * `lib/services/milestoneCompletion.ts`, which the API route shares.
 */
export async function completeMilestoneCascade(
  input: CompleteMilestoneInput
): Promise<CompleteMilestoneResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { status: "error", message: "User not authenticated" };
  }

  return runWithAuditContext(
    {
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      userEmail: session.user.email ?? undefined,
    },
    () => completeMilestoneWithCascade(session, input)
  );
}
