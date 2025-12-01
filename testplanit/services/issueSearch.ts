import {
  getElasticsearchClient,
  ENTITY_INDICES,
} from "./unifiedElasticsearchService";
import { SearchableEntityType } from "~/types/search";
import type { Issue } from "@prisma/client";
import { prisma } from "~/lib/prismaBase";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

/**
 * Type for issue with all required relations for indexing
 */
type IssueForIndexing = Issue & {
  createdBy: { name: string; image?: string | null };
  integration?: { name: string } | null;
  // Direct project relationship (preferred)
  project?: { id: number; name: string; iconUrl?: string | null } | null;
  // Fallback: Try to get project from any relationship
  repositoryCases?: Array<{
    project: { id: number; name: string; iconUrl?: string | null };
  }>;
  sessions?: Array<{
    project: { id: number; name: string; iconUrl?: string | null };
  }>;
  testRuns?: Array<{
    project: { id: number; name: string; iconUrl?: string | null };
  }>;
  sessionResults?: Array<{
    session: {
      project: { id: number; name: string; iconUrl?: string | null };
    };
  }>;
  testRunResults?: Array<{
    testRun: {
      project: { id: number; name: string; iconUrl?: string | null };
    };
  }>;
  testRunStepResults?: Array<{
    testRunResult: {
      testRun: {
        project: { id: number; name: string; iconUrl?: string | null };
      };
    };
  }>;
};

/**
 * Helper function to find project info from any issue relationship
 * Checks direct project relationship first, then falls back to relationship tables
 */
function getProjectFromIssue(issue: IssueForIndexing): {
  id: number;
  name: string;
  iconUrl?: string | null;
} | null {
  // Check direct project relationship first (most common and efficient)
  if (issue.project) {
    return issue.project;
  }

  // Fallback: Try repository cases
  if (issue.repositoryCases?.[0]?.project) {
    return issue.repositoryCases[0].project;
  }

  // Try sessions
  if (issue.sessions?.[0]?.project) {
    return issue.sessions[0].project;
  }

  // Try test runs
  if (issue.testRuns?.[0]?.project) {
    return issue.testRuns[0].project;
  }

  // Try session results
  if (issue.sessionResults?.[0]?.session?.project) {
    return issue.sessionResults[0].session.project;
  }

  // Try test run results
  if (issue.testRunResults?.[0]?.testRun?.project) {
    return issue.testRunResults[0].testRun.project;
  }

  // Try test run step results
  if (issue.testRunStepResults?.[0]?.testRunResult?.testRun?.project) {
    return issue.testRunStepResults[0].testRunResult.testRun.project;
  }

  return null;
}

/**
 * Index a single issue to Elasticsearch
 */
export async function indexIssue(issue: IssueForIndexing): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }

  // Try to get project info from any linked relationship
  const projectInfo = getProjectFromIssue(issue);

  // Skip indexing if no project is found (orphaned issue)
  if (!projectInfo) {
    console.warn(`Issue ${issue.id} (${issue.name}) has no linked project, skipping indexing`);
    return;
  }

  // Extract text from TipTap JSON for note field
  const noteText = issue.note ? extractTextFromNode(issue.note) : "";

  const searchableContent = [
    issue.name,
    issue.title,
    issue.description || "",
    issue.externalId || "",
    noteText,
    issue.integration?.name || "",
  ].join(" ");

  const document = {
    id: issue.id,
    projectId: projectInfo.id,
    projectName: projectInfo.name,
    projectIconUrl: projectInfo.iconUrl,
    name: issue.name,
    title: issue.title,
    description: issue.description,
    externalId: issue.externalId,
    note: noteText,
    url: (issue.data as any)?.url,
    issueSystem: issue.integration?.name || "Unknown",
    isDeleted: issue.isDeleted,
    createdAt: issue.createdAt,
    createdById: issue.createdById,
    createdByName: issue.createdBy.name,
    createdByImage: issue.createdBy.image,
    searchableContent,
  };

  await client.index({
    index: ENTITY_INDICES[SearchableEntityType.ISSUE],
    id: issue.id.toString(),
    document,
    refresh: true,
  });
}

/**
 * Delete an issue from Elasticsearch
 */
export async function deleteIssueFromIndex(issueId: number): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  try {
    await client.delete({
      index: ENTITY_INDICES[SearchableEntityType.ISSUE],
      id: issueId.toString(),
      refresh: true,
    });
  } catch (error: any) {
    if (error.meta?.statusCode !== 404) {
      console.error("Failed to delete issue from index:", error);
    }
  }
}

/**
 * Sync a single issue to Elasticsearch
 */
