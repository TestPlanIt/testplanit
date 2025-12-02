import {
  getElasticsearchClient,
  getEntityIndexName,
} from "./unifiedElasticsearchService";
import { SearchableEntityType } from "~/types/search";
import type { Milestones, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "~/lib/prismaBase";
import { extractTextFromNode } from "~/utils/extractTextFromJson";

/**
 * Type for milestone with all required relations for indexing
 */
type MilestoneForIndexing = Milestones & {
  project: { name: string; iconUrl?: string | null };
  creator: { name: string; image?: string | null };
  milestoneType: { name: string; icon?: { name: string } | null };
  parent?: { name: string } | null;
};

/**
 * Index a single milestone to Elasticsearch
 * @param milestone - The milestone to index
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function indexMilestone(
  milestone: MilestoneForIndexing,
  tenantId?: string
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    throw new Error("Elasticsearch client not available");
  }

  const indexName = getEntityIndexName(SearchableEntityType.MILESTONE, tenantId);

  // Extract text from TipTap JSON for note and docs fields
  const noteText = milestone.note ? extractTextFromNode(milestone.note) : "";
  const docsText = milestone.docs ? extractTextFromNode(milestone.docs) : "";

  const searchableContent = [
    milestone.name,
    noteText,
    docsText,
  ].join(" ");


  const document = {
    id: milestone.id,
    projectId: milestone.projectId,
    projectName: milestone.project.name,
    projectIconUrl: milestone.project.iconUrl,
    name: milestone.name,
    note: noteText,
    docs: docsText,
    milestoneTypeId: milestone.milestoneTypesId,
    milestoneTypeName: milestone.milestoneType.name,
    milestoneTypeIcon: milestone.milestoneType.icon?.name,
    parentId: milestone.parentId,
    parentName: milestone.parent?.name,
    isCompleted: milestone.isCompleted,
    completedAt: milestone.completedAt,
    isDeleted: milestone.isDeleted,
    createdAt: milestone.createdAt,
    createdById: milestone.createdBy,
    createdByName: milestone.creator.name,
    createdByImage: milestone.creator.image,
    searchableContent,
  };

  await client.index({
    index: indexName,
    id: milestone.id.toString(),
    document,
    refresh: true,
  });
}

/**
 * Delete a milestone from Elasticsearch
 * @param milestoneId - The ID of the milestone to delete
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function deleteMilestoneFromIndex(
  milestoneId: number,
  tenantId?: string
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  const indexName = getEntityIndexName(SearchableEntityType.MILESTONE, tenantId);

  try {
    await client.delete({
      index: indexName,
      id: milestoneId.toString(),
      refresh: true,
    });
  } catch (error: any) {
    if (error.meta?.statusCode !== 404) {
      console.error("Failed to delete milestone from index:", error);
    }
  }
}

/**
 * Sync a single milestone to Elasticsearch
 * @param milestoneId - The ID of the milestone to sync
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function syncMilestoneToElasticsearch(
  milestoneId: number,
  tenantId?: string
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return false;
  }

  try {
    const milestone = await defaultPrisma.milestones.findUnique({
      where: { id: milestoneId },
      include: {
        project: true,
        creator: true,
        milestoneType: {
          include: {
            icon: true,
          },
        },
        parent: true,
      },
    });

    if (!milestone) {
      console.warn(`Milestone ${milestoneId} not found`);
      return false;
    }

    // Index milestone including deleted ones (filtering happens at search time based on admin permissions)

    // Index the milestone
    await indexMilestone(milestone as MilestoneForIndexing, tenantId);
    return true;
  } catch (error) {
    console.error(`Failed to sync milestone ${milestoneId}:`, error);
    return false;
  }
}

/**
 * Bulk index milestones for a project
 * @param projectId - The project ID to sync milestones for
 * @param db - Prisma client instance
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function syncProjectMilestonesToElasticsearch(
  projectId: number,
  db: any,
  tenantId?: string
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  const indexName = getEntityIndexName(SearchableEntityType.MILESTONE, tenantId);

  console.log(`Starting milestone sync for project ${projectId}${tenantId ? ` (tenant: ${tenantId})` : ""}`);

  const milestones = await db.milestones.findMany({
    where: {
      projectId: projectId,
      // Include deleted items (filtering happens at search time based on admin permissions)
    },
    include: {
      project: true,
      creator: true,
      milestoneType: {
        include: {
          icon: true,
        },
      },
      parent: true,
    },
  });

  if (milestones.length === 0) {
    console.log("No milestones to index");
    return;
  }

  const bulkBody = [];
  for (const milestone of milestones) {
    // Extract text from TipTap JSON for note and docs fields
    const noteText = milestone.note ? extractTextFromNode(milestone.note) : "";
    const docsText = milestone.docs ? extractTextFromNode(milestone.docs) : "";

    const searchableContent = [
      milestone.name,
      noteText,
      docsText,
    ].join(" ");


    bulkBody.push({
      index: {
        _index: indexName,
        _id: milestone.id.toString(),
      },
    });

    bulkBody.push({
      id: milestone.id,
      projectId: milestone.projectId,
      projectName: milestone.project.name,
      projectIconUrl: milestone.project.iconUrl,
      name: milestone.name,
      note: noteText,
      docs: docsText,
      milestoneTypeId: milestone.milestoneTypesId,
      milestoneTypeName: milestone.milestoneType.name,
      milestoneTypeIcon: milestone.milestoneType.icon?.name,
      parentId: milestone.parentId,
      parentName: milestone.parent?.name,
        isCompleted: milestone.isCompleted,
      completedAt: milestone.completedAt,
      isDeleted: milestone.isDeleted,
      createdAt: milestone.createdAt,
        createdById: milestone.createdBy,
      createdByName: milestone.createdBy.name,
      createdByImage: milestone.createdBy.image,
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
      console.log(`Successfully indexed ${milestones.length} milestones`);
    }
  } catch (error) {
    console.error("Failed to index milestones:", error);
  }
}

/**
 * Sync all milestones that have a specific parent
 * @param parentId - The parent milestone ID
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function syncChildMilestonesToElasticsearch(
  parentId: number,
  tenantId?: string
): Promise<void> {
  const client = getElasticsearchClient();
  if (!client) {
    console.warn("Elasticsearch client not available");
    return;
  }

  try {
    const childMilestones = await defaultPrisma.milestones.findMany({
      where: {
        parentId: parentId,
        // Include deleted items (filtering happens at search time based on admin permissions)
      },
    });

    for (const child of childMilestones) {
      await syncMilestoneToElasticsearch(child.id, tenantId);
    }
  } catch (error) {
    console.error(`Failed to sync child milestones of parent ${parentId}:`, error);
  }
}