"use server";

import {
  fetchQuickScriptCases,
  type QuickScriptCaseData,
} from "~/lib/services/quickscript-generation";
import { getServerAuthSession } from "~/server/auth";

export async function fetchCasesForQuickScript(args: {
  caseIds: number[];
  projectId: number;
}): Promise<
  | { success: true; data: QuickScriptCaseData[] }
  | { success: false; error: string; data: [] }
> {
  const session = await getServerAuthSession();
  if (!session?.user) {
    return { success: false, error: "Unauthorized", data: [] };
  }

  try {
    const data = await fetchQuickScriptCases(args.projectId, args.caseIds);
    return { success: true, data };
  } catch (error) {
    console.error("Failed to fetch cases for QuickScript:", error);
    return { success: false, error: "Failed to fetch cases", data: [] };
  }
}
