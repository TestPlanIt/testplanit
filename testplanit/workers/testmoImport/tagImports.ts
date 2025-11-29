import { Prisma } from "@prisma/client";
import type { TestmoMappingConfiguration } from "../../services/imports/testmo/types";
import { toNumberValue } from "./helpers";
import type { EntitySummaryResult } from "./types";

export async function importRepositoryCaseTags(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  caseIdMap: Map<number, number>
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "repositoryCaseTags",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const repositoryCaseTagRows = datasetRows.get("repository_case_tags") ?? [];

  for (const row of repositoryCaseTagRows) {
    summary.total += 1;

    const testmoCaseId = toNumberValue(row.case_id);
    const testmoTagId = toNumberValue(row.tag_id);

    if (!testmoCaseId || !testmoTagId) {
      continue;
    }

    // Resolve the mapped case ID
    const caseId = caseIdMap.get(testmoCaseId);
    if (!caseId) {
      // Case wasn't imported, skip this tag assignment
      continue;
    }

    // Resolve the mapped tag ID
    const tagConfig = configuration.tags?.[testmoTagId];
    if (!tagConfig || tagConfig.action !== "map" || !tagConfig.mappedTo) {
      // Tag wasn't imported/mapped, skip this assignment
      continue;
    }

    const tagId = tagConfig.mappedTo;

    // Check if assignment already exists
    const existing = await tx.repositoryCases.findFirst({
      where: {
        id: caseId,
        tags: {
          some: {
            id: tagId,
          },
        },
      },
    });

    if (existing) {
      summary.mapped += 1;
      continue;
    }

    // Create the tag assignment by connecting the tag to the case
    await tx.repositoryCases.update({
      where: { id: caseId },
      data: {
        tags: {
          connect: { id: tagId },
        },
      },
    });

    summary.created += 1;
  }

  return summary;
}

export async function importRunTags(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  testRunIdMap: Map<number, number>
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "runTags",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const runTagRows = datasetRows.get("run_tags") ?? [];

  for (const row of runTagRows) {
    summary.total += 1;

    const testmoRunId = toNumberValue(row.run_id);
    const testmoTagId = toNumberValue(row.tag_id);

    if (!testmoRunId || !testmoTagId) {
      continue;
    }

    // Resolve the mapped run ID
    const runId = testRunIdMap.get(testmoRunId);
    if (!runId) {
      // Run wasn't imported, skip this tag assignment
      continue;
    }

    // Resolve the mapped tag ID
    const tagConfig = configuration.tags?.[testmoTagId];
    if (!tagConfig || tagConfig.action !== "map" || !tagConfig.mappedTo) {
      // Tag wasn't imported/mapped, skip this assignment
      continue;
    }

    const tagId = tagConfig.mappedTo;

    // Check if assignment already exists
    const existing = await tx.testRuns.findFirst({
      where: {
        id: runId,
        tags: {
          some: {
            id: tagId,
          },
        },
      },
    });

    if (existing) {
      summary.mapped += 1;
      continue;
    }

    // Create the tag assignment by connecting the tag to the run
    await tx.testRuns.update({
      where: { id: runId },
      data: {
        tags: {
          connect: { id: tagId },
        },
      },
    });

    summary.created += 1;
  }

  return summary;
}

export async function importSessionTags(
  tx: Prisma.TransactionClient,
  configuration: TestmoMappingConfiguration,
  datasetRows: Map<string, any[]>,
  sessionIdMap: Map<number, number>
): Promise<EntitySummaryResult> {
  const summary: EntitySummaryResult = {
    entity: "sessionTags",
    total: 0,
    created: 0,
    mapped: 0,
  };

  const sessionTagRows = datasetRows.get("session_tags") ?? [];

  for (const row of sessionTagRows) {
    summary.total += 1;

    const testmoSessionId = toNumberValue(row.session_id);
    const testmoTagId = toNumberValue(row.tag_id);

    if (!testmoSessionId || !testmoTagId) {
      continue;
    }

    // Resolve the mapped session ID
    const sessionId = sessionIdMap.get(testmoSessionId);
    if (!sessionId) {
      // Session wasn't imported, skip this tag assignment
      continue;
    }

    // Resolve the mapped tag ID
    const tagConfig = configuration.tags?.[testmoTagId];
    if (!tagConfig || tagConfig.action !== "map" || !tagConfig.mappedTo) {
      // Tag wasn't imported/mapped, skip this assignment
      continue;
    }

    const tagId = tagConfig.mappedTo;

    // Check if assignment already exists
    const existing = await tx.sessions.findFirst({
      where: {
        id: sessionId,
        tags: {
          some: {
            id: tagId,
          },
        },
      },
    });

    if (existing) {
      summary.mapped += 1;
      continue;
    }

    // Create the tag assignment by connecting the tag to the session
    await tx.sessions.update({
      where: { id: sessionId },
      data: {
        tags: {
          connect: { id: tagId },
        },
      },
    });

    summary.created += 1;
  }

  return summary;
}

// NOTE: importMilestoneAutomationTags cannot be implemented because the Milestones model
// does not have a tags relation in the schema. This would require a schema change first.
// The Testmo dataset "milestone_automation_tags" exists but cannot be imported.
