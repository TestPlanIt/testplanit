import {
  getElasticsearchClient,
  ENTITY_INDICES,
} from "./unifiedElasticsearchService";
import { SearchableEntityType } from "~/types/search";
import type { Sessions, Prisma } from "@prisma/client";
import { prisma } from "~/lib/prismaBase";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

/**
 * Type for session with all required relations for indexing
 */
type SessionForIndexing = Sessions & {
  project: { name: string };
  createdBy: { name: string };
  assignedTo?: { name: string } | null;
  state: { name: string };
  template: { templateName: string };
  configuration?: { name: string } | null;
  milestone?: { name: string } | null;
  tags: Array<{ id: number; name: string }>;
  sessionFields?: Array<{
    fieldId: number;
    field: {
      displayName: string;
      systemName: string;
      type?: { type: string };
    };
    value: any;
  }>;
};

/**
 * Index a single session to Elasticsearch
 */
export async function indexSession(session: SessionForIndexing): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }

  // Extract text from TipTap JSON for note and mission fields
  const noteText = session.note ? extractTextFromNode(session.note) : "";
  const missionText = session.mission ? extractTextFromNode(session.mission) : "";

  const searchableContent = [
    session.name,
    noteText,
    missionText,
    session.tags.map((t) => t.name).join(" "),
  ].join(" ");


  const document = {
    id: session.id,
    projectId: session.projectId,
    projectName: session.project.name,
    templateId: session.templateId,
    templateName: session.template.templateName,
    name: session.name,
    note: noteText,
    mission: missionText,
    configId: session.configId,
    configurationName: session.configuration?.name,
    milestoneId: session.milestoneId,
    milestoneName: session.milestone?.name,
    stateId: session.stateId,
    stateName: session.state.name,
    assignedToId: session.assignedToId,
    assignedToName: session.assignedTo?.name,
    estimate: session.estimate,
    forecastManual: session.forecastManual,
    forecastAutomated: session.forecastAutomated,
    elapsed: session.elapsed,
    isCompleted: session.isCompleted,
    isDeleted: session.isDeleted,
    completedAt: session.completedAt,
    createdAt: session.createdAt,
    createdById: session.createdById,
    createdByName: session.createdBy.name,
    tags: session.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    searchableContent,
  };

  await client.index({
    index: ENTITY_INDICES[SearchableEntityType.SESSION],
    id: session.id.toString(),
    document,
    refresh: true,
  });
}

/**
 * Delete a session from Elasticsearch
 */
export async function deleteSessionFromIndex(sessionId: number): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  try {
    await client.delete({
      index: ENTITY_INDICES[SearchableEntityType.SESSION],
      id: sessionId.toString(),
      refresh: true,
    });
  } catch (error: any) {
    if (error.meta?.statusCode !== 404) {
      console.error("Failed to delete session from index:", error);
    }
  }
}

/**
 * Sync a single session to Elasticsearch
 */
export async function syncSessionToElasticsearch(sessionId: number): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }

  try {
    const session = await prisma.sessions.findUnique({
      where: { id: sessionId },
      include: {
        project: true,
        createdBy: true,
        assignedTo: true,
        state: true,
        template: true,
        configuration: true,
        milestone: true,
        tags: true,
      },
    });

    if (!session) {
      console.warn(`Session ${sessionId} not found`);
      return false;
    }

    // Index session including deleted ones (filtering happens at search time based on admin permissions)

    // Index the session
    await indexSession(session as SessionForIndexing);
    return true;
  } catch (error) {
    console.error(`Failed to sync session ${sessionId}:`, error);
    return false;
  }
}

/**
 * Bulk index sessions for a project
 */
