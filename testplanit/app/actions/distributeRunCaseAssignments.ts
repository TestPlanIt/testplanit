"use server";

import { revalidatePath } from "next/cache";
import { withActionAuditContext } from "~/lib/auditContextWrappers";
import {
  buildDistributionPlan,
  type AssignableUnit,
  type DistributePlan,
  type DistributeStrategy,
  type ReassignMode,
  type WeightBy,
} from "~/lib/services/distributeAssignments";
import { getEnhancedDb } from "~/lib/auth/utils";
import { getServerAuthSession } from "~/server/auth";
import { getProjectEffectiveMembers } from "./getProjectEffectiveMembers";
import { notifyBulkTestCaseAssignment } from "./test-run-notifications";

export interface DistributeAssignmentsInput {
  /** The sibling/config runs to distribute across (one entry for a single run). */
  runIds: number[];
  projectId: number;
  options: {
    userIds: string[];
    strategy: DistributeStrategy;
    groupBySections: boolean;
    reassignMode: ReassignMode;
    weightBy: WeightBy;
    includeCompleted?: boolean;
  };
  /** When true, compute and return the plan without writing anything. */
  dryRun: boolean;
}

export type DistributeAssignmentsResult =
  | { success: true; plan: DistributePlan; committed: boolean }
  | { success: false; error: string };

/**
 * Distribute test-run-case assignments across the selected team members using
 * the pure `buildDistributionPlan` algorithm. The same code path serves the
 * modal's live preview (`dryRun: true`) and the commit, so what a user previews
 * is exactly what lands.
 *
 * Uses the enhanced (policy) client so ZenStack `@@allow('update')` and the
 * completed-run `@@deny` are enforced as backstops, and the side-effects plugin
 * still runs. (TestRunCases actor attribution rolls up under TestRuns via CDC,
 * matching the existing inline/bulk assign controls; a raw `withAuditGuc` write
 * would attribute per-row but would bypass policy — not worth the trade here.)
 */
export const distributeRunCaseAssignments = withActionAuditContext(
  async (
    input: DistributeAssignmentsInput
  ): Promise<DistributeAssignmentsResult> => {
    const session = await getServerAuthSession();
    if (!session?.user?.id) {
      return { success: false, error: "unauthorized" };
    }

    const { runIds, projectId, options, dryRun } = input;
    const uniqueRunIds = [...new Set(runIds)];
    if (uniqueRunIds.length === 0) {
      return { success: false, error: "runNotFound" };
    }

    try {
      const db = await getEnhancedDb(session);

      // 1. Runs must all be readable, in this project, and not completed.
      const runs = await db.testRuns.findMany({
        where: { id: { in: uniqueRunIds }, isDeleted: false },
        select: { id: true, isCompleted: true, projectId: true },
      });
      if (runs.length !== uniqueRunIds.length) {
        return { success: false, error: "runNotFound" };
      }
      if (runs.some((r) => r.projectId !== projectId)) {
        return { success: false, error: "projectMismatch" };
      }
      if (runs.some((r) => r.isCompleted)) {
        return { success: false, error: "runCompleted" };
      }

      // 2. Only distribute to real project members.
      const memberIds = new Set(await getProjectEffectiveMembers(projectId));
      const userIds = options.userIds.filter((id) => memberIds.has(id));
      if (userIds.length === 0) {
        return { success: false, error: "needUsers" };
      }

      // 3. Read the run cases with the fields the algorithm needs.
      const cases = await db.testRunCases.findMany({
        where: { testRunId: { in: uniqueRunIds }, isDeleted: false },
        select: {
          id: true,
          testRunId: true,
          repositoryCaseId: true,
          assignedToId: true,
          isCompleted: true,
          repositoryCase: {
            select: {
              folderId: true,
              order: true,
              estimate: true,
              repositoryId: true,
              caseTags: { select: { tagId: true } },
            },
          },
        },
      });
      if (cases.length === 0) {
        return { success: false, error: "noAssignable" };
      }

      // 4. Build folderId → root→leaf order path (prefixed with repositoryId).
      const repositoryIds = [
        ...new Set(cases.map((c) => c.repositoryCase.repositoryId)),
      ];
      const folders = await db.repositoryFolders.findMany({
        where: { repositoryId: { in: repositoryIds }, isDeleted: false },
        select: { id: true, parentId: true, order: true, repositoryId: true },
      });
      const folderById = new Map(folders.map((f) => [f.id, f]));
      const pathCache = new Map<number, number[]>();
      const folderOrderPath = (folderId: number): number[] => {
        const cached = pathCache.get(folderId);
        if (cached) return cached;
        const chain: number[] = [];
        let cursor: number | null = folderId;
        const seen = new Set<number>();
        let repositoryId = 0;
        while (cursor != null && !seen.has(cursor)) {
          seen.add(cursor);
          const folder = folderById.get(cursor);
          if (!folder) break;
          chain.unshift(folder.order);
          repositoryId = folder.repositoryId;
          cursor = folder.parentId;
        }
        const path = [repositoryId, ...chain];
        pathCache.set(folderId, path);
        return path;
      };

      const units: AssignableUnit[] = cases.map((c) => ({
        testRunCaseId: c.id,
        repositoryCaseId: c.repositoryCaseId,
        runId: c.testRunId,
        folderId: c.repositoryCase.folderId,
        folderOrderPath: folderOrderPath(c.repositoryCase.folderId),
        caseOrder: c.repositoryCase.order,
        estimate: c.repositoryCase.estimate,
        tagIds: c.repositoryCase.caseTags.map((t) => t.tagId),
        isCaseCompleted: c.isCompleted,
        currentAssigneeId: c.assignedToId,
      }));

      const plan = buildDistributionPlan(units, {
        userIds,
        strategy: options.strategy,
        groupBySections: options.groupBySections,
        reassignMode: options.reassignMode,
        includeCompleted: options.includeCompleted ?? false,
        weightBy: options.weightBy,
      });

      if (dryRun) {
        return { success: true, plan, committed: false };
      }

      // 5. Commit — one updateMany per target user, skipping no-ops.
      const currentAssignee = new Map(cases.map((c) => [c.id, c.assignedToId]));
      const idsByUser = new Map<string, number[]>();
      for (const a of plan.assignments) {
        if (currentAssignee.get(a.testRunCaseId) === a.assignedToId) continue;
        const list = idsByUser.get(a.assignedToId);
        if (list) list.push(a.testRunCaseId);
        else idsByUser.set(a.assignedToId, [a.testRunCaseId]);
      }

      for (const [userId, ids] of idsByUser) {
        await db.testRunCases.updateMany({
          where: { id: { in: ids } },
          data: { assignedToId: userId },
        });
      }

      // 6. Notify each assignee (best-effort — never fail the distribution).
      await Promise.allSettled(
        [...idsByUser].map(([userId, ids]) =>
          notifyBulkTestCaseAssignment(ids, userId, projectId)
        )
      );

      for (const runId of uniqueRunIds) {
        revalidatePath(`/projects/runs/${projectId}/${runId}`);
      }

      return { success: true, plan, committed: true };
    } catch (error) {
      console.error("Error distributing run case assignments:", error);
      return { success: false, error: "internalError" };
    }
  }
);
