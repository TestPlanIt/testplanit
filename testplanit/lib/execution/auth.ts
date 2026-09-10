import type { Session } from "next-auth";
import { ApplicationArea } from "~/zenstack/models";
import { userCanAddEditArea } from "~/lib/services/projectPermissions";
import { canManageWebhookConfig } from "~/lib/webhooks/auth";

/**
 * Who may create, edit, verify or delete a project's execution targets.
 * Mirrors the write policy on ProjectCodeRepositoryConfig: system admins,
 * project admins (creator / "Project Admin" role / global PROJECTADMIN on an
 * assigned project), and anyone whose role grants add/edit on Settings.
 */
export async function canManageExecutionTargets(
  session: Session,
  projectId: number
): Promise<boolean> {
  if (await canManageWebhookConfig(session, projectId)) return true;
  const userId = session.user?.id;
  if (!userId) return false;
  return userCanAddEditArea(
    userId,
    projectId,
    ApplicationArea.Settings,
    session.user.access
  );
}
