import { NotificationService } from "~/lib/services/notificationService";
import { readUpdateCasesOptions } from "~/lib/webhooks/actions/schemas";
import { reviewersOf, upkeepRecipients } from "./recipients";

interface WaitingSuggestion {
  id: number;
  projectId: number;
  issueId: number;
  webhookActionId: string | null;
  case: { id: number; reviewedById: string | null };
  issue: { name: string; externalKey: string | null; title: string };
}

/**
 * Remind people about suggested changes nobody has decided: those made before
 * `cutoff` that have not been reminded about since. One reminder per person,
 * issue and rule, however many of the issue's cases have a suggestion
 * waiting, sent to the same people the suggestions were announced to. Called
 * from the hourly review-reminder scan, which supplies its own threshold.
 */
export async function remindAboutWaitingSuggestions(
  db: any,
  params: { cutoff: Date; now: Date; tenantId?: string }
): Promise<{ reminders: number; suggestions: number }> {
  const { cutoff, now, tenantId } = params;
  const waiting: WaitingSuggestion[] = await db.caseChangeSuggestion.findMany({
    where: {
      status: "PENDING",
      createdAt: { lt: cutoff },
      OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lt: cutoff } }],
      case: { isDeleted: false },
      issue: { isDeleted: false },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      projectId: true,
      issueId: true,
      webhookActionId: true,
      case: { select: { id: true, reviewedById: true } },
      issue: { select: { name: true, externalKey: true, title: true } },
    },
  });

  const groups = new Map<string, WaitingSuggestion[]>();
  for (const suggestion of waiting) {
    const key = `${suggestion.projectId}:${suggestion.issueId}:${suggestion.webhookActionId ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), suggestion]);
  }

  let reminders = 0;
  for (const group of groups.values()) {
    const first = group[0];
    const [rule, project] = await Promise.all([
      first.webhookActionId
        ? db.webhookAction.findUnique({
            where: { id: first.webhookActionId },
            select: { options: true },
          })
        : null,
      db.projects.findUnique({
        where: { id: first.projectId },
        select: { name: true },
      }),
    ]);
    const recipients = await upkeepRecipients(db, {
      projectId: first.projectId,
      issueId: first.issueId,
      options: readUpdateCasesOptions(rule?.options),
      alsoTell: await reviewersOf(
        db,
        group.map((suggestion) => suggestion.case)
      ),
    });
    for (const userId of recipients) {
      await NotificationService.createCasesUpdatedNotification({
        userId,
        kind: "reminder",
        projectId: first.projectId,
        projectName: project?.name ?? "",
        issueId: first.issueId,
        issueKey: first.issue.externalKey ?? first.issue.name,
        issueTitle: first.issue.title,
        suggested: group.length,
        tenantId,
      });
      reminders++;
    }
    // Stamped even when nobody could be told, so the scan does not look the
    // same suggestions up again every hour.
    await db.caseChangeSuggestion.updateMany({
      where: { id: { in: group.map((suggestion) => suggestion.id) } },
      data: { lastRemindedAt: now },
    });
  }
  return { reminders, suggestions: waiting.length };
}
