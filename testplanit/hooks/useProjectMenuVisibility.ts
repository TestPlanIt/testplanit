"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useSession } from "next-auth/react";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { ApplicationArea } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

export type ProjectMenuVisibility = {
  requirementsEnabled: boolean;
  failureTriageEnabled: boolean;
  canSeeSharedSteps: boolean;
  canSeeReports: boolean;
  canSeeSettings: boolean;
  canSeeAuditLogs: boolean;
};

/**
 * Which optional project menu entries the viewer sees. The project menu and the
 * project tour both read it, so a tour step exists exactly when its menu link does.
 */
export function useProjectMenuVisibility(
  projectId: string | number | undefined
): ProjectMenuVisibility {
  const { data: session } = useSession();
  const numericId = Number(projectId);

  // Requirements is opt-in per project. Teams whose source of truth is their
  // tracker never turn it on and should not carry a permanently empty section
  // in the menu; the flag lives on the project rather than on an integration's
  // config because a project with no tracker at all is exactly the case the
  // feature was asked for (requirements authored natively in TestPlanIt).
  const { data: project } = useClientQueries(schema).projects.useFindUnique(
    {
      where: { id: numericId },
      select: { requirementsEnabled: true, failureTriageEnabled: true },
    },
    { enabled: Boolean(projectId) && !isNaN(numericId) }
  );

  const safeProjectId = projectId ? String(projectId) : "";
  const { permissions: sharedStepsPerms } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.SharedSteps
  );
  const { permissions: reportingPerms } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.Reporting
  );
  // Settings and the project audit log are for project admins.
  // `isProjectAdmin` is the server's own resolution — the same one the
  // settings pages, their server actions and the write policies gate on:
  // 1. System ADMIN users (always have access to all projects)
  // 2. System PROJECTADMIN users, on projects they are assigned to
  // 3. Users whose effective project role carries Settings canAddEdit
  // 4. The project's creator
  const { isProjectAdmin } = useProjectPermissions(
    safeProjectId,
    ApplicationArea.Settings
  );

  return {
    requirementsEnabled: project?.requirementsEnabled === true,
    failureTriageEnabled: project?.failureTriageEnabled === true,
    canSeeSharedSteps: !!(
      sharedStepsPerms &&
      (sharedStepsPerms.canAddEdit || sharedStepsPerms.canDelete)
    ),
    canSeeReports: !!(
      reportingPerms &&
      (reportingPerms.canAddEdit || reportingPerms.canDelete)
    ),
    canSeeSettings: !!isProjectAdmin,
    canSeeAuditLogs:
      !!isProjectAdmin ||
      session?.user?.access === "ADMIN" ||
      session?.user?.access === "PROJECTADMIN",
  };
}
