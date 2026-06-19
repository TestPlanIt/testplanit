"use server";

import { ApplicationArea } from "@prisma/client";
import { z } from "zod/v4";
import { runWithAuditContext } from "~/lib/auditContext";
import { auditedTransaction } from "~/lib/audit/auditedTransaction";
import { prisma } from "~/lib/prisma";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import {
  AlreadyPendingError,
  isAlreadyPendingError,
  isReviewGateError,
} from "~/lib/utils/errors";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";
import { assertBulkReviewGatePasses } from "~/lib/services/reviewGate";
import { getServerAuthSession } from "~/server/auth";
import { checkUserPermission } from "./permissions";

const CompleteMilestoneSchema = z.object({
  milestoneId: z.number(),
  completionDate: z.date(),
  isPreview: z.boolean().optional(), // To check for dependencies without completing
  forceCompleteDependencies: z.boolean().optional(), // To force completion after user confirmation
  // NEW FIELDS - optional, defaults handled in destructuring
  completeTestRuns: z.boolean().optional(),
  completeSessions: z.boolean().optional(),
  testRunStateId: z.number().nullable().optional(),
  sessionStateId: z.number().nullable().optional(),
});

interface CompletionImpact {
  activeTestRuns: number;
  activeSessions: number;
  descendantMilestonesToComplete: number;
}

interface ServerActionResult {
  status: "success" | "confirmation_required" | "error";
  message?: string;
  impact?: CompletionImpact;
}

/**
 * Completes a milestone and, if confirmed, its active dependent test runs and sessions,
 * as well as descendant milestones.
 */
