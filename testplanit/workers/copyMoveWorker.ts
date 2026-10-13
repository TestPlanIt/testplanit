import { Job, Worker } from "bullmq";
import { DbNull, JsonNull } from "@zenstackhq/orm";
import { getAuditContext, runWithAuditContext } from "../lib/auditContext";
import { buildGucPayload, withAuditGuc } from "../lib/audit/gucContext";
import type { ActorContextJobData } from "../lib/auditContextEnqueue";
import {
  createCaseStateMapper,
  createGatedStateResolver,
  getCasesWorkflowAssignments,
  getWorkflowNamesByIds,
} from "../lib/services/workflowStateMapping";
import {
  disconnectAllTenantClients,
  getCurrentTenantId,
  getDbClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  validateMultiTenantJobData,
} from "../lib/multiTenantDb";
import { COPY_MOVE_QUEUE_NAME } from "../lib/queueNames";
import { captureAuditEvent } from "../lib/services/auditLog";
import {
  announceDeletionCancelledReviews,
  cancelReviewsForDeletedEntities,
} from "../lib/services/reviewCancellation";
import { withTenantContext } from "../lib/tenantContext";
import valkeyConnection from "../lib/valkey";
import { BULLMQ_PREFIX } from "../lib/bullPrefix";
import { createTestCaseVersionInTransaction } from "../lib/services/testCaseVersionService";
import { syncRepositoryCaseToElasticsearch } from "../services/repositoryCaseSync";

// ─── Job data / result types ────────────────────────────────────────────────

interface CopyMoveJobDataCore extends MultiTenantJobData {
  operation: "copy" | "move";
  caseIds: number[];
  sourceProjectId: number;
  targetProjectId: number;
  targetFolderId: number;
  conflictResolution: "skip" | "rename" | "overwrite";
  sharedStepGroupResolution: "reuse" | "create_new";
  userId: string;
  // Target context for rows created in the target project. A same-project
  // move is a pure relocation and carries none of these — it derives the
  // repository from the target folder and touches neither template nor state.
  targetRepositoryId?: number;
  targetTemplateId?: number;
  targetDefaultWorkflowStateId?: number;
  folderTree?: FolderTreeNode[];
}

// payload now carries actorContext so the worker ALS frame
// can be re-established in the processor body.
export type CopyMoveJobData = ActorContextJobData<CopyMoveJobDataCore>;

export interface CopyMoveJobResult {
  copiedCount: number;
  movedCount: number;
  skippedCount: number;
  droppedLinkCount: number;
  errors: Array<{ caseId: number; caseName: string; error: string }>;
}

export interface FolderTreeNode {
  localKey: string; // String(sourceFolderId) — stable client key
  sourceFolderId: number; // original source folder ID
  name: string;
  parentLocalKey: string | null; // null = root of copied tree
  caseIds: number[]; // cases directly in this folder
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
  sourceGroup: {
    id: number;
    name: string;
    items: Array<{ order: number; step: any; expectedResult: any }>;
  },
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
  const sourceField = sourceTemplateFields.find(
    (f) => f.caseFieldId === fieldId
  );
  if (!sourceField) return null;

  // Find corresponding target field by systemName
  const targetField = targetTemplateFields.find(
    (f) => f.systemName === sourceField.systemName
  );
  if (!targetField) return null;

