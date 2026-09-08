"use server";

import { getEnhancedDb } from "~/lib/auth/utils";
import { getLatestTestResultsByCase } from "~/lib/services/latestTestResults";
import { LATEST_RESULTS_COUNT } from "~/lib/types/latestTestResults";
import { getServerAuthSession } from "~/server/auth";

/**
 * The most recent executions for each of the given cases, keyed by case id.
 *
 * The ranking query runs on the raw client — it spans TestRunResults and
 * JUnitTestResult and cannot go through the policy layer — so the ids are first
 * narrowed to those the caller is actually allowed to read.
 */
export async function fetchLatestTestResults(
  caseIds: number[],
  limit: number = LATEST_RESULTS_COUNT
) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { success: false, error: "Unauthorized", data: {} };
  }

  if (!caseIds.length) {
    return { success: true, data: {} };
  }

  try {
    const db = await getEnhancedDb(session);
    const visible = await db.repositoryCases.findMany({
      where: { id: { in: caseIds }, isDeleted: false },
      select: { id: true },
    });

    const byCase = await getLatestTestResultsByCase(
      visible.map((c: { id: number }) => c.id),
      limit
    );

    return { success: true, data: Object.fromEntries(byCase) };
  } catch (error) {
    console.error("Error fetching latest test results:", error);
    return { success: false, error: "Failed to fetch results", data: {} };
  }
}
