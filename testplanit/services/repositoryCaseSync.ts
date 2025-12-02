import {
  createRepositoryCaseIndex,
  RepositoryCaseDocument,
} from "./elasticsearchService";
import {
  indexRepositoryCase,
  deleteRepositoryCase,
  bulkIndexRepositoryCases,
} from "./elasticsearchIndexing";
import { extractTextFromNode } from "../utils/extractTextFromJson";
import { buildCustomFieldDocuments } from "./unifiedElasticsearchService";
import { prisma as defaultPrisma } from "../lib/prismaBase";

type PrismaClientType = typeof defaultPrisma;

/**
 * Safely extract text from a step field that might be JSON string or object
 */
function extractStepText(stepData: any): string {
  if (!stepData) return "";

  try {
    // If it's a string, try to parse it as JSON
    if (typeof stepData === "string") {
      const parsed = JSON.parse(stepData);
      return extractTextFromNode(parsed);
    }
    // Otherwise, assume it's already an object
    return extractTextFromNode(stepData);
  } catch (error) {
    // If parsing fails, return the original string
    return typeof stepData === "string" ? stepData : "";
  }
}

/**
 * Build a repository case document for Elasticsearch from Prisma data
 */
export async function buildRepositoryCaseDocument(
  caseId: number,
  prismaClient?: PrismaClientType
): Promise<RepositoryCaseDocument | null> {
  const prisma = prismaClient || defaultPrisma;
  const repoCase = await prisma.repositoryCases.findUnique({
    where: { id: caseId },
    include: {
      project: true,
      folder: true,
      template: true,
      state: {
        include: {
          icon: true,
          color: true,
        },
      },
      creator: true,
      tags: true,
      steps: {
        orderBy: { order: "asc" },
        include: {
          sharedStepGroup: {
            include: {
              items: {
                orderBy: { order: "asc" },
              },
            },
          },
        },
      },
      caseFieldValues: {
        include: {
          field: {
            include: {
              type: true,
              fieldOptions: {
                include: {
                  fieldOption: {
                    include: {
                      icon: true,
                      iconColor: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!repoCase) return null;

  // Build folder path
  const folderPath = await buildFolderPath(repoCase.folderId, prisma);

  return {
    id: repoCase.id,
    projectId: repoCase.projectId,
    projectName: repoCase.project.name,
    projectIconUrl: repoCase.project.iconUrl,
    repositoryId: repoCase.repositoryId,
    folderId: repoCase.folderId,
    folderPath,
    templateId: repoCase.templateId,
    templateName: repoCase.template.templateName,
    name: repoCase.name,
    className: repoCase.className,
    source: repoCase.source,
    stateId: repoCase.stateId,
    stateName: repoCase.state.name,
    stateIcon: repoCase.state.icon.name,
    stateColor: repoCase.state.color.value,
    estimate: repoCase.estimate,
    forecastManual: repoCase.forecastManual,
    forecastAutomated: repoCase.forecastAutomated,
    automated: repoCase.automated,
    isArchived: repoCase.isArchived,
    isDeleted: repoCase.isDeleted,
    createdAt: repoCase.createdAt,
    creatorId: repoCase.creatorId,
    creatorName: repoCase.creator.name,
    creatorImage: repoCase.creator.image,
    tags: repoCase.tags.map((tag) => ({
      id: tag.id,
      name: tag.name,
    })),
    customFields: buildCustomFieldDocuments(
      repoCase.caseFieldValues.map((cfv) => ({
        fieldId: cfv.fieldId,
        field: {
          displayName: cfv.field.displayName,
          systemName: cfv.field.systemName,
          type: cfv.field.type ? { type: cfv.field.type.type } : undefined,
          fieldOptions: cfv.field.fieldOptions?.map((fo) => ({
            fieldOption: {
              id: fo.fieldOption.id,
              name: fo.fieldOption.name,
              icon: fo.fieldOption.icon
                ? { name: fo.fieldOption.icon.name }
                : undefined,
              iconColor: fo.fieldOption.iconColor
                ? { value: fo.fieldOption.iconColor.value }
                : undefined,
            },
          })),
        },
        value: cfv.value,
      }))
    )
      .filter(
        (cf) => cf.value !== null && cf.value !== undefined && cf.value !== ""
      )
      .map((cf) => ({
        fieldId: cf.fieldId,
        fieldName: cf.fieldName,
        fieldType: cf.fieldType,
        value: cf.value || "", // Ensure value is always present
      })),
    steps: repoCase.steps.flatMap((step): any[] => {
      // If this is a shared step, expand all items from the group
      if (step.sharedStepGroupId && step.sharedStepGroup) {
        return step.sharedStepGroup.items.map((item, index) => ({
          id: step.id * 1000 + index, // Generate unique ID for each shared step item
          order: step.order,
          step: extractStepText(item.step),
          expectedResult: extractStepText(item.expectedResult),
          isSharedStep: true,
          sharedStepGroupId: step.sharedStepGroupId,
          sharedStepGroupName: step.sharedStepGroup?.name,
        }));
      }
      // Regular step
      return [
        {
          id: step.id,
          order: step.order,
          step: extractStepText(step.step),
          expectedResult: extractStepText(step.expectedResult),
          isSharedStep: false,
          sharedStepGroupId: undefined,
          sharedStepGroupName: undefined,
        },
      ];
    }),
  };
}

/**
 * Build the full folder path for a folder
 */
async function buildFolderPath(
  folderId: number,
  prisma: PrismaClientType = defaultPrisma
): Promise<string> {
  const folder = await prisma.repositoryFolders.findUnique({
    where: { id: folderId },
    include: { parent: true },
  });

  if (!folder) return "/";

  const path = [folder.name];
  let current: any = folder;

  while (current.parent) {
    path.unshift(current.parent.name);
    const nextParent = await prisma.repositoryFolders.findUnique({
      where: { id: current.parent.id },
      include: { parent: true },
    });
    if (!nextParent) break;
    current = nextParent;
  }

  return "/" + path.join("/");
}

/**
 * Sync a repository case to Elasticsearch after create/update
 */
export async function syncRepositoryCaseToElasticsearch(
  caseId: number
): Promise<boolean> {
  const doc = await buildRepositoryCaseDocument(caseId);
  if (!doc) {
    // Case no longer exists (hard deleted) - remove from Elasticsearch
    await deleteRepositoryCase(caseId);
    return true;
  }

  // Index all cases including deleted ones (they'll be filtered in search based on admin permissions)
  // Only exclude archived cases as they're typically not meant to be searchable
  if (doc.isArchived) {
    await deleteRepositoryCase(caseId);
    return true;
  }

  return await indexRepositoryCase(doc);
}

/**
 * Sync all repository cases for a project to Elasticsearch
 * @param projectId - The project ID to sync cases for
 * @param batchSize - Number of cases to process per batch
 * @param progressCallback - Optional callback for progress updates
 * @param prismaClient - Optional Prisma client for tenant-specific queries
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function syncProjectCasesToElasticsearch(
  projectId: number,
  batchSize: number = 100,
  progressCallback?: (processed: number, total: number, message: string) => void | Promise<void>,
  prismaClient?: PrismaClientType,
  tenantId?: string
): Promise<boolean> {
  const prisma = prismaClient || defaultPrisma;
  try {
    // Ensure index exists
    await createRepositoryCaseIndex(prisma, tenantId);

    const totalCases = await prisma.repositoryCases.count({
      where: {
        projectId,
        isArchived: false, // Only exclude archived, include deleted items
      },
    });

    const message = `Syncing ${totalCases} cases for project ${projectId}...`;
    console.log(message);
    if (progressCallback) {
      await progressCallback(0, totalCases, message);
    }

    let processed = 0;
    let hasMore = true;

    while (hasMore) {
      const cases = await prisma.repositoryCases.findMany({
        where: {
          projectId,
          isArchived: false, // Only exclude archived, include deleted items
        },
        skip: processed,
        take: batchSize,
        orderBy: { id: "asc" },
      });

      if (cases.length === 0) {
        hasMore = false;
        break;
      }

      // Build documents for this batch
      const documents: RepositoryCaseDocument[] = [];

      for (const caseItem of cases) {
        const doc = await buildRepositoryCaseDocument(caseItem.id, prisma);
        if (doc) {
          documents.push(doc);
        }
      }

      // Bulk index this batch
      if (documents.length > 0) {
        const success = await bulkIndexRepositoryCases(documents, tenantId);
        if (!success) {
          console.error(`Failed to index batch starting at ${processed}`);
          return false;
        }
      }

      processed += cases.length;
      const progressMessage = `Indexed ${processed}/${totalCases} cases...`;
      console.log(progressMessage);
      if (progressCallback) {
        await progressCallback(processed, totalCases, progressMessage);
      }
    }

    const finalMessage = `Successfully synced ${processed} cases to Elasticsearch`;
    console.log(finalMessage);
    if (progressCallback) {
      await progressCallback(processed, totalCases, finalMessage);
    }
    return true;
  } catch (error) {
    console.error("Error syncing project cases to Elasticsearch:", error);
    return false;
  }
}

/**
 * Initialize Elasticsearch indexes on application startup
 * @param prismaClient - Optional Prisma client for tenant-specific queries
 * @param tenantId - Optional tenant ID for multi-tenant mode
 */
export async function initializeElasticsearchIndexes(
  prismaClient?: PrismaClientType,
  tenantId?: string
): Promise<void> {
  try {
    const created = await createRepositoryCaseIndex(prismaClient, tenantId);
    if (created) {
      console.log(`Elasticsearch indexes initialized successfully${tenantId ? ` (tenant: ${tenantId})` : ""}`);
    }
  } catch (error) {
    console.error("Failed to initialize Elasticsearch indexes:", error);
  }
}