export async function syncProjectSessionsToElasticsearch(
  projectId: number,
  db: any
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }


  const sessions = await db.sessions.findMany({
    where: {
      projectId: projectId,
      // Include deleted items (filtering happens at search time based on admin permissions)
    },
    include: {
      project: true,
      createdBy: true,
      assignedTo: true,
      state: true,
      template: true,
      configuration: true,
      milestone: true,
      tags: true,
    },
  });

  if (sessions.length === 0) {
    return;
  }

  const bulkBody = [];
  for (const session of sessions) {
    // Extract text from TipTap JSON for note and mission fields
    const noteText = session.note ? extractTextFromNode(session.note) : "";
    const missionText = session.mission ? extractTextFromNode(session.mission) : "";

    const searchableContent = [
      session.name,
      noteText,
      missionText,
      session.tags.map((t: any) => t.name).join(" "),
    ].join(" ");


    bulkBody.push({
      index: {
        _index: ENTITY_INDICES[SearchableEntityType.SESSION],
        _id: session.id.toString(),
      },
    });

    bulkBody.push({
      id: session.id,
      projectId: session.projectId,
      projectName: session.project.name,
      templateId: session.templateId,
      templateName: session.template.templateName,
      name: session.name,
      note: noteText,
      mission: missionText,
      configId: session.configId,
      configurationName: session.configuration?.name,
      milestoneId: session.milestoneId,
      milestoneName: session.milestone?.name,
      stateId: session.stateId,
      stateName: session.state.name,
      assignedToId: session.assignedToId,
      assignedToName: session.assignedTo?.name,
      estimate: session.estimate,
      forecastManual: session.forecastManual,
      forecastAutomated: session.forecastAutomated,
      elapsed: session.elapsed,
      isCompleted: session.isCompleted,
      isDeleted: session.isDeleted,
      completedAt: session.completedAt,
      createdAt: session.createdAt,
      createdById: session.createdById,
      createdByName: session.createdBy.name,
      tags: session.tags.map((tag: any) => ({ id: tag.id, name: tag.name })),
      searchableContent,
    });
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
      console.log(`Successfully indexed ${sessions.length} sessions`);
    }
  } catch (error) {
    console.error("Failed to bulk index sessions:", error);
    throw error;
  }
}

/**
 * Search for sessions
 */
export async function searchSessions(params: {
  query?: string;
  projectIds?: number[];
  templateIds?: number[];
  stateIds?: number[];
  assignedToIds?: string[];
  configurationIds?: number[];
  milestoneIds?: number[];
  isCompleted?: boolean;
  customFields?: Array<{
    fieldId: number;
    fieldType: string;
    operator: string;
    value: any;
    value2?: any;
  }>;
  from?: number;
  size?: number;
  sort?: Array<{ field: string; order: "asc" | "desc" }>;
}): Promise<{
  hits: any[];
  total: number;
  took: number;
}> {
  const client = getElasticsearchClient();
  if (!client) {
    return { hits: [], total: 0, took: 0 };
  }

  const must: any[] = [];
  const filter: any[] = [];

  // Add query
  if (params.query) {
    must.push({
      multi_match: {
        query: params.query,
        fields: [
          "name^3",
          "searchableContent",
          "note",
          "mission",
          "customFields.value",
        ],
        type: "best_fields",
        operator: "or",
        fuzziness: "AUTO",
      },
    });
  }

  // Add filters
  if (params.projectIds && params.projectIds.length > 0) {
    filter.push({ terms: { projectId: params.projectIds } });
  }
  if (params.templateIds && params.templateIds.length > 0) {
    filter.push({ terms: { templateId: params.templateIds } });
  }
  if (params.stateIds && params.stateIds.length > 0) {
    filter.push({ terms: { stateId: params.stateIds } });
  }
  if (params.assignedToIds && params.assignedToIds.length > 0) {
    filter.push({ terms: { assignedToId: params.assignedToIds } });
  }
  if (params.configurationIds && params.configurationIds.length > 0) {
    filter.push({ terms: { configId: params.configurationIds } });
  }
  if (params.milestoneIds && params.milestoneIds.length > 0) {
    filter.push({ terms: { milestoneId: params.milestoneIds } });
  }
  if (typeof params.isCompleted === "boolean") {
    filter.push({ term: { isCompleted: params.isCompleted } });
  }

  // Add custom field filters
  if (params.customFields) {
    // Implementation would be similar to repository case custom field filters
  }

  const searchBody: any = {
    index: ENTITY_INDICES[SearchableEntityType.SESSION],
    from: params.from || 0,
    size: params.size || 20,
    query: {
      bool: {
        must,
        filter,
      },
    },
    highlight: {
      fields: {
        name: { number_of_fragments: 1 },
        searchableContent: { number_of_fragments: 3 },
        note: { number_of_fragments: 2 },
        mission: { number_of_fragments: 2 },
      },
      pre_tags: ['<mark class="search-highlight">'],
      post_tags: ["</mark>"],
    },
  };

  // Add sorting
  if (params.sort && params.sort.length > 0) {
    searchBody.sort = params.sort.map((s) => ({
      [s.field]: { order: s.order },
    }));
  }

  try {
    const response = await client.search(searchBody);
    return {
      hits: response.hits.hits,
      total:
        typeof response.hits.total === "object"
          ? response.hits.total.value
          : response.hits.total || 0,
      took: response.took,
    };
  } catch (error) {
    console.error("Session search error:", error);
    return { hits: [], total: 0, took: 0 };
  }
}