  // For Dropdown/MultiSelect: resolve option IDs by option name
  if (
    sourceField.fieldType === "Dropdown" ||
    sourceField.fieldType === "MultiSelect"
  ) {
    if (sourceField.fieldType === "Dropdown") {
      // sourceValue is a single option ID (number)
      const sourceOptionId =
        typeof sourceValue === "number" ? sourceValue : Number(sourceValue);
      const sourceOption = sourceField.fieldOptions.find(
        (o) => o.optionId === sourceOptionId
      );
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
        const sourceOption = sourceField.fieldOptions.find(
          (o) => o.optionId === srcId
        );
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
  db: any,
  templateId: number
): Promise<
  Array<{
    caseFieldId: number;
    fieldType: string;
    systemName: string;
    fieldOptions: Array<{ optionId: number; optionName: string }>;
  }>
> {
  // Fetch template-field assignments with field metadata
  const assignments = await db.templateCaseAssignment.findMany({
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
      const optionAssignments = await db.caseFieldAssignment.findMany({
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

// ─── Same-project move: relocation ──────────────────────────────────────────

/** Audit-context payload for this job's transactions (CTX-02). */
function jobGucPayload(job: Job<CopyMoveJobData>) {
  return {
    ...buildGucPayload(),
    source: "worker",
    tenantId: job.data?.tenantId ?? getCurrentTenantId() ?? null,
  };
}

/**
 * A move that stays inside one project relocates the existing rows: cases
 * keep their name, template, state, versions, children and comments, and a
 * moved folder keeps its identity and subtree. Nothing is created, renamed
 * or restamped, so none of the copy machinery (collision resolution,
 * template/state mapping, child-record duplication) is involved.
 *
 * The whole relocation runs in ONE transaction, so a failure leaves the
 * repository exactly as it was — there is no rollback bookkeeping.
 */
async function relocateWithinProject(
  job: Job<CopyMoveJobData>,
  db: any
): Promise<CopyMoveJobResult> {
  const result: CopyMoveJobResult = {
    copiedCount: 0,
    movedCount: 0,
    skippedCount: 0,
    droppedLinkCount: 0,
    errors: [],
  };
  const projectId = job.data.targetProjectId;

  // The target folder anchors the move: every relocated row lands in its
  // repository (a folder belongs to exactly one repository, so the folder —
  // not the job payload — is the authority on the repository id).
  const targetFolder = await db.repositoryFolders.findFirst({
    where: {
      id: job.data.targetFolderId,
      projectId,
      isDeleted: false,
    },
    select: { id: true, repositoryId: true },
  });
  if (!targetFolder) {
    throw new Error("Target folder not found in target project");
  }
  const targetRepositoryId = targetFolder.repositoryId;

  const folderTree =
    job.data.folderTree && job.data.folderTree.length > 0
      ? job.data.folderTree
      : undefined;

  // Moving a folder into itself or its own subtree would orphan the tree.
  // The dialog disables these targets; enforce it server-side too.
  if (folderTree?.some((n) => n.sourceFolderId === job.data.targetFolderId)) {
    throw new Error("Cannot move a folder into itself or its own subtree");
  }

  // The projectId filter is load-bearing: the route only checks project
  // access, so without it a crafted payload could relocate another
  // project's rows.
  const sourceCases: Array<{ id: number; folderId: number }> =
    await db.repositoryCases.findMany({
      where: {
        id: { in: job.data.caseIds },
        projectId,
        isDeleted: false,
      },
      select: { id: true, folderId: true },
    });

  await job.updateProgress({ processed: 0, total: sourceCases.length });

  // ── Plan ──────────────────────────────────────────────────────────────
  // Case moves are row updates; folder moves reparent the existing folder
  // row (its whole subtree comes along untouched) unless a live same-named
  // sibling already exists under the destination — then the folder merges:
  // its direct cases move into the sibling, its children re-anchor under
  // the sibling, and the emptied source folder is soft-deleted.
  const caseMoves: Array<{ caseId: number; folderId: number; order: number }> =
    [];
  const folderReparents: Array<{
    folderId: number;
    parentId: number;
    order: number;
  }> = [];
  const mergedFolderIds: number[] = [];

  // Next free `order` per destination folder, fetched once per folder.
  const nextCaseOrder = new Map<number, number>();
  const claimCaseOrder = async (folderId: number): Promise<number> => {
    if (!nextCaseOrder.has(folderId)) {
      const maxRow = await db.repositoryCases.findFirst({
        where: { folderId },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      nextCaseOrder.set(folderId, (maxRow?.order ?? -1) + 1);
    }
    const order = nextCaseOrder.get(folderId)!;
    nextCaseOrder.set(folderId, order + 1);
    return order;
  };
  const nextFolderOrder = new Map<number, number>();
  const claimFolderOrder = async (parentId: number): Promise<number> => {
    if (!nextFolderOrder.has(parentId)) {
      const maxRow = await db.repositoryFolders.findFirst({
        where: { projectId, parentId, isDeleted: false },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      nextFolderOrder.set(parentId, (maxRow?.order ?? -1) + 1);
    }
    const order = nextFolderOrder.get(parentId)!;
    nextFolderOrder.set(parentId, order + 1);
    return order;
  };

  if (folderTree) {
    const folderRows: Array<{
      id: number;
      parentId: number | null;
      name: string;
    }> = await db.repositoryFolders.findMany({
      where: {
        id: { in: folderTree.map((n) => n.sourceFolderId) },
        projectId,
        isDeleted: false,
      },
      select: { id: true, parentId: true, name: true },
    });
    const folderRowById = new Map(folderRows.map((f) => [f.id, f]));
    const childrenOf = new Map<string, FolderTreeNode[]>();
    for (const node of folderTree) {
      if (node.parentLocalKey === null) continue;
      const list = childrenOf.get(node.parentLocalKey) ?? [];
      list.push(node);
      childrenOf.set(node.parentLocalKey, list);
    }

    const queue = folderTree
      .filter((n) => n.parentLocalKey === null)
      .map((node) => ({ node, destParentId: targetFolder.id }));
    while (queue.length > 0) {
      const { node, destParentId } = queue.shift()!;
      const row = folderRowById.get(node.sourceFolderId);
      if (!row) continue;

      if (row.parentId === destParentId) {
        // Already lives there — the folder, its subtree and its cases are
        // all exactly where they belong. Nothing to do.
        continue;
      }

      const sibling = await db.repositoryFolders.findFirst({
        where: {
          projectId,
          parentId: destParentId,
          name: row.name,
          isDeleted: false,
          id: { not: row.id },
        },
        select: { id: true },
      });

      if (!sibling) {
        folderReparents.push({
          folderId: row.id,
          parentId: destParentId,
          order: await claimFolderOrder(destParentId),
        });
        // The subtree rides along with the reparented folder.
        continue;
      }

      // Merge into the existing sibling.
      for (const caseId of node.caseIds) {
        caseMoves.push({
          caseId,
          folderId: sibling.id,
          order: await claimCaseOrder(sibling.id),
        });
      }
      for (const child of childrenOf.get(node.localKey) ?? []) {
        queue.push({ node: child, destParentId: sibling.id });
      }
      mergedFolderIds.push(row.id);
    }
  } else {
    for (const sourceCase of sourceCases) {
      if (sourceCase.folderId === targetFolder.id) continue;
      caseMoves.push({
        caseId: sourceCase.id,
        folderId: targetFolder.id,
        order: await claimCaseOrder(targetFolder.id),
      });
    }
  }

  // ── Execute atomically ────────────────────────────────────────────────
  await withAuditGuc(db, jobGucPayload(job), async (tx: any) => {
    for (const move of caseMoves) {
      await tx.repositoryCases.update({
        where: { id: move.caseId },
        data: {
          folderId: move.folderId,
          repositoryId: targetRepositoryId,
          order: move.order,
        },
      });
    }
    for (const reparent of folderReparents) {
      await tx.repositoryFolders.update({
        where: { id: reparent.folderId },
        data: {
          parentId: reparent.parentId,
          repositoryId: targetRepositoryId,
          order: reparent.order,
        },
      });
    }
    if (mergedFolderIds.length > 0) {
      await tx.repositoryFolders.updateMany({
        where: { id: { in: mergedFolderIds } },
        data: { isDeleted: true },
      });
    }
  });

  await job.updateProgress({
    processed: sourceCases.length,
    total: sourceCases.length,
    finalizing: true,
  });

  // ES stores each case's folder path, so every case in the move is
  // re-synced — including cases whose rows didn't change but whose folder
  // was reparented. Best-effort, after commit.
  for (const sourceCase of sourceCases) {
    syncRepositoryCaseToElasticsearch(
      sourceCase.id,
      job.data.tenantId,
      db
    ).catch((err) =>
      console.error(`ES sync failed for moved case ${sourceCase.id}:`, err)
    );
  }

  // Audit the rows that changed: relocated cases and reparented folders.
  for (const move of caseMoves) {
    captureAuditEvent({
      action: "UPDATE",
      entityType: "RepositoryCases",
      entityId: String(move.caseId),
      projectId,
      userId: job.data.userId,
      tenantId: job.data.tenantId,
      metadata: {
        source: "copy-move:move",
        targetFolderId: move.folderId,
        jobId: job.id,
      },
    }).catch(() => {});
  }
  for (const reparent of folderReparents) {
    captureAuditEvent({
      action: "UPDATE",
      entityType: "RepositoryFolders",
      entityId: String(reparent.folderId),
      projectId,
      userId: job.data.userId,
      tenantId: job.data.tenantId,
      metadata: {
        source: "copy-move:move",
        targetParentFolderId: reparent.parentId,
        jobId: job.id,
      },
    }).catch(() => {});
  }

  result.movedCount = sourceCases.length;
  return result;
}

// ─── Processor ──────────────────────────────────────────────────────────────

// re-establish the ALS frame from job.data.actorContext so
// downstream captureAuditEvent calls at L778 / L796 pick up the originating
// user's context. systemReason (if upstream was system-stamped) rides along
// via W5 Option A — no per-worker systemReason handling.
const processor = async (
  job: Job<CopyMoveJobData>
): Promise<CopyMoveJobResult> =>
  runWithAuditContext(job.data.actorContext ?? {}, async () => {
    console.log(
      `Processing copy-move job ${job.id}: ${job.data.operation} ${job.data.caseIds.length} cases` +
        ` from project ${job.data.sourceProjectId} to ${job.data.targetProjectId}` +
        (job.data.tenantId ? ` (tenant: ${job.data.tenantId})` : "")
    );

    // 1. Validate multi-tenant context
    validateMultiTenantJobData(job.data);

    // 2. Get tenant-specific Prisma client (raw Prisma, no ZenStack policy enforcement)
    const db = getDbClientForJob(job.data);

    // 3. Check for pre-start cancellation
    const redis = await worker!.client;
    const cancelledAtStart = await redis.get(cancelKey(job.id));
    if (cancelledAtStart) {
      await redis.del(cancelKey(job.id));
      throw new Error("Job cancelled by user");
    }

    // A move within one project is a relocation, not a copy — handled by its
    // own path with none of the machinery below.
    if (
      job.data.operation === "move" &&
      job.data.sourceProjectId === job.data.targetProjectId
    ) {
      return relocateWithinProject(job, db);
    }

    // Everything past this point creates rows in the target project, which
    // requires the resolved target context.
    const targetRepositoryId = job.data.targetRepositoryId;
    const targetTemplateId = job.data.targetTemplateId;
    const targetDefaultWorkflowStateId = job.data.targetDefaultWorkflowStateId;
    if (
      targetRepositoryId == null ||
      targetTemplateId == null ||
      targetDefaultWorkflowStateId == null
    ) {
      throw new Error(
        "Copy/cross-project move job is missing resolved target context"
      );
    }

    // 4. Pre-fetch folderMaxOrder (only used for non-folder-tree jobs)
    let nextOrder = 0;
    if (!job.data.folderTree) {
      const maxOrderRow = await db.repositoryCases.findFirst({
        where: { folderId: job.data.targetFolderId },
        orderBy: { order: "desc" },
        select: { order: true },
      });
      nextOrder = (maxOrderRow?.order ?? -1) + 1;
    }

    // 4b. Folder tree recreation (BFS order — client sends array already sorted BFS)
    const sourceFolderToTargetFolderMap = new Map<string, number>();
    const folderNextOrderMap = new Map<number, number>();

    if (job.data.folderTree && job.data.folderTree.length > 0) {
      for (const node of job.data.folderTree) {
        // Determine the parent folder ID in the target
        let parentTargetId: number;
        if (node.parentLocalKey === null) {
          parentTargetId = job.data.targetFolderId;
        } else {
          const mappedParent = sourceFolderToTargetFolderMap.get(
            node.parentLocalKey
          );
          if (mappedParent === undefined) {
            throw new Error(
              "Folder tree ordering error: parent not yet created"
            );
          }
          parentTargetId = mappedParent;
        }

        // Check for an existing folder with the same name under the same parent (merge behavior)
        const existingFolder = await db.repositoryFolders.findFirst({
          where: {
            projectId: job.data.targetProjectId,
            repositoryId: targetRepositoryId,
            parentId: parentTargetId,
            name: node.name,
            isDeleted: false,
          },
        });

        let targetFolderId: number;
        if (existingFolder) {
          // Merge: reuse existing folder
          targetFolderId = existingFolder.id;
        } else {
          // Create new folder under parentTargetId
          const maxFolderOrderRow = await db.repositoryFolders.findFirst({
            where: {
              projectId: job.data.targetProjectId,
              repositoryId: targetRepositoryId,
              parentId: parentTargetId,
            },
            orderBy: { order: "desc" },
            select: { order: true },
          });
          const newFolder = await db.repositoryFolders.create({
            data: {
              projectId: job.data.targetProjectId,
              repositoryId: targetRepositoryId,
              parentId: parentTargetId,
              name: node.name,
              order: (maxFolderOrderRow?.order ?? -1) + 1,
              creatorId: job.data.userId,
            },
          });
          targetFolderId = newFolder.id;
        }

        sourceFolderToTargetFolderMap.set(node.localKey, targetFolderId);
      }

      // Pre-fetch max case orders for each unique target folder created during tree recreation
      const uniqueTargetFolderIds = [
        ...new Set(sourceFolderToTargetFolderMap.values()),
      ];
      for (const fId of uniqueTargetFolderIds) {
        const maxRow = await db.repositoryCases.findFirst({
          where: { folderId: fId },
          orderBy: { order: "desc" },
          select: { order: true },
        });
        folderNextOrderMap.set(fId, (maxRow?.order ?? -1) + 1);
      }
    }

    // 5. Pre-fetch source cases with their related data. The projectId
    // filter is load-bearing: the route only checks project access, so
    // without it a crafted payload could copy or move another project's rows.
    const sourceCases = await db.repositoryCases.findMany({
      where: {
        id: { in: job.data.caseIds },
        projectId: job.data.sourceProjectId,
        isDeleted: false,
      },
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
        caseTags: { select: { tag: { select: { id: true } } } },
        caseIssues: { select: { issue: { select: { id: true } } } },
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

    // 6. For move: fetch version history separately to avoid the 63-char
    // alias limit.
    const sourceVersionsMap = new Map<number, any[]>();
    if (job.data.operation === "move") {
      for (const sc of sourceCases) {
        const versions = await db.repositoryCaseVersions.findMany({
          where: { repositoryCaseId: sc.id },
          orderBy: { version: "asc" },
          // Each snapshot's own custom field values travel with it. They hang
          // off the version by id, so the rebuilt rows below need their own
          // copies — without this a moved case keeps its history but every
          // version in it reads as though the custom fields were empty.
          include: {
            caseFieldVersionValues: { select: { field: true, value: true } },
          },
        });
        sourceVersionsMap.set(sc.id, versions);
      }
    }

    // 7. Pre-fetch template assignments for the target project so we can
    // preserve each source case's template when it's still available there
    // (instead of silently rewriting every case to targetTemplateId,
    // which would, e.g., swap a "Case (steps)" case to whatever happens to
    // be the target's first assigned template). Field definitions are
    // cached lazily per template since the source set may now span several.
    const targetTemplateAssignments =
      await db.templateProjectAssignment.findMany({
        where: { projectId: job.data.targetProjectId },
        select: { templateId: true },
      });
    const targetAssignedTemplateIds = new Set<number>(
      targetTemplateAssignments.map((a: { templateId: number }) => a.templateId)
    );

    // 7b. Workflow-state resolution, shared with the preflight route so the
    // preview the user confirmed is exactly what lands: keep exact states,
    // else match by name, else the target default — then run the result
    // through the review gate, since every row this operation writes is
    // created fresh in the target project.
    const targetStates = await getCasesWorkflowAssignments(
      db,
      job.data.targetProjectId
    );
    const uniqueSourceStateIds = [
      ...new Set(sourceCases.map((c: { stateId: number }) => c.stateId)),
    ];
    const sourceStateNames = await getWorkflowNamesByIds(
      db,
      uniqueSourceStateIds
    );
    const stateMapper = createCaseStateMapper(targetStates, sourceStateNames);
    const resolveGatedState = createGatedStateResolver(
      db,
      job.data.targetProjectId
    );

    const templateFieldsCache = new Map<
      number,
      Awaited<ReturnType<typeof fetchTemplateFields>>
    >();
    const getTemplateFields = async (templateId: number) => {
      if (!templateFieldsCache.has(templateId)) {
        templateFieldsCache.set(
          templateId,
          await fetchTemplateFields(db, templateId)
        );
      }
      return templateFieldsCache.get(templateId)!;
    };

    // 8. Initialize state
    const sharedGroupMap = new Map<number, number>();
    const createdTargetIds: Array<{ newId: number; sourceId: number }> = [];
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

        // Collision check: skip or rename based on user's conflictResolution choice
        // Collision check — must handle NULL className (PostgreSQL NULL != NULL bypasses unique constraint)
        const classNameWhere =
          sourceCase.className === null
            ? { className: { equals: null as any } }
            : { className: sourceCase.className };

        const existingCase = await db.repositoryCases.findFirst({
          where: {
            projectId: job.data.targetProjectId,
            name: sourceCase.name,
            ...classNameWhere,
            source: sourceCase.source,
            isDeleted: false,
          },
          select: { id: true },
        });

        let caseName = sourceCase.name;

        // `existingCase` only matches LIVE rows, so it answers "is there a
        // visible duplicate?" — the trigger for the user's skip choice.
        if (existingCase && job.data.conflictResolution === "skip") {
          result.skippedCount = (result.skippedCount ?? 0) + 1;
          continue;
        }

        // Resolve a target name that is free against BOTH live and
        // soft-deleted cases, then always create a brand-new, distinct case
        // below — we never resurrect a tombstone.
        //
        // Why tombstones matter: RepositoryCases
        // @@unique([projectId, name, className, source]) covers soft-deleted
        // rows. If a previously-deleted case still holds this name, creating
        // with the same name would 23505. The old design worked around that by
        // reusing (resurrecting) the dead case's id — which silently inherited
        // its stale steps, field values, version history (RepositoryCaseVersions
        // are never deleted) and run links, and then collided anyway when the
        // copy's version 1 met the tombstone's surviving version 1.
        //
        // Only `copy` reaches here: a same-project move returns early via
        // relocateWithinProject, and a cross-project move's sources live in
        // another project, so neither can match these target-scoped probes.
        const nameIsTaken = async (candidate: string): Promise<boolean> => {
          const row = await db.repositoryCases.findFirst({
            where: {
              projectId: job.data.targetProjectId,
              name: candidate,
              ...classNameWhere,
              source: sourceCase.source,
            },
            select: { id: true },
          });
          return row !== null;
        };

        if (await nameIsTaken(caseName)) {
          let suffix = 1;
          let candidateName = `${sourceCase.name} (copy)`;
          while (await nameIsTaken(candidateName)) {
            suffix++;
            candidateName = `${sourceCase.name} (copy ${suffix})`;
          }
          caseName = candidateName;
        }

        // Determine target folder for this case (either from folderTree map or flat targetFolderId)
        const caseFolderKey = String(sourceCase.folderId);
        const caseFolderId = job.data.folderTree
          ? (sourceFolderToTargetFolderMap.get(caseFolderKey) ??
            job.data.targetFolderId)
          : job.data.targetFolderId;

        // Determine case order for this folder
        let caseOrder: number;
        if (job.data.folderTree) {
          const currentOrder = folderNextOrderMap.get(caseFolderId) ?? 0;
          caseOrder = currentOrder;
          folderNextOrderMap.set(caseFolderId, currentOrder + 1);
        } else {
          caseOrder = nextOrder;
          nextOrder++;
        }

        // Preserve the source case's template when it's still assigned to
        // the target project; otherwise fall back to the resolved
        // targetTemplateId. Field option remapping uses the
        // matching source/target field snapshots so the values land on the
        // right options when the template differs.
        const effectiveTargetTemplateId = targetAssignedTemplateIds.has(
          sourceCase.templateId
        )
          ? sourceCase.templateId
          : targetTemplateId;
        const sourceTemplateFields = await getTemplateFields(
          sourceCase.templateId
        );
        const targetTemplateFields = await getTemplateFields(
          effectiveTargetTemplateId
        );

        // The case keeps its status, resolved through the same mapper the
        // preflight previewed with, then gated for the freshly created row.
        const effectiveStateId = await resolveGatedState(
          stateMapper.map(sourceCase.stateId)?.stateId ??
            targetDefaultWorkflowStateId
        );

        // Phase 13 CTX-02 — withAuditGuc stamps the actor GUC as the FIRST
        // statement inside this per-case transaction so trigger-captured rows
        // for the copied RepositoryCases/Steps/CaseFieldValues carry the
        // originating user/tenant. The processor runs inside
        // runWithAuditContext(actorContext), so buildGucPayload() carries
        // userName + operationId, grouping CDC rows under the originating
        // save alongside the semantic CREATE/DUPLICATED.
        const newCaseId = await withAuditGuc(
          db,
          jobGucPayload(job),
          async (tx: any) => {
            // a. Create-or-restore the target RepositoryCases row.
            const caseFields = {
              repositoryId: targetRepositoryId,
              folderId: caseFolderId,
              templateId: effectiveTargetTemplateId,
              stateId: effectiveStateId,
              automated: sourceCase.automated,
              estimate: sourceCase.estimate,
              creatorId: sourceCase.creatorId,
              order: caseOrder,
            };

            // `caseName` was already disambiguated above against both live
            // and soft-deleted cases, so this create cannot collide on the
            // (projectId, name, className, source) unique tuple. We always
            // create a brand-new, distinct case and never resurrect a
            // tombstoned one — resurrecting inherited the dead case's stale
            // steps, field values, run links and version rows, and its
            // surviving version 1 then collided with the copy's own.
            const newCase = await tx.repositoryCases.create({
              data: {
                projectId: job.data.targetProjectId,
                name: caseName,
                className: sourceCase.className,
                source: sourceCase.source,
                ...caseFields,
                currentVersion: 1,
              },
            });

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
            if (sourceCase.caseTags.length > 0) {
              await tx.repositoryCaseTag.createMany({
                data: sourceCase.caseTags.map(
                  (ct: { tag: { id: number } }) => ({
                    caseId: newCase.id,
                    tagId: ct.tag.id,
                  })
                ),
                skipDuplicates: true,
              });
            }

            // f. Connect Issues (issues are global — connect by existing issue ID)
            if (sourceCase.caseIssues.length > 0) {
              await tx.repositoryCaseIssue.createMany({
                data: sourceCase.caseIssues.map(
                  (ci: { issue: { id: number } }) => ({
                    caseId: newCase.id,
                    issueId: ci.issue.id,
                  })
                ),
                skipDuplicates: true,
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
                // Step c created the copy's CaseFieldValues above, so this
                // mirrors them onto version 1. Without it a copied case opens
                // its own history with every custom field blank.
                copyFieldValues: true,
              });
            } else {
              // Move: preserve full version history with updated FKs
              const sourceVersions = sourceVersionsMap.get(sourceCase.id) ?? [];
              let lastVersionNumber = 1;
              for (const ver of sourceVersions) {
                // Snapshot states resolve through the same mapper as the live
                // row — the snapshot's own stateName drives the name match, so
                // history keeps its recorded state even when no moved case
                // currently holds it — then through the review gate, so
                // history can't point at a state the target project doesn't
                // have. Both resolvers are memoized at job level.
                const effectiveVerStateId = await resolveGatedState(
                  stateMapper.map(ver.stateId, ver.stateName)?.stateId ??
                    targetDefaultWorkflowStateId
                );
                const effectiveVerStateName =
                  stateMapper.targetName(effectiveVerStateId) ?? ver.stateName;
                const movedVersion = await tx.repositoryCaseVersions.create({
                  data: {
                    repositoryCaseId: newCase.id,
                    // Update location FKs to target
                    projectId: job.data.targetProjectId,
                    repositoryId: targetRepositoryId,
                    folderId: caseFolderId,
                    // Preserve static snapshot fields
                    staticProjectId: ver.staticProjectId,
                    staticProjectName: ver.staticProjectName,
                    folderName: ver.folderName,
                    templateId: ver.templateId,
                    templateName: ver.templateName,
                    name: ver.name,
                    stateId: effectiveVerStateId,
                    stateName: effectiveVerStateName,
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
                    // v3 rejects raw `null` for nullable Json columns on create;
                    // the DbNull sentinel writes SQL NULL (the snapshot's empty
                    // state). Mirrors lib/scim/services/* coercion.
                    steps: ver.steps ?? DbNull,
                    tags: ver.tags ?? DbNull,
                    issues: ver.issues ?? DbNull,
                    links: ver.links ?? DbNull,
                    attachments: ver.attachments ?? DbNull,
                  },
                });
                // Carry THIS snapshot's own field values across, not the live
                // case's — copying the current values onto every historical
                // version would rewrite the history the move is preserving.
                const versionFieldValues = ver.caseFieldVersionValues ?? [];
                if (versionFieldValues.length > 0) {
                  await tx.caseFieldVersionValues.createMany({
                    data: versionFieldValues.map(
                      (fvv: { field: string; value: unknown }) => ({
                        versionId: movedVersion.id,
                        field: fvv.field,
                        value: fvv.value ?? JsonNull,
                      })
                    ),
                  });
                }
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

            // Provenance link — within-project copies only
            if (
              job.data.operation === "copy" &&
              job.data.sourceProjectId === job.data.targetProjectId
            ) {
              await tx.repositoryCaseLink.create({
                data: {
                  caseAId: newCase.id,
                  caseBId: sourceCase.id,
                  type: "DUPLICATED_FROM",
                  createdById: job.data.userId,
                },
              });
            }

            return newCase.id;
          }
        );

        createdTargetIds.push({
          newId: newCaseId,
          sourceId: sourceCase.id,
        });
        result.copiedCount++;
      }
    } catch (err: any) {
      // Rollback: every entry is a freshly-created target case, so
      // hard-delete them all (cascade handles children).
      if (createdTargetIds.length > 0) {
        console.error(
          `Copy-move job ${job.id} failed — rolling back ${createdTargetIds.length} created cases.`
        );
        await db.repositoryCases.deleteMany({
          where: { id: { in: createdTargetIds.map((c) => c.newId) } },
        });
      }
      throw err;
    }

    // 10. Move: soft-delete only source cases that were actually copied —
    // guards against a fully-skipped move (every case hit a collision with
    // conflictResolution:"skip") deleting the originals.
    if (job.data.operation === "move" && createdTargetIds.length > 0) {
      const movedSourceIds = createdTargetIds.map((c) => c.sourceId);
      await db.repositoryCases.updateMany({
        where: { id: { in: movedSourceIds } },
        data: { isDeleted: true },
      });

      // `db` is the raw, plugin-free client (getDbClientForJob -> rawDb),
      // chosen so the bulk copy does not re-trigger the ES-sync hooks this
      // worker drives itself. The cost is that sideEffectsPlugin's
      // soft-delete hook never fires here, so the reviews in flight on the
      // source cases would stay PENDING against rows the inbox hides — the
      // assignee then gets a reminder every day for work they cannot open.
      // Cancel them explicitly, matching what the plugin would have done.
      // Sequential rather than in-transaction (the updateMany above has
      // already committed); a crash in between leaves an orphan that the
      // review-reminder worker's liveness gate retires on its next scan.
      try {
        const cancelled = await cancelReviewsForDeletedEntities(
          db as any,
          "CASE",
          movedSourceIds
        );
        if (cancelled.length > 0) {
          const names = new Map<number, string>(
            sourceCases.map((c: any) => [
              c.id as number,
              (c.name ?? "") as string,
            ])
          );
          const ctx = getAuditContext();
          void announceDeletionCancelledReviews(cancelled, names, {
            userId: ctx?.userId ?? job.data.userId ?? null,
            userName: ctx?.userName ?? null,
          }).catch((err) =>
            console.error(
              `Copy-move job ${job.id}: announcing reviews cancelled by move failed`,
              err
            )
          );
        }
      } catch (err) {
        console.error(
          `Copy-move job ${job.id}: cancelling reviews on moved-away source cases failed`,
          err
        );
      }

      // Move: soft-delete source FOLDERS after all cases soft-deleted
      if (job.data.folderTree && job.data.folderTree.length > 0) {
        const folderIds = job.data.folderTree.map((n) => n.sourceFolderId);
        await db.repositoryFolders.updateMany({
          where: { id: { in: folderIds } },
          data: { isDeleted: true },
        });
      }

      result.movedCount = result.copiedCount;
      result.copiedCount = 0;
    }

    // 11. Elasticsearch bulk sync after all cases committed (not per-case inside transaction)
    await job.updateProgress({
      processed: sourceCases.length,
      total: sourceCases.length,
      finalizing: true,
    });

    for (const { newId } of createdTargetIds) {
      syncRepositoryCaseToElasticsearch(newId, job.data.tenantId, db).catch(
        (err) => console.error(`ES sync failed for new case ${newId}:`, err)
      );
    }

    // For move: also remove the soft-deleted source cases from the ES index
    // (best-effort).
    if (job.data.operation === "move" && createdTargetIds.length > 0) {
      for (const { sourceId } of createdTargetIds) {
        syncRepositoryCaseToElasticsearch(
          sourceId,
          job.data.tenantId,
          db
        ).catch((err) =>
          console.error(
            `ES sync failed for moved source case ${sourceId}:`,
            err
          )
        );
      }
    }

    // 12. Cross-project case links (RepositoryCaseLink) are dropped silently
    // droppedLinkCount could be calculated here if needed; currently reported as 0
    result.droppedLinkCount = 0;

    // 12b. Audit logging — log bulk operation for created cases
    for (const { newId } of createdTargetIds) {
      captureAuditEvent({
        action: "CREATE",
        entityType: "RepositoryCases",
        entityId: String(newId),
        projectId: job.data.targetProjectId,
        userId: job.data.userId,
        tenantId: job.data.tenantId,
        metadata: {
          source: `copy-move:${job.data.operation}`,
          sourceProjectId: job.data.sourceProjectId,
          jobId: job.id,
        },
      }).catch(() => {}); // best-effort, don't fail the job
    }

    // Provenance audit — within-project copies only
    if (
      job.data.operation === "copy" &&
      job.data.sourceProjectId === job.data.targetProjectId
    ) {
      for (const { newId, sourceId } of createdTargetIds) {
        captureAuditEvent({
          action: "DUPLICATED",
          entityType: "RepositoryCases",
          entityId: String(newId),
          projectId: job.data.targetProjectId,
          userId: job.data.userId,
          tenantId: job.data.tenantId,
          metadata: {
            duplicatedFromCaseId: sourceId,
            sourceProjectId: job.data.sourceProjectId,
            targetFolderId: job.data.targetFolderId,
            jobId: job.id,
          },
        }).catch(() => {});
      }
    }

    // Audit logging — log soft-deletes for moved source cases. Sourced from
    // createdTargetIds (not job.data.caseIds) so skipped cases don't get a
    // false DELETE entry.
    if (job.data.operation === "move") {
      for (const { sourceId } of createdTargetIds) {
        captureAuditEvent({
          action: "DELETE",
          entityType: "RepositoryCases",
          entityId: String(sourceId),
          projectId: job.data.sourceProjectId,
          userId: job.data.userId,
          tenantId: job.data.tenantId,
          metadata: {
            source: "copy-move:move",
            targetProjectId: job.data.targetProjectId,
            jobId: job.id,
            softDelete: true,
          },
        }).catch(() => {});
      }
    }

    console.log(
      `Copy-move job ${job.id} completed: ` +
        `copied=${result.copiedCount} moved=${result.movedCount} skipped=${result.skippedCount} ` +
        `droppedLinks=${result.droppedLinkCount}`
    );

    return result;
  });

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
      withTenantContext(processor),
      {
        connection: valkeyConnection as any,
        prefix: BULLMQ_PREFIX,
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

    console.log(
      `Copy-move worker started for queue "${COPY_MOVE_QUEUE_NAME}".`
    );
  } else {
    console.warn(
      "Valkey connection not available. Copy-move worker not started."
    );
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

// Run the worker only when this file is executed directly (not on require)
if (require.main === module) {
  console.log("Copy-move worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start copy-move worker:", err);
    process.exit(1);
  });
}

export default worker;
export { processor, startWorker };
