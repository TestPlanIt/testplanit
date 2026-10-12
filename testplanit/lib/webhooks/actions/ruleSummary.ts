import { getServerTranslation } from "~/lib/server-translations";
import type { WebhookActionTrigger } from "~/zenstack/models";
import type { AutoExecuteOptions } from "./schemas";

/** Stored text a webhook writes is in the default locale; it has no viewer. */
const NOTE_LOCALE = "en_US";

/**
 * One line for a run's description naming the rule that composed it and its
 * settings, e.g. "Pull requests → Create Test Run · Minimum score: 90 ·
 * Target: Nightly CI", built from the same labels the Actions list shows.
 */
export async function describeCreateRunRule(
  db: any,
  rule: {
    trigger?: WebhookActionTrigger | null;
    branch?: string | null;
    minScore?: number | null;
    autoExecute?: AutoExecuteOptions | null;
  }
): Promise<string | null> {
  if (!rule.trigger) return null;
  const t = (key: string, values?: Record<string, unknown>) =>
    getServerTranslation(NOTE_LOCALE, key, values);
  const trigger =
    rule.trigger === "CODE_PULL_REQUEST"
      ? await t("projects.settings.webhooks.codeRepos.eventPullRequest")
      : rule.trigger === "CODE_PUSH"
        ? rule.branch
          ? await t("projects.settings.webhooks.codeRepos.eventPush", {
              branch: rule.branch,
            })
          : await t("projects.settings.webhooks.codeRepos.eventPushDefault")
        : rule.trigger === "CODE_BRANCH_PUSH"
          ? await t("projects.settings.webhooks.codeRepos.eventBranchPush")
          : null;
  if (!trigger) return null;
  const parts = [`${trigger} → ${await t("repository.cases.createTestRun")}`];
  if (typeof rule.minScore === "number") {
    parts.push(`${await t("runs.impact.affected.minScore")}: ${rule.minScore}`);
  }
  if (rule.autoExecute) {
    const target = await db.executionTarget
      .findUnique({
        where: { id: rule.autoExecute.targetId },
        select: { name: true },
      })
      .catch(() => null);
    parts.push(
      `${await t("automation.execute.target")}: ${target?.name ?? rule.autoExecute.targetId}`
    );
  }
  return parts.join(" · ");
}
