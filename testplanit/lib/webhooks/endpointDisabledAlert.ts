import { SYSTEM_PROJECT_ID } from "~/lib/scim/constants";
import {
  activeOrSystemAdmins,
  projectAdminIds,
} from "~/lib/services/caseUpkeep/recipients";
import { NotificationService } from "~/lib/services/notificationService";

/**
 * Tell the people who look after an outbound webhook endpoint that it was
 * switched off after too many failed deliveries in a row: the project's
 * creator and its project administrators, or the system administrators when
 * none of them is an active user. A system-level endpoint has no project, so
 * the system administrators are told. Returns how many people were told.
 */
export async function notifyEndpointDisabled(
  db: any,
  params: { webhookConfigId: string; tenantId?: string }
): Promise<number> {
  const config: {
    name: string | null;
    adapterType: string;
    projectId: number;
  } | null = await db.webhookConfig.findUnique({
    where: { id: params.webhookConfigId },
    select: { name: true, adapterType: true, projectId: true },
  });
  if (!config) return 0;

  const isSystem = config.projectId === SYSTEM_PROJECT_ID;
  const project: { name: string } | null = isSystem
    ? null
    : await db.projects.findUnique({
        where: { id: config.projectId },
        select: { name: true },
      });
  const recipients = await activeOrSystemAdmins(
    db,
    isSystem ? [] : await projectAdminIds(db, config.projectId)
  );

  await Promise.all(
    recipients.map((userId) =>
      NotificationService.createWebhookEndpointDisabledNotification({
        userId,
        webhookConfigId: params.webhookConfigId,
        endpointName: config.name?.trim() || config.adapterType,
        projectId: isSystem ? null : config.projectId,
        projectName: project?.name ?? "",
        tenantId: params.tenantId,
      })
    )
  );
  return recipients.length;
}
