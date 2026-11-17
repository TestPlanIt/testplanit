"use client";

import { useTranslations } from "next-intl";
import type {
  WebhookActionTrigger,
  WebhookActionType,
} from "~/zenstack/models";
import type { DraftQuantity } from "~/lib/webhooks/actions/schemas";

/** The Generate wizard's label key for each draft count. */
export const QUANTITY_LABEL_KEYS: Record<DraftQuantity, string> = {
  just_one: "justOne",
  couple: "couple",
  few: "few",
  several: "several",
  many: "many",
  all: "maximum",
};

/** Display text for rule triggers and actions, shared by the list and the dialog. */
export function useWebhookActionLabels(baseBranch: string | null) {
  const t = useTranslations("projects.settings.webhooks.actions");
  const tWebhooks = useTranslations("projects.settings.webhooks");
  const tCodeRepos = useTranslations("projects.settings.webhooks.codeRepos");
  const tCases = useTranslations("repository.cases");
  const tGenerate = useTranslations("repository.generateTestCases");
  const tIntegration = useTranslations(
    "projects.settings.integrations.integration"
  );

  function trigger(value: WebhookActionTrigger): string {
    switch (value) {
      case "CODE_PULL_REQUEST":
        return tCodeRepos("eventPullRequest");
      case "CODE_PUSH":
        return baseBranch
          ? tCodeRepos("eventPush", { branch: baseBranch })
          : tCodeRepos("eventPushDefault");
      case "CODE_BRANCH_PUSH":
        return tCodeRepos("eventBranchPush");
      case "ISSUE_CREATED":
        return tWebhooks("events.issueCreated");
      default:
        return t(`trigger.${value}`);
    }
  }

  function triggerHelp(value: WebhookActionTrigger): string {
    switch (value) {
      case "CODE_PULL_REQUEST":
        return tCodeRepos("eventPullRequestHelp");
      case "CODE_PUSH":
        return tCodeRepos("eventPushHelp");
      case "CODE_BRANCH_PUSH":
        return tCodeRepos("eventBranchPushHelp");
      default:
        return t(`triggerHelp.${value}`);
    }
  }

  function action(value: WebhookActionType): string {
    switch (value) {
      case "CREATE_RUN":
        return tCases("createTestRun");
      case "DRAFT_CASES":
        return tGenerate("title");
      case "IMPORT_ISSUE":
        return tIntegration("importIssues");
    }
  }

  return { trigger, triggerHelp, action };
}
