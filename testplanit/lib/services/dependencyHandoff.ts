/**
 * The handoff half of dependency gating: once a prerequisite passes and a
 * dependant's gate opens, its assignee is told the case is ready. Same
 * notification pipeline as an assignment (in-app plus email, subject to the
 * user's preferences).
 *
 * Called after the result transaction commits with the dependants that
 * transaction resolved (`findUnblockedDependants`). Only the not-passed →
 * passed transition of a prerequisite reaches here, so re-submitting an
 * already-passed result never re-notifies.
 */

import { NotificationService } from "~/lib/services/notificationService";
import type { UnblockedDependant } from "~/lib/services/dependencyGate";

export interface NotifyUnblockedDependantsParams {
  dependants: UnblockedDependant[];
  /** Who recorded the prerequisite's result; never notified about their own action. */
  actorUserId: string;
  testRunId: number;
  testRunName: string;
  projectId: number;
  projectName: string;
  /** The prerequisite that just passed, named in the notification. */
  prerequisiteCaseName: string;
}

/**
 * Notifies each unblocked dependant's assignee. Unassigned dependants have
 * nobody to hand off to and are skipped; so is the actor, who already knows.
 * Never throws: a delivery failure is logged, not surfaced to the result
 * writer.
 */
export async function notifyUnblockedDependants(
  params: NotifyUnblockedDependantsParams
): Promise<void> {
  const targets = params.dependants.filter(
    (d) => d.assignedToId && d.assignedToId !== params.actorUserId
  );
  for (const dependant of targets) {
    try {
      await NotificationService.createRunCaseUnblockedNotification({
        userId: dependant.assignedToId as string,
        testRunId: params.testRunId,
        testRunName: params.testRunName,
        projectId: params.projectId,
        projectName: params.projectName,
        testRunCaseId: dependant.testRunCaseId,
        testCaseId: dependant.repositoryCaseId,
        testCaseName: dependant.name,
        prerequisiteCaseName: params.prerequisiteCaseName,
        unblockedById: params.actorUserId,
      });
    } catch (error) {
      console.error(
        `[dependencyHandoff] Failed to notify assignee of run case ${dependant.testRunCaseId}:`,
        error
      );
    }
  }
}
