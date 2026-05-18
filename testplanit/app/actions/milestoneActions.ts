"use server";

import { ApplicationArea } from "@prisma/client";
import { z } from "zod/v4";
import { prisma } from "~/lib/prisma";
import { getAllDescendantMilestoneIds } from "~/lib/services/milestoneDescendants";
import {
  AlreadyPendingError,
  isAlreadyPendingError,
  isReviewGateError,
} from "~/lib/utils/errors";
import { isReviewFeatureSystemEnabled } from "~/lib/services/reviewFeatureFlag";
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

  const activeTestRuns = await prisma.testRuns.findMany({
    where: {
      milestoneId: { in: allRelevantMilestoneIds },
      isCompleted: false,
      isDeleted: false,
    },
    select: { id: true }, // Only select IDs for counting and updating
  });

  const activeSessions = await prisma.sessions.findMany({
    where: {
      milestoneId: { in: allRelevantMilestoneIds },
      isCompleted: false,
      isDeleted: false,
    },
    select: { id: true }, // Only select IDs for counting and updating
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
    await prisma.$transaction(async (tx: any) => {
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

        // Review & Approval preflight (Plan 01-04). Milestone completion
        // typically targets DONE workflow states which are unlikely to have
        // requiresReview === true (review gates land on intermediate states,
        // not DONE per RESEARCH.md §Q6). Cheap target-state guard first:
        // skip the gate entirely when the target state is ungated or the
        // project has opted out. If it IS gated, batch the per-entity
        // ReviewRequest lookup into a single findMany (WR-04) — the old loop
        // fired ~3N queries inside this long-lived write tx, which is both
        // slow and deadlock-prone.
        // FIXME(milestoneActions): this block still uses the per-state gate
        // model (single target-state approval lookup). Strict transitive
        // semantics aren't enforced here — a milestone completion that
        // crosses multiple gated states bulk-validates only the FINAL
        // target. Tracked separately; the in-route direct-transition paths
        // (case page autoAPI, bulk-edit, submit-result) are strict.
        let consumedApprovalIds: string[] = [];
        if (
          projectReviewEnabled &&
          reviewFeatureSystemEnabled &&
          completedTestRunStateId !== undefined &&
          testRunUpdateData.stateId !== undefined
        ) {
          const targetTestRunState = await tx.workflows.findUnique({
            where: { id: completedTestRunStateId },
            select: { requiresReview: true },
          });
          if (targetTestRunState?.requiresReview) {
            const trIds = activeTestRuns.map((tr: { id: number }) => tr.id);
            const approvedRequests = await tx.reviewRequest.findMany({
              where: {
                entityType: "RUN",
                entityId: { in: trIds },
                toStateId: completedTestRunStateId,
                status: "APPROVED",
                consumedAt: null,
                isDeleted: false,
              },
              select: { id: true, entityId: true },
            });
            const approvedEntityIds = new Set(
              approvedRequests.map((r: { entityId: number }) => r.entityId)
            );
            const missing = trIds.find(
              (id: number) => !approvedEntityIds.has(id)
            );
            if (missing !== undefined) {
              const { ReviewGateError } = await import("~/lib/utils/errors");
              throw new ReviewGateError(
                "REVIEW_REQUIRED",
                "RUN",
                missing,
                completedTestRunStateId
              );
            }
            consumedApprovalIds = approvedRequests.map(
              (r: { id: string }) => r.id
            );
          }
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

        // FIXME(milestoneActions): see the testRuns block above — same
        // per-state caveat under strict transitive semantics.
        let consumedSessionApprovalIds: string[] = [];
        if (
          projectReviewEnabled &&
          reviewFeatureSystemEnabled &&
          completedSessionStateId !== undefined &&
          sessionUpdateData.stateId !== undefined
        ) {
          const targetSessionState = await tx.workflows.findUnique({
            where: { id: completedSessionStateId },
            select: { requiresReview: true },
          });
          if (targetSessionState?.requiresReview) {
            const sessionIds = activeSessions.map((s: { id: number }) => s.id);
            const approvedRequests = await tx.reviewRequest.findMany({
              where: {
                entityType: "SESSION",
                entityId: { in: sessionIds },
                toStateId: completedSessionStateId,
                status: "APPROVED",
                consumedAt: null,
                isDeleted: false,
              },
              select: { id: true, entityId: true },
            });
            const approvedEntityIds = new Set(
              approvedRequests.map((r: { entityId: number }) => r.entityId)
            );
            const missing = sessionIds.find(
              (id: number) => !approvedEntityIds.has(id)
            );
            if (missing !== undefined) {
              const { ReviewGateError } = await import("~/lib/utils/errors");
              throw new ReviewGateError(
                "REVIEW_REQUIRED",
                "SESSION",
                missing,
                completedSessionStateId
              );
            }
            consumedSessionApprovalIds = approvedRequests.map(
              (r: { id: string }) => r.id
            );
          }
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
      return {
        status: "error",
        message: `Review required for ${error.entityType.toLowerCase()} ${error.entityId} before transitioning to state ${error.toStateId}.`,
      };
    }

    if (isAlreadyPendingError(error)) {
      const message =
        error instanceof AlreadyPendingError
          ? `A pending review already exists for the ${error.entityType.toLowerCase()} ${error.entityId}.`
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
}

// Remove the old placeholder helper function if it exists at the end of the file
// async function getAllDescendantMilestoneIds(milestoneId: number): Promise<number[]> {
//   // Recursive query to get all descendant IDs
//   return [];
// }
