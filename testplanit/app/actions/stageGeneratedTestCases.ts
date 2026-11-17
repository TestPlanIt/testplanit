"use server";

import { stageGeneratedTestCasesForUser } from "~/lib/services/generatedCaseStaging";
import type {
  StageInput,
  StageResult,
} from "~/lib/services/stagedCaseFromGenerated";
import { getServerAuthSession } from "~/server/auth";

/**
 * Stage the generation wizard's selected test cases as the signed-in user's
 * staged cases, for review and creation later from My Staged Cases.
 */
export async function stageGeneratedTestCases(
  input: StageInput
): Promise<StageResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return {
      status: "error",
      message: "User not authenticated",
      stagedCount: 0,
      stagedIds: [],
      errors: [],
    };
  }
  return stageGeneratedTestCasesForUser(input, session.user.id);
}