export async function syncIssueToElasticsearch(
  issueId: number
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }

  try {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        createdBy: true,
        integration: true,
        // Include direct project relationship (preferred)
        project: true,
        // Fallback: Check all possible relationships to find project
        repositoryCases: {
          take: 1,
          include: {
            project: true,
          },
        },
        sessions: {
          take: 1,
          include: {
            project: true,
          },
        },
        testRuns: {
          take: 1,
          include: {
            project: true,
          },
        },
        sessionResults: {
          take: 1,
          include: {
            session: {
              include: {
                project: true,
              },
            },
          },
        },
        testRunResults: {
          take: 1,
          include: {
            testRun: {
              include: {
                project: true,
              },
            },
          },
        },
        testRunStepResults: {
          take: 1,
          include: {
            testRunResult: {
              include: {
                testRun: {
                  include: {
                    project: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!issue) {
      console.warn(`Issue ${issueId} not found`);
      return false;
    }

    // Index issue including deleted ones (filtering happens at search time based on admin permissions)
    // Note: indexIssue will skip issues without a valid project link
    await indexIssue(issue as IssueForIndexing);
    return true;
  } catch (error) {
    console.error(`Failed to sync issue ${issueId}:`, error);
    return false;
  }
}

/**
 * Bulk index issues for a project
 */
export async function syncProjectIssuesToElasticsearch(
  projectId: number,
  db: any
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  console.log(`Starting issue sync for project ${projectId}`);

  // Find issues either by direct projectId or through any relationship
  const issues = await db.issue.findMany({
    where: {
      // Include deleted items (filtering happens at search time based on admin permissions)
      OR: [
        // Direct project relationship (preferred)
        { projectId, project: { isDeleted: false } },
        // Fallback: Find through relationships
        { repositoryCases: { some: { projectId, project: { isDeleted: false } } } },
        { sessions: { some: { projectId, isDeleted: false, project: { isDeleted: false } } } },
        { testRuns: { some: { projectId, isDeleted: false, project: { isDeleted: false } } } },
        { sessionResults: { some: { session: { projectId, isDeleted: false, project: { isDeleted: false } } } } },
        { testRunResults: { some: { testRun: { projectId, isDeleted: false, project: { isDeleted: false } } } } },
        {
          testRunStepResults: {
            some: { testRunResult: { testRun: { projectId, isDeleted: false, project: { isDeleted: false } } } },
          },
        },
      ],
    },
    include: {
      createdBy: true,
      integration: true,
      // Include direct project relationship (preferred)
      project: true,
      // Fallback relationships
      repositoryCases: {
        where: { projectId, project: { isDeleted: false } },
        take: 1,
        include: { project: true },
      },
      sessions: {
        where: { projectId, isDeleted: false, project: { isDeleted: false } },
        take: 1,
        include: { project: true },
      },
      testRuns: {
        where: { projectId, isDeleted: false, project: { isDeleted: false } },
        take: 1,
        include: { project: true },
      },
      sessionResults: {
        where: { session: { projectId, isDeleted: false, project: { isDeleted: false } } },
        take: 1,
        include: {
          session: {
            include: { project: true },
          },
        },
      },
      testRunResults: {
        where: { testRun: { projectId, isDeleted: false, project: { isDeleted: false } } },
        take: 1,
        include: {
          testRun: {
            include: { project: true },
          },
        },
      },
      testRunStepResults: {
        where: { testRunResult: { testRun: { projectId, isDeleted: false, project: { isDeleted: false } } } },
        take: 1,
        include: {
          testRunResult: {
            include: {
              testRun: {
                include: { project: true },
              },
            },
          },
        },
      },
    },
  });

  if (issues.length === 0) {
    console.log("No issues to index");
    return;
  }

  const bulkBody = [];
  let skippedCount = 0;

  for (const issue of issues) {
    // Try to get project info from any linked relationship
    const projectInfo = getProjectFromIssue(issue as IssueForIndexing);

    // Skip issues without a valid project link
    if (!projectInfo) {
      console.warn(`Issue ${issue.id} has no linked project, skipping`);
      skippedCount++;
      continue;
    }

    // Extract text from TipTap JSON for note field
    const noteText = issue.note ? extractTextFromNode(issue.note) : "";

    const searchableContent = [
      issue.name,
      issue.title,
      issue.description || "",
      issue.externalId || "",
      noteText,
      issue.integration?.name || "",
    ].join(" ");

    bulkBody.push({
      index: {
        _index: ENTITY_INDICES[SearchableEntityType.ISSUE],
        _id: issue.id.toString(),
      },
    });

    bulkBody.push({
      id: issue.id,
      projectId: projectInfo.id,
      projectName: projectInfo.name,
      projectIconUrl: projectInfo.iconUrl,
      name: issue.name,
      title: issue.title,
      description: issue.description,
      externalId: issue.externalId,
      note: noteText,
      url: (issue.data as any)?.url,
      issueSystem: issue.integration?.name || "Unknown",
      isDeleted: issue.isDeleted,
      createdAt: issue.createdAt,
      createdById: issue.createdById,
      createdByName: issue.createdBy.name,
      createdByImage: issue.createdBy.image,
      searchableContent,
    });
  }

  if (bulkBody.length === 0) {
    console.log(
      `No valid issues to index (${skippedCount} orphaned issues skipped)`
    );
    return;
  }

  try {
    const bulkResponse = await client.bulk({ body: bulkBody, refresh: true });
    if (bulkResponse.errors) {
      const errorItems = bulkResponse.items.filter(
        (item: any) => item.index?.error
      );
      console.error(`Bulk indexing errors: ${errorItems.length} failed documents`);
      // Log detailed error information
      errorItems.slice(0, 10).forEach((item: any) => {
        if (item.index?.error) {
          console.error(`  Failed to index document ${item.index._id}:`);
          console.error(`    Error type: ${item.index.error.type}`);
          console.error(`    Error reason: ${item.index.error.reason}`);
          if (item.index.error.caused_by) {
            console.error(`    Caused by: ${JSON.stringify(item.index.error.caused_by)}`);
          }
        }
      });
      if (errorItems.length > 10) {
        console.error(`  ... and ${errorItems.length - 10} more errors`);
      }
    } else {
      console.log(
        `Successfully indexed ${bulkBody.length / 2} issues (${skippedCount} orphaned issues skipped)`
      );
    }
  } catch (error) {
    console.error("Failed to index issues:", error);
  }
}
