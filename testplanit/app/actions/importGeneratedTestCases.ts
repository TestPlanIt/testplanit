"use server";

import {
  persistGeneratedTestCases,
  type ImportInput,
  type ImportResult,
} from "~/lib/services/testCaseImport";
import { getServerAuthSession } from "~/server/auth";

export type { ImportInput, ImportResult } from "~/lib/services/testCaseImport";

export async function importGeneratedTestCases(
  input: ImportInput
): Promise<ImportResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return {
      status: "error",
      message: "User not authenticated",
      importedCount: 0,
      importedIds: [],
      errors: [],
    };
  }

  return persistGeneratedTestCases(input, {
    userId: session.user.id,
    userName: session.user.name || "Unknown User",
  });
}
