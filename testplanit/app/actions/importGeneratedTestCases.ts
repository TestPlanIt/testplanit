"use server";

import {
  persistGeneratedTestCases,
  type ImportInput,
  type ImportResult,
} from "~/lib/services/testCaseImport";
import { getServerAuthSession } from "~/server/auth";
import { runWithAuditContext } from "~/lib/auditContext";

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

  // Establish the audit actor frame so trigger-based CDC records who imported.
  // The service mutates through the hooked client; injectAuditGuc reads the
  // actor from this ALS frame, which survives into the $extends hook tx.
  return runWithAuditContext({ userId: session.user.id }, () =>
    persistGeneratedTestCases(input, {
      userId: session.user.id,
      userName: session.user.name || "Unknown User",
    })
  );
}
