import {
  getElasticsearchClient,
  ENTITY_INDICES,
  createEntityIndex,
} from "./unifiedElasticsearchService";
import { SearchableEntityType } from "~/types/search";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { prisma as defaultPrisma } from "~/lib/prismaBase";

type PrismaClientType = typeof defaultPrisma;

/**
 * Document structure for shared steps in Elasticsearch
 */
export interface SharedStepDocument {
  id: number;
  name: string;
  projectId: number;
  projectName: string;
  projectIconUrl?: string | null;
  createdAt: Date;
  createdById: string;
  createdByName: string;
  createdByImage?: string | null;
  isDeleted: boolean;
  items: Array<{
    id: number;
    order: number;
    step: string;
    expectedResult: string;
  }>;
  searchableContent: string;
}

/**
 * Build a shared step document for Elasticsearch from Prisma data
 */
export async function buildSharedStepDocument(
  stepGroupId: number,
  prismaClient?: PrismaClientType
): Promise<SharedStepDocument | null> {
  const prisma = prismaClient || defaultPrisma;
  const stepGroup = await prisma.sharedStepGroup.findUnique({
    where: { id: stepGroupId },
    include: {
      project: true,
      createdBy: true,
      items: {
        orderBy: { order: "asc" },
      },
    },
  });

  if (!stepGroup) return null;

  // Build searchable content from name and step items
  const searchableContent = [
    stepGroup.name,
    ...stepGroup.items.map((item) => {
      let stepText = "";
      let expectedResultText = "";

      // Handle step field
      if (typeof item.step === "string") {
        try {
          const parsed = JSON.parse(item.step);
          stepText = extractTextFromNode(parsed);
        } catch {
          stepText = item.step;
        }
      } else if (item.step) {
        stepText = extractTextFromNode(item.step);
      }

      // Handle expectedResult field
      if (typeof item.expectedResult === "string") {
        try {
          const parsed = JSON.parse(item.expectedResult);
          expectedResultText = extractTextFromNode(parsed);
        } catch {
          expectedResultText = item.expectedResult;
        }
      } else if (item.expectedResult) {
        expectedResultText = extractTextFromNode(item.expectedResult);
      }

      return `${stepText} ${expectedResultText}`;
    }),
  ].join(" ");

  return {
    id: stepGroup.id,
    name: stepGroup.name,
    projectId: stepGroup.projectId,
    projectName: stepGroup.project.name,
    projectIconUrl: stepGroup.project.iconUrl,
    createdAt: stepGroup.createdAt,
    createdById: stepGroup.createdById,
    createdByName: stepGroup.createdBy.name,
    createdByImage: stepGroup.createdBy.image,
    isDeleted: stepGroup.isDeleted,
    items: stepGroup.items.map((item) => ({
      id: item.id,
      order: item.order,
      step:
        typeof item.step === "object"
          ? JSON.stringify(item.step)
          : String(item.step),
      expectedResult:
        typeof item.expectedResult === "object"
          ? JSON.stringify(item.expectedResult)
          : String(item.expectedResult),
    })),
    searchableContent,
  };
}

/**
 * Index a shared step group in Elasticsearch
 */
export async function indexSharedStep(
  stepData: SharedStepDocument
): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  try {
    await client.index({
      index: ENTITY_INDICES[SearchableEntityType.SHARED_STEP],
      id: stepData.id.toString(),
      document: stepData,
    });

    console.log(`Indexed shared step ${stepData.id} in Elasticsearch`);
    return true;
  } catch (error) {
    console.error(`Failed to index shared step ${stepData.id}:`, error);
    return false;
  }
}

/**
 * Delete a shared step from Elasticsearch
 */
export async function deleteSharedStep(stepId: number): Promise<boolean> {
  const client = getElasticsearchClient();
  if (!client) return false;

  try {
    await client.delete({
      index: ENTITY_INDICES[SearchableEntityType.SHARED_STEP],
      id: stepId.toString(),
    });

    console.log(`Deleted shared step ${stepId} from Elasticsearch`);
    return true;
  } catch (error) {
    // 404 is expected if document doesn't exist
    if ((error as any).statusCode === 404) {
      console.log(
        `Shared step ${stepId} not found in Elasticsearch (already deleted)`
      );
      return true;
    }
    console.error(`Failed to delete shared step ${stepId}:`, error);
    return false;
  }
}

/**
 * Sync a shared step to Elasticsearch after create/update
 */
export async function syncSharedStepToElasticsearch(
  stepId: number
): Promise<boolean> {
  const doc = await buildSharedStepDocument(stepId);
  if (!doc) return false;

  // Index shared step including deleted ones (filtering happens at search time based on admin permissions)
  return await indexSharedStep(doc);
}

/**
 * Sync all shared steps for a project to Elasticsearch
 */
export async function syncProjectSharedStepsToElasticsearch(
  projectId: number,
  batchSize: number = 100,
  prismaClient?: PrismaClientType
): Promise<boolean> {
  const prisma = prismaClient || defaultPrisma;
  try {
    // Ensure index exists
    await createEntityIndex(SearchableEntityType.SHARED_STEP);

    const totalSteps = await prisma.sharedStepGroup.count({
      where: {
        projectId,
        // Include deleted items (filtering happens at search time based on admin permissions)
      },
    });

    console.log(
      `Syncing ${totalSteps} shared steps for project ${projectId}...`
    );

    let processed = 0;
    let hasMore = true;

    while (hasMore) {
      const steps = await prisma.sharedStepGroup.findMany({
        where: {
          projectId,
          // Include deleted items (filtering happens at search time based on admin permissions)
        },
        skip: processed,
        take: batchSize,
        orderBy: { id: "asc" },
      });

      if (steps.length === 0) {
        hasMore = false;
        break;
      }

      // Build and index documents for this batch
      for (const step of steps) {
        const doc = await buildSharedStepDocument(step.id, prisma);
        if (doc) {
          await indexSharedStep(doc);
        }
      }

      processed += steps.length;
      console.log(`Indexed ${processed}/${totalSteps} shared steps...`);
    }

    console.log(
      `Successfully synced ${processed} shared steps to Elasticsearch`
    );
    return true;
  } catch (error) {
    console.error(
      "Error syncing project shared steps to Elasticsearch:",
      error
    );
    return false;
  }
}
