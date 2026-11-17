import { sql } from "kysely";
import type { RiskDb } from "./types";

export interface PriorityUsageRow {
  /** Normalized (trimmed, lowercased) effective priority string. */
  value: string;
  /** Live case-issue links carrying it in the project. */
  count: number;
}

/**
 * The distinct effective priority strings in use across the project's linked
 * issues, most used first — the vocabulary the priority-weight mapping offers
 * to configure. Mirrors the scorer's effective-priority rule: a synced,
 * non-detached requirement shows the tracker's priority, everything else the
 * local one.
 */
export async function getProjectPriorityUsage(
  db: RiskDb,
  projectId: number
): Promise<PriorityUsageRow[]> {
  const result = await sql<{ value: string | null; count: number }>`
    SELECT LOWER(TRIM(CASE
        WHEN i."isRequirement" = true
          AND i."integrationId" IS NOT NULL
          AND i."requirementDetachedAt" IS NULL
        THEN COALESCE(i."externalPriority", i.priority)
        ELSE COALESCE(i.priority, i."externalPriority")
      END)) AS value,
      COUNT(*)::int AS count
    FROM "RepositoryCaseIssue" rci
    JOIN "RepositoryCases" rc ON rc.id = rci."caseId"
      AND rc."projectId" = ${projectId}
      AND rc."isDeleted" = false
      AND rc."isArchived" = false
    JOIN "Issue" i ON i.id = rci."issueId" AND i."isDeleted" = false
    GROUP BY 1
    ORDER BY count DESC, value ASC
  `.execute(db.$qb);
  return result.rows
    .filter((row): row is { value: string; count: number } =>
      Boolean(row.value)
    )
    .map((row) => ({ value: row.value, count: Number(row.count) }));
}
