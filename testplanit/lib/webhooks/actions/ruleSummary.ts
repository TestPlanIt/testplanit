import { getServerTranslation } from "~/lib/server-translations";
import type { JSONContent } from "@tiptap/core";
import type { AdapterType, WebhookActionTrigger } from "~/zenstack/models";
import { describeCaseFilter } from "./caseFilter";
import type { AutoExecuteOptions, WebhookActionFilter } from "./schemas";

/** Stored text a webhook writes is in the default locale; it has no viewer. */
const NOTE_LOCALE = "en_US";

type Translate = (
  key: string,
  values?: Record<string, unknown>
) => Promise<string>;

const t: Translate = (key, values) =>
  getServerTranslation(NOTE_LOCALE, key, values);

/** The trigger as the Actions list names it, or null for one it can't name. */
async function triggerLabel(rule: {
  trigger?: WebhookActionTrigger | null;
  branch?: string | null;
}): Promise<string | null> {
  return rule.trigger === "CODE_PULL_REQUEST"
    ? await t("projects.settings.webhooks.codeRepos.eventPullRequest")
    : rule.trigger === "CODE_PUSH"
      ? rule.branch
        ? await t("projects.settings.webhooks.codeRepos.eventPush", {
            branch: rule.branch,
          })
        : await t("projects.settings.webhooks.codeRepos.eventPushDefault")
      : rule.trigger === "CODE_BRANCH_PUSH"
        ? await t("projects.settings.webhooks.codeRepos.eventBranchPush")
        : rule.trigger === "ISSUE_CREATED"
          ? await t("projects.settings.webhooks.events.issueCreated")
          : rule.trigger === "ISSUE_STATUS_ENTERED" ||
              rule.trigger === "ISSUE_EVENT"
            ? await t(
                `projects.settings.webhooks.actions.trigger.${rule.trigger}`
              )
            : null;
}

/**
 * One line for a run's description naming the rule that composed it and its
 * settings, e.g. "Pull requests → Create Test Run · Minimum score: 90 ·
 * Test case filters: Automation: Is Automated · Target: Nightly CI", built
 * from the same labels the Actions list shows.
 */
export async function describeCreateRunRule(
  db: any,
  rule: {
    trigger?: WebhookActionTrigger | null;
    branch?: string | null;
    minScore?: number | null;
    /** The rule's test case filters, named only when `projectId` is given. */
    caseFilter?: unknown;
    projectId?: number;
    autoExecute?: AutoExecuteOptions | null;
    /** Tracker rules: the statuses an issue entered. */
    statuses?: string[];
  }
): Promise<string | null> {
  if (!rule.trigger) return null;
  const trigger = await triggerLabel(rule);
  if (!trigger) return null;
  const parts = [`${trigger} → ${await t("repository.cases.createTestRun")}`];
  if (rule.statuses && rule.statuses.length > 0) {
    parts.push(rule.statuses.join(", "));
  }
  if (typeof rule.minScore === "number") {
    parts.push(`${await t("runs.impact.affected.minScore")}: ${rule.minScore}`);
  }
  if (
    rule.projectId !== undefined &&
    Array.isArray(rule.caseFilter) &&
    rule.caseFilter.length > 0
  ) {
    const filters = await describeCaseFilter(
      db,
      rule.projectId,
      rule.caseFilter
    ).catch(() => null);
    if (filters) {
      parts.push(
        `${await t("projects.settings.webhooks.actions.caseFilter")}: ${filters}`
      );
    }
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

/**
 * One line naming a Draft test cases rule, e.g. "Issue status changes →
 * Generate Test Cases with AI · To Do": the folder its drafts land in.
 */
export async function describeDraftCasesRule(rule: {
  trigger?: WebhookActionTrigger | null;
  statuses?: string[];
}): Promise<string | null> {
  const trigger = await triggerLabel(rule);
  if (!trigger) return null;
  const parts = [
    `${trigger} → ${await t("repository.generateTestCases.title")}`,
  ];
  if (rule.statuses && rule.statuses.length > 0) {
    parts.push(rule.statuses.join(", "));
  }
  return parts.join(" · ");
}

/**
 * The note on a folder of drafts: which webhook and rule fill it, what the
 * rule filters on, and the template and state the drafts take.
 */
export async function draftFolderNote(details: {
  webhook: { name: string | null; adapterType: AdapterType };
  ruleLine: string;
  filter: WebhookActionFilter;
  templateName: string;
  stateName: string;
}): Promise<JSONContent> {
  const webhookName =
    details.webhook.name ??
    (await t(
      `projects.settings.webhooks.inbound${ADAPTER_TITLE[details.webhook.adapterType] ?? "Jira"}Title`
    ));
  const lines = [
    await t("projects.settings.webhooks.actions.draftFolderNote", {
      webhook: webhookName,
    }),
    `${await t("admin.auditLogs.filterAction")}: ${details.ruleLine}`,
  ];
  if (details.filter.statuses?.length) {
    lines.push(
      `${await t("common.labels.statuses")}: ${details.filter.statuses.join(", ")}`
    );
  }
  if (details.filter.issueTypeIds?.length) {
    const names = [
      ...new Set(
        details.filter.issueTypeIds.map(
          (id) => details.filter.issueTypeNames?.[id] ?? id
        )
      ),
    ];
    lines.push(
      `${await t("projects.settings.integrations.integration.requirementsConfig.issueTypesLabel")}: ${names.join(", ")}`
    );
  }
  if (details.filter.labels?.length) {
    lines.push(
      `${await t("projects.settings.integrations.integration.requirementsConfig.labelsLabel")}: ${details.filter.labels.join(", ")}`
    );
  }
  if (details.filter.requirementsOnly) {
    lines.push(await t("projects.settings.webhooks.actions.requirementsOnly"));
  }
  lines.push(
    `${await t("common.fields.template")}: ${details.templateName} · ${await t("common.fields.state")}: ${details.stateName}`
  );
  lines.push(
    await t("projects.settings.webhooks.actions.draftFolderNoteCases")
  );
  return {
    type: "doc",
    content: lines.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

const ADAPTER_TITLE: Partial<Record<AdapterType, string>> = {
  JIRA: "Jira",
  GITHUB: "Github",
  AZURE_DEVOPS: "Ado",
  GITLAB: "Gitlab",
  GITEA: "Gitea",
  REDMINE: "Redmine",
  MANTISBT: "Mantisbt",
  CLICKUP: "Clickup",
};
