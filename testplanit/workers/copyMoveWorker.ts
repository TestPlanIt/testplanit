import { Job, Worker } from "bullmq";
import { pathToFileURL } from "node:url";
import {
  disconnectAllTenantClients,
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";
import { COPY_MOVE_QUEUE_NAME } from "../lib/queueNames";
import valkeyConnection from "../lib/valkey";
import { createTestCaseVersionInTransaction } from "../lib/services/testCaseVersionService";
import { syncRepositoryCaseToElasticsearch } from "../services/repositoryCaseSync";

// ─── Job data / result types ────────────────────────────────────────────────

export interface CopyMoveJobData extends MultiTenantJobData {
  operation: "copy" | "move";
  caseIds: number[];
  sourceProjectId: number;
  targetProjectId: number;
  targetRepositoryId: number;
  targetFolderId: number;
  conflictResolution: "skip" | "rename" | "overwrite";
  sharedStepGroupResolution: "reuse" | "create_new";
  userId: string;
  targetTemplateId: number;
  targetDefaultWorkflowStateId: number;
}

export interface CopyMoveJobResult {
  copiedCount: number;
  movedCount: number;
  skippedCount: number;
  droppedLinkCount: number;
  errors: Array<{ caseId: number; caseName: string; error: string }>;
}

// ─── Redis cancellation key helper ──────────────────────────────────────────

function cancelKey(jobId: string | undefined): string {
  return `copy-move:cancel:${jobId}`;
}

// ─── Shared step group resolution ───────────────────────────────────────────

/**
 * Resolves the target SharedStepGroup ID for a given source group.
 * Handles deduplication: multiple source cases referencing the same group
 * will produce exactly one target group.
 */
async function resolveSharedStepGroup(
  tx: any,
  sourceGroup: { id: number; name: string; items: Array<{ order: number; step: any; expectedResult: any }> },
  jobData: CopyMoveJobData,
  sharedGroupMap: Map<number, number>
): Promise<number> {
  // Return cached target group if already resolved (deduplication)
  if (sharedGroupMap.has(sourceGroup.id)) {
    return sharedGroupMap.get(sourceGroup.id)!;
  }

  // Check if a group with the same name already exists in the target project
  const existingGroup = await tx.sharedStepGroup.findFirst({
    where: {
      projectId: jobData.targetProjectId,
      name: sourceGroup.name,
      isDeleted: false,
    },
  });

  let targetGroupId: number;

  if (existingGroup && jobData.sharedStepGroupResolution === "reuse") {
    // Reuse the existing group in the target project
    targetGroupId = existingGroup.id;
  } else {
    // Create a new group in the target project
    const groupName =
      existingGroup && jobData.sharedStepGroupResolution === "create_new"
        ? `${sourceGroup.name} (copy)`
        : sourceGroup.name;

    const newGroup = await tx.sharedStepGroup.create({
      data: {
        name: groupName,
        projectId: jobData.targetProjectId,
        createdById: jobData.userId,
        items: {
          create: sourceGroup.items.map((item) => ({
            order: item.order,
            step: item.step,
            expectedResult: item.expectedResult,
          })),
        },
      },
    });
    targetGroupId = newGroup.id;
  }

  // Cache the result for subsequent cases referencing the same source group
  sharedGroupMap.set(sourceGroup.id, targetGroupId);
  return targetGroupId;
}

// ─── Field value resolution ──────────────────────────────────────────────────

/**
 * Resolves a field value from source template context to the target template context.
 * Dropdown/MultiSelect option IDs are resolved by option name; unmatched options are dropped.
 * Returns null to signal "drop this value".
 */
function resolveFieldValue(
  fieldId: number,
  sourceValue: any,
  sourceTemplateFields: Array<{
    caseFieldId: number;
    fieldType: string;
    systemName: string;
    fieldOptions: Array<{ optionId: number; optionName: string }>;
  }>,
  targetTemplateFields: Array<{
    caseFieldId: number;
    fieldType: string;
    systemName: string;
    fieldOptions: Array<{ optionId: number; optionName: string }>;
  }>
): any | null {
  // Find the source field definition
  const sourceField = sourceTemplateFields.find((f) => f.caseFieldId === fieldId);
  if (!sourceField) return null;

  // Find corresponding target field by systemName
  const targetField = targetTemplateFields.find((f) => f.systemName === sourceField.systemName);
  if (!targetField) return null;

  // For Dropdown/MultiSelect: resolve option IDs by option name
  if (sourceField.fieldType === "Dropdown" || sourceField.fieldType === "MultiSelect") {
    if (sourceField.fieldType === "Dropdown") {
      // sourceValue is a single option ID (number)
      const sourceOptionId = typeof sourceValue === "number" ? sourceValue : Number(sourceValue);
      const sourceOption = sourceField.fieldOptions.find((o) => o.optionId === sourceOptionId);
      if (!sourceOption) return null;

      const targetOption = targetField.fieldOptions.find(
        (o) => o.optionName === sourceOption.optionName
      );
      return targetOption ? targetOption.optionId : null;
    } else {
      // MultiSelect: sourceValue is an array of option IDs
      const sourceOptionIds: number[] = Array.isArray(sourceValue)
        ? sourceValue.map(Number)
        : [];
      const resolvedIds: number[] = [];
      for (const srcId of sourceOptionIds) {
        const sourceOption = sourceField.fieldOptions.find((o) => o.optionId === srcId);
        if (!sourceOption) continue;
        const targetOption = targetField.fieldOptions.find(
          (o) => o.optionName === sourceOption.optionName
        );
        if (targetOption) resolvedIds.push(targetOption.optionId);
      }
      return resolvedIds.length > 0 ? resolvedIds : null;
    }
  }

  // For all other field types: carry value as-is
  return sourceValue;
}

// ─── Template field helper ───────────────────────────────────────────────────

/**
 * Fetches template field definitions (with resolved option names) for a given templateId.
 * Field options are fetched separately per field to avoid deep nesting alias limits.
 */
async function fetchTemplateFields(
  prisma: any,
  templateId: number
): Promise<Array<{
  caseFieldId: number;
  fieldType: string;
  systemName: string;
  fieldOptions: Array<{ optionId: number; optionName: string }>;
}>> {
  // Fetch template-field assignments with field metadata
  const assignments = await prisma.templateCaseAssignment.findMany({
    where: { templateId },
    include: {
      caseField: {
        include: {
          type: true,
        },
      },
    },
  });

  const result: Array<{
    caseFieldId: number;
    fieldType: string;
    systemName: string;
    fieldOptions: Array<{ optionId: number; optionName: string }>;
  }> = [];

  for (const assignment of assignments) {
    const field = assignment.caseField;
    const fieldType: string = field.type?.type ?? "";

    let fieldOptions: Array<{ optionId: number; optionName: string }> = [];

    // Fetch field options separately for Dropdown/MultiSelect fields to avoid deep alias limit
    if (fieldType === "Dropdown" || fieldType === "MultiSelect") {
      const optionAssignments = await prisma.caseFieldAssignment.findMany({
        where: { caseFieldId: field.id },
        include: {
          fieldOption: {
            select: { id: true, name: true, isDeleted: true },
          },
        },
      });
      fieldOptions = optionAssignments
        .filter((oa: any) => !oa.fieldOption.isDeleted)
        .map((oa: any) => ({
          optionId: oa.fieldOption.id,
          optionName: oa.fieldOption.name,
        }));
    }

    result.push({
      caseFieldId: field.id,
      fieldType,
      systemName: field.systemName,
      fieldOptions,
    });
  }

  return result;
}

// ─── Processor ──────────────────────────────────────────────────────────────

const processor = async (job: Job<CopyMoveJobData>): Promise<CopyMoveJobResult> => {
  console.log(
    `Processing copy-move job ${job.id}: ${job.data.operation} ${job.data.caseIds.length} cases` +
      ` from project ${job.data.sourceProjectId} to ${job.data.targetProjectId}` +
      (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
  );

  // 1. Validate multi-tenant context
  validateMultiTenantJobData(job.data);

  // 2. Get tenant-specific Prisma client (raw Prisma, no ZenStack policy enforcement)
  const prisma = getPrismaClientForJob(job.data);

  // 3. Check for pre-start cancellation
  const redis = await worker!.client;
  const cancelledAtStart = await redis.get(cancelKey(job.id));
  if (cancelledAtStart) {
    await redis.del(cancelKey(job.id));
    throw new Error("Job cancelled by user");
  }

  // 4. Pre-fetch folderMaxOrder once to avoid race conditions inside the loop
  const maxOrderRow = await prisma.repositoryCases.findFirst({
    where: { folderId: job.data.targetFolderId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  let nextOrder = (maxOrderRow?.order ?? -1) + 1;

  // 5. Pre-fetch source cases with their related data
  const sourceCases = await prisma.repositoryCases.findMany({
    where: { id: { in: job.data.caseIds }, isDeleted: false },
    include: {
      steps: {
        where: { isDeleted: false },
        include: {
          sharedStepGroup: {
            include: {
              items: { orderBy: { order: "asc" } },
            },
          },
        },
        orderBy: { order: "asc" },
      },
      caseFieldValues: true,
      attachments: { where: { isDeleted: false } },
      tags: { select: { id: true } },
      issues: { select: { id: true } },
      comments:
        job.data.operation === "move"
          ? {
              where: { isDeleted: false },
              select: {
                id: true,
                content: true,
                creatorId: true,
                createdAt: true,
                isEdited: true,
                projectId: true,
              },
            }
          : false,
    },
  });

  // 6. For move: fetch version history separately to avoid 63-char alias limit
  const sourceVersionsMap = new Map<number, any[]>();
  if (job.data.operation === "move") {
    for (const sc of sourceCases) {
      const versions = await prisma.repositoryCaseVersions.findMany({
        where: { repositoryCaseId: sc.id },
        orderBy: { version: "asc" },
      });
      sourceVersionsMap.set(sc.id, versions);
    }
  }

  // 7. Pre-fetch template field definitions for both source and target templates
  // Source template ID comes from the first source case (assume all share same template)
  const sourceTemplateId = sourceCases[0]?.templateId;
  const [sourceTemplateFields, targetTemplateFields] = await Promise.all([
    sourceTemplateId ? fetchTemplateFields(prisma, sourceTemplateId) : Promise.resolve([]),
    fetchTemplateFields(prisma, job.data.targetTemplateId),
  ]);

  // 8. Initialize state
  const sharedGroupMap = new Map<number, number>();
  const createdTargetIds: number[] = [];
  const result: CopyMoveJobResult = {
    copiedCount: 0,
    movedCount: 0,
    skippedCount: 0,
    droppedLinkCount: 0,
    errors: [],
  };

  // 9. Main processing loop — one transaction per case
  try {
    for (let i = 0; i < sourceCases.length; i++) {
      const sourceCase = sourceCases[i];

      // Check for cancellation between cases
      const cancelFlag = await redis.get(cancelKey(job.id));
      if (cancelFlag) {
        await redis.del(cancelKey(job.id));
        throw new Error("Job cancelled by user");
      }

      await job.updateProgress({ processed: i, total: sourceCases.length });

      const newCaseId = await prisma.$transaction(async (tx: any) => {
        // a. Create the target RepositoryCases row
        const newCase = await tx.repositoryCases.create({
          data: {
            projectId: job.data.targetProjectId,
            repositoryId: job.data.targetRepositoryId,
            folderId: job.data.targetFolderId,
            templateId: job.data.targetTemplateId,
            stateId: job.data.targetDefaultWorkflowStateId,
            name: sourceCase.name,
            className: sourceCase.className,
            source: sourceCase.source,
            automated: sourceCase.automated,
            estimate: sourceCase.estimate,
            creatorId: sourceCase.creatorId,
            order: nextOrder,
            currentVersion: 1,
          },
        });
        nextOrder++;

        // b. Create Steps
        for (const step of sourceCase.steps) {
          let resolvedSharedStepGroupId: number | null = null;

          if (step.sharedStepGroupId !== null && step.sharedStepGroup) {
            resolvedSharedStepGroupId = await resolveSharedStepGroup(
              tx,
              step.sharedStepGroup,
              job.data,
              sharedGroupMap
            );
          }

          await tx.steps.create({
            data: {
              testCaseId: newCase.id,
              step: step.step,
              expectedResult: step.expectedResult,
              order: step.order,
              sharedStepGroupId: resolvedSharedStepGroupId,
            },
          });
        }

        // c. Create CaseFieldValues (resolve option IDs by name for dropdown/multiselect)
        for (const fieldValue of sourceCase.caseFieldValues) {
          const resolvedValue = resolveFieldValue(
            fieldValue.fieldId,
            fieldValue.value,
            sourceTemplateFields,
            targetTemplateFields
          );
          if (resolvedValue !== null) {
            await tx.caseFieldValues.create({
              data: {
                testCaseId: newCase.id,
                fieldId: fieldValue.fieldId,
                value: resolvedValue,
              },
            });
          }
        }

        // d. Create Attachments (new DB rows pointing to same URLs — no re-upload)
        for (const attachment of sourceCase.attachments) {
          await tx.attachments.create({
            data: {
              testCaseId: newCase.id,
              url: attachment.url,
              name: attachment.name,
              note: attachment.note,
              mimeType: attachment.mimeType,
              size: attachment.size,
              createdById: attachment.createdById,
            },
          });
        }

        // e. Connect Tags (tags are global — connect by existing tag ID)
        if (sourceCase.tags.length > 0) {
          await tx.repositoryCases.update({
            where: { id: newCase.id },
            data: {
              tags: { connect: sourceCase.tags.map((t: { id: number }) => ({ id: t.id })) },
            },
          });
        }

        // f. Connect Issues (issues are global — connect by existing issue ID)
        if (sourceCase.issues.length > 0) {
          await tx.repositoryCases.update({
            where: { id: newCase.id },
            data: {
              issues: { connect: sourceCase.issues.map((i: { id: number }) => ({ id: i.id })) },
            },
          });
        }

        // g. Version handling
        if (job.data.operation === "copy") {
          // Copy: version 1, fresh history
          await tx.repositoryCases.update({
            where: { id: newCase.id },
            data: { currentVersion: 1 },
          });
          await createTestCaseVersionInTransaction(tx, newCase.id, {
            version: 1,
            creatorId: job.data.userId,
          });
        } else {
          // Move: preserve full version history with updated FKs
          const sourceVersions = sourceVersionsMap.get(sourceCase.id) ?? [];
          let lastVersionNumber = 1;
          for (const ver of sourceVersions) {
            await tx.repositoryCaseVersions.create({
              data: {
                repositoryCaseId: newCase.id,
                // Update location FKs to target
                projectId: job.data.targetProjectId,
                repositoryId: job.data.targetRepositoryId,
                folderId: job.data.targetFolderId,
                // Preserve static snapshot fields
                staticProjectId: ver.staticProjectId,
                staticProjectName: ver.staticProjectName,
                folderName: ver.folderName,
                templateId: ver.templateId,
                templateName: ver.templateName,
                name: ver.name,
                stateId: ver.stateId,
                stateName: ver.stateName,
                estimate: ver.estimate,
                forecastManual: ver.forecastManual,
                forecastAutomated: ver.forecastAutomated,
                order: ver.order,
                createdAt: ver.createdAt,
                creatorId: ver.creatorId,
                creatorName: ver.creatorName,
                automated: ver.automated,
                isArchived: ver.isArchived,
                isDeleted: ver.isDeleted,
                version: ver.version,
                steps: ver.steps,
                tags: ver.tags,
                issues: ver.issues,
                links: ver.links,
                attachments: ver.attachments,
              },
            });
            lastVersionNumber = ver.version;
          }
          await tx.repositoryCases.update({
            where: { id: newCase.id },
            data: { currentVersion: lastVersionNumber },
          });

          // h. Comments (move only: preserve all comments)
          const comments = sourceCase.comments ?? [];
          for (const comment of comments) {
            await tx.comment.create({
              data: {
                content: comment.content,
                projectId: job.data.targetProjectId,
                repositoryCaseId: newCase.id,
                creatorId: comment.creatorId,
                createdAt: comment.createdAt,
                isEdited: comment.isEdited,
              },
            });
          }
        }

        return newCase.id;
      });

      createdTargetIds.push(newCaseId);
      result.copiedCount++;
    }
  } catch (err: any) {
    // Rollback: delete all created target cases (cascade handles children)
    if (createdTargetIds.length > 0) {
      console.error(
        `Copy-move job ${job.id} failed — rolling back ${createdTargetIds.length} created cases.`
      );
      await prisma.repositoryCases.deleteMany({
        where: { id: { in: createdTargetIds } },
      });
    }
    throw err;
  }

  // 10. Move: soft-delete source cases only after ALL copies succeeded
  if (job.data.operation === "move") {
    await prisma.repositoryCases.updateMany({
      where: { id: { in: job.data.caseIds } },
      data: { isDeleted: true },
    });
    result.movedCount = result.copiedCount;
    result.copiedCount = 0;
  }

  // 11. Elasticsearch bulk sync after all cases committed (not per-case inside transaction)
  await job.updateProgress({ processed: sourceCases.length, total: sourceCases.length, finalizing: true });

  for (const id of createdTargetIds) {
    syncRepositoryCaseToElasticsearch(id).catch((err) =>
      console.error(`ES sync failed for new case ${id}:`, err)
    );
  }

  // For move: also remove source cases from ES index (best-effort)
  if (job.data.operation === "move") {
    for (const sourceId of job.data.caseIds) {
      syncRepositoryCaseToElasticsearch(sourceId).catch((err) =>
        console.error(`ES sync failed for moved source case ${sourceId}:`, err)
      );
    }
  }

  // 12. Cross-project case links (RepositoryCaseLink) are dropped silently
  // droppedLinkCount could be calculated here if needed; currently reported as 0
  result.droppedLinkCount = 0;

  console.log(
    `Copy-move job ${job.id} completed: ` +
      `copied=${result.copiedCount} moved=${result.movedCount} skipped=${result.skippedCount} ` +
      `droppedLinks=${result.droppedLinkCount}`
  );

  return result;
};

// ─── Worker setup ────────────────────────────────────────────────────────────

let worker: Worker<CopyMoveJobData, CopyMoveJobResult> | null = null;

const startWorker = async () => {
  if (isMultiTenantMode()) {
    console.log("Copy-move worker starting in MULTI-TENANT mode");
  } else {
    console.log("Copy-move worker starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker<CopyMoveJobData, CopyMoveJobResult>(
      COPY_MOVE_QUEUE_NAME,
      processor,
      {
        connection: valkeyConnection as any,
        concurrency: 1, // LOCKED: prevent ZenStack v3 deadlocks (40P01)
      }
    );

    worker.on("completed", (job) => {
      console.log(`Copy-move job ${job.id} completed successfully.`);
    });

    worker.on("failed", (job, err) => {
      console.error(`Copy-move job ${job?.id} failed:`, err.message);
    });

    worker.on("error", (err) => {
      console.error("Copy-move worker error:", err);
    });

    console.log(`Copy-move worker started for queue "${COPY_MOVE_QUEUE_NAME}".`);
  } else {
    console.warn("Valkey connection not available. Copy-move worker not started.");
  }

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("Shutting down copy-move worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("Shutting down copy-move worker...");
    if (worker) {
      await worker.close();
    }
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};

// Run the worker if this file is executed directly
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  typeof import.meta === "undefined" ||
  (import.meta as any).url === undefined
) {
  console.log("Copy-move worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start copy-move worker:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