export async function completeMilestoneCascade(
  input: z.infer<typeof CompleteMilestoneSchema>
): Promise<ServerActionResult> {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return { status: "error", message: "User not authenticated" };
  }

  return runWithAuditContext(
    {
      userId: session.user.id,
      userName: session.user.name ?? undefined,
      userEmail: session.user.email ?? undefined,
    },
    async () => {
  const parseResult = CompleteMilestoneSchema.safeParse(input);
  if (!parseResult.success) {
    return { status: "error", message: "Invalid input." };
  }

  const {
    milestoneId,
    completionDate,
    isPreview: _isPreview,
    forceCompleteDependencies,
    completeTestRuns = true,
    completeSessions = true,
    testRunStateId,
    sessionStateId,
  } = parseResult.data;

  // Fetch the milestone to check its current status and get projectId
  const currentMilestone = await prisma.milestones.findUnique({
    where: { id: milestoneId },
    select: { startedAt: true, projectId: true },
  });

  if (!currentMilestone) {
    return { status: "error", message: "Milestone not found." };
  }

  const { projectId } = currentMilestone;

  // Check user permission to complete milestones in this project
  const hasPermission = await checkUserPermission(
    session.user.id,
    projectId,
    session,
    ApplicationArea.Milestones,
    "canClose"
  );

  if (!hasPermission) {
    return {
      status: "error",
      message:
        "You do not have permission to complete milestones in this project.",
    };
  }

  // --- Determine target completed stateId for Test Runs ---
  let completedTestRunStateId: number | undefined = undefined;
  if (completeTestRuns) {
    if (testRunStateId !== null && testRunStateId !== undefined) {
      // User explicitly selected a state
      completedTestRunStateId = testRunStateId;
    } else {
      // Fallback to lowest order DONE workflow (existing behavior)
      const doneRunWorkflow = await prisma.workflows.findFirst({
        where: {
          scope: "RUNS",
          workflowType: "DONE",
          isEnabled: true,
          isDeleted: false,
          projects: { some: { projectId: projectId } },
        },
        orderBy: { order: "asc" }, // Get the one with the lowest order
        select: { id: true },
      });
      if (doneRunWorkflow) {
        completedTestRunStateId = doneRunWorkflow.id;
      } else {
        console.warn(
          `No 'DONE' workflow found for RUNS in project ${projectId}. Test Run states will not be updated, only isCompleted flag.`
        );
      }
    }
  }

  // --- Determine target completed stateId for Sessions ---
  let completedSessionStateId: number | undefined = undefined;
  if (completeSessions) {
    if (sessionStateId !== null && sessionStateId !== undefined) {
      // User explicitly selected a state
      completedSessionStateId = sessionStateId;
    } else {
      // Fallback to lowest order DONE workflow (existing behavior)
      const doneSessionWorkflow = await prisma.workflows.findFirst({
        where: {
          scope: "SESSIONS",
          workflowType: "DONE",
          isEnabled: true,
          isDeleted: false,
          projects: { some: { projectId: projectId } },
        },
        orderBy: { order: "asc" }, // Get the one with the lowest order
        select: { id: true },
      });
      if (doneSessionWorkflow) {
        completedSessionStateId = doneSessionWorkflow.id;
      } else {
        console.warn(
          `No 'DONE' workflow found for SESSIONS in project ${projectId}. Session states will not be updated, only isCompleted flag.`
        );
      }
    }
  }

  // WR-04: pre-fetch the project's reviewWorkflowEnabled flag ONCE here so
  // the per-entity preflight loop inside the transaction can short-circuit
  // when the project has opted out of review. Doing this outside the tx
  // keeps a contended write transaction short under deadlock-prone
  // conditions (project memory `Deadlock Issues (40P01)`).
  const projectReviewFlag = await prisma.projects.findUnique({
    where: { id: projectId },
    select: { reviewWorkflowEnabled: true },
  });
  const projectReviewEnabled = projectReviewFlag?.reviewWorkflowEnabled ?? true;

  // --- Database Logic ---
  const descendantMilestoneIds =
    await getAllDescendantMilestoneIds(milestoneId);
  const allRelevantMilestoneIds = [milestoneId, ...descendantMilestoneIds];

  // Strict-transitive gate: caller pre-loads each entity's current state
  // `order` so the bulk preflight can detect blocking gates in (currentOrder,
  // targetOrder] per entity without a per-row roundtrip inside the tx.
  // `name` is loaded so a gate-rejected error message can refer to the
  // entity by name (e.g. "run 'Sprint 2 - Regression'") instead of numeric id.
  const activeTestRuns = await prisma.testRuns.findMany({
    where: {
      milestoneId: { in: allRelevantMilestoneIds },
      isCompleted: false,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      state: { select: { order: true } },
    },
  });

  const activeSessions = await prisma.sessions.findMany({
    where: {
      milestoneId: { in: allRelevantMilestoneIds },
      isCompleted: false,
      isDeleted: false,
    },
    select: {
      id: true,
      name: true,
      state: { select: { order: true } },
    },
  });

  // Descendant milestones that are not yet complete (excluding the main one being completed)
  const descendantMilestonesToComplete = await prisma.milestones.findMany({
    where: {
      id: { in: descendantMilestoneIds }, // Only look within descendants
      isCompleted: false,
      isDeleted: false,
    },
    select: { id: true }, // Only select IDs for counting and updating
  });

  const impact: CompletionImpact = {
    activeTestRuns: activeTestRuns.length,
    activeSessions: activeSessions.length,
    descendantMilestonesToComplete: descendantMilestonesToComplete.length,
  };

  if (
    (impact.activeTestRuns > 0 ||
      impact.activeSessions > 0 ||
      impact.descendantMilestonesToComplete > 0) &&
    !forceCompleteDependencies
  ) {
    return {
      status: "confirmation_required",
      impact: impact,
    };
  }

  try {
    await auditedTransaction(async (tx: any) => {
      // Resolve the system-level review-feature flag once for both the
      // testRuns and sessions blocks below. AppConfig read is cheap and
      // hoisting avoids two roundtrips inside this long-lived write tx.
      const reviewFeatureSystemEnabled = await isReviewFeatureSystemEnabled(tx);

      // Complete main milestone
      await tx.milestones.update({
        where: { id: milestoneId },
        data: {
          isCompleted: true,
          completedAt: completionDate,
          isStarted: true,
          startedAt: currentMilestone.startedAt ?? completionDate,
        },
      });

      // Complete descendant milestones
      if (descendantMilestonesToComplete.length > 0) {
        await tx.milestones.updateMany({
          where: {
            id: {
              in: descendantMilestonesToComplete.map(
                (m: { id: number }) => m.id
              ),
            },
          },
          data: {
            isCompleted: true,
            completedAt: completionDate,
            isStarted: true,
            startedAt: completionDate,
          },
        });
      }

      // Complete active test runs - only if user opted in
      if (completeTestRuns && activeTestRuns.length > 0) {
        const testRunUpdateData: {
          isCompleted: boolean;
          completedAt: Date;
          stateId?: number;
        } = {
          isCompleted: true,
          completedAt: completionDate,
        };
        if (completedTestRunStateId !== undefined) {
          testRunUpdateData.stateId = completedTestRunStateId;
        }

        // Review & Approval preflight. Strict-transitive semantics: a
        // milestone completion that crosses multiple gated states needs an
        // approval for EACH gate per entity, not just the target. The bulk
        // helper batches all of that into 3 queries total (target + gates +
        // approvals) and returns the union of approval ids to stamp post-
        // update. Project + system feature flags are short-circuited here
        // so a no-review project still pays no review cost.
        let consumedApprovalIds: string[] = [];
        if (
          projectReviewEnabled &&
          reviewFeatureSystemEnabled &&
          completedTestRunStateId !== undefined &&
          testRunUpdateData.stateId !== undefined
        ) {
          const gateResult = await assertBulkReviewGatePasses(
            tx,
            "RUN",
            activeTestRuns.map(
              (tr: { id: number; state: { order: number } | null }) => ({
                id: tr.id,
                currentStateOrder: tr.state?.order ?? null,
              })
            ),
            completedTestRunStateId
          );
          consumedApprovalIds = gateResult?.approvedRequestIds ?? [];
        }

        await tx.testRuns.updateMany({
          where: {
            id: { in: activeTestRuns.map((tr: { id: number }) => tr.id) },
          },
          data: testRunUpdateData,
        });

        // Stamp consumedAt on every approval the bulk gate consumed so
        // future transitions can't re-use them. Short stamp count means
        // another caller raced us — surface as REVIEW_REQUIRED.
        if (consumedApprovalIds.length > 0) {
          const stamp = await tx.reviewRequest.updateMany({
            where: {
              id: { in: consumedApprovalIds },
              consumedAt: null,
            },
            data: { consumedAt: new Date() },
          });
          if (stamp.count !== consumedApprovalIds.length) {
            const { ReviewGateError } = await import("~/lib/utils/errors");
            throw new ReviewGateError(
              "REVIEW_REQUIRED",
              "RUN",
              activeTestRuns[0]?.id ?? 0,
              completedTestRunStateId!
            );
          }
        }
      }

      // Complete active sessions - only if user opted in
      if (completeSessions && activeSessions.length > 0) {
        const sessionUpdateData: {
          isCompleted: boolean;
          completedAt: Date;
          stateId?: number;
        } = {
          isCompleted: true,
          completedAt: completionDate,
        };
        if (completedSessionStateId !== undefined) {
          sessionUpdateData.stateId = completedSessionStateId;
        }

        let consumedSessionApprovalIds: string[] = [];
        if (
          projectReviewEnabled &&
          reviewFeatureSystemEnabled &&
          completedSessionStateId !== undefined &&
          sessionUpdateData.stateId !== undefined
        ) {
          const gateResult = await assertBulkReviewGatePasses(
            tx,
            "SESSION",
            activeSessions.map(
              (s: { id: number; state: { order: number } | null }) => ({
                id: s.id,
                currentStateOrder: s.state?.order ?? null,
              })
            ),
            completedSessionStateId
          );
          consumedSessionApprovalIds = gateResult?.approvedRequestIds ?? [];
        }

        await tx.sessions.updateMany({
          where: {
            id: { in: activeSessions.map((s: { id: number }) => s.id) },
          },
          data: sessionUpdateData,
        });

        if (consumedSessionApprovalIds.length > 0) {
          const stamp = await tx.reviewRequest.updateMany({
            where: {
              id: { in: consumedSessionApprovalIds },
              consumedAt: null,
            },
            data: { consumedAt: new Date() },
          });
          if (stamp.count !== consumedSessionApprovalIds.length) {
            const { ReviewGateError } = await import("~/lib/utils/errors");
            throw new ReviewGateError(
              "REVIEW_REQUIRED",
              "SESSION",
              activeSessions[0]?.id ?? 0,
              completedSessionStateId!
            );
          }
        }
      }
    });

    // Success path returns no `message`; the client renders a localized
    // toast based on whether dependencies were involved.
    return { status: "success" };
  } catch (error) {
    // Review & Approval (Plan 01-04). When a per-entity preflight rejects
    // an in-flight cascade, surface the typed code through the server
    // action's existing failure shape so the client can render a "review
    // required" message instead of a generic "Failed to complete" toast.
    if (isReviewGateError(error)) {
      // Build a human-readable message: name the FAILED entity and the
      // BLOCKING gate (which may differ from `toStateId` under strict-
      // transitive semantics — e.g. target "Done" but the first missing
      // approval is for "Active"). `entityName` comes from the in-memory
      // arrays we already fetched above; `blockingStateName` is looked up
      // once here so the catch block doesn't pay for it on the happy path.
      const entityName = findEntityName(
        error.entityType,
        error.entityId,
        activeTestRuns,
        activeSessions
      );
      const blockingStateId = error.blockingStateId ?? error.toStateId;
      const blockingState = await prisma.workflows.findUnique({
        where: { id: blockingStateId },
        select: { name: true },
      });
      const blockingStateName =
        blockingState?.name ?? `state ${blockingStateId}`;
      const entityLabel = entityName
        ? `${error.entityType.toLowerCase()} "${entityName}"`
        : `${error.entityType.toLowerCase()} ${error.entityId}`;
      return {
        status: "error",
        message: `Review required for ${entityLabel} before transitioning to "${blockingStateName}".`,
      };
    }

    if (isAlreadyPendingError(error)) {
      const entityName =
        error instanceof AlreadyPendingError
          ? findEntityName(
              error.entityType,
              error.entityId,
              activeTestRuns,
              activeSessions
            )
          : null;
      const message =
        error instanceof AlreadyPendingError
          ? entityName
            ? `A pending review already exists for the ${error.entityType.toLowerCase()} "${entityName}".`
            : `A pending review already exists for the ${error.entityType.toLowerCase()} ${error.entityId}.`
          : "A pending review already exists for this entity.";
      return {
        status: "error",
        message,
      };
    }

    console.error("Error during actual milestone completion:", error);
    let message = "Failed to complete milestone.";
    if (error instanceof Error) {
      message = `Failed to complete milestone: ${error.message}`;
    }
    return { status: "error", message };
  }
  }); // end runWithAuditContext
}

/**
 * Resolve the entity's display name for a gate-rejected error message.
 * Reads from the in-memory arrays the caller fetched before the tx so
 * the catch block doesn't pay for a separate roundtrip on the unhappy path.
 * Returns `null` when the entity isn't in either array (shouldn't happen
 * for the milestone-cascade path, but the catch block falls back to the
 * raw id in that case).
 */
function findEntityName(
  entityType: string,
  entityId: number,
  testRuns: Array<{ id: number; name: string | null }>,
  sessions: Array<{ id: number; name: string | null }>
): string | null {
  if (entityType === "RUN") {
    return testRuns.find((r) => r.id === entityId)?.name ?? null;
  }
  if (entityType === "SESSION") {
    return sessions.find((s) => s.id === entityId)?.name ?? null;
  }
  return null;
}
