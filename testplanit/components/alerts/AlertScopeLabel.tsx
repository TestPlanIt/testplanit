"use client";

import { useTranslations } from "next-intl";
import { useQueueDisplayName } from "@/components/admin/useQueueDisplayName";
import { getAlertMetricDefinition } from "~/lib/alerts/catalogue";
import { AlertScopeType, AlertSubjectType } from "~/zenstack/models";

/** Names of the things rules point at, batch-loaded once by the page. */
export interface AlertScopeNames {
  folders: Map<number, string>;
  tags: Map<number, string>;
  cases: Map<number, string>;
  milestones: Map<number, string>;
  /** Outbound webhook configs by their string id. */
  webhooks: Map<string, string>;
  /** AI model integrations by id (system alerts). */
  llmIntegrations: Map<number, string>;
  /** Code repository connections by id (system alerts). */
  codeRepositories: Map<number, string>;
  /** Issue-tracker integrations by id (system alerts). */
  integrations: Map<number, string>;
}

export function AlertScopeLabel({
  scopeType,
  scopeId,
  scopeText,
  metric,
  names,
}: {
  scopeType: AlertScopeType;
  scopeId: number | null | undefined;
  scopeText: string | null | undefined;
  /** Decides the wording of the whole scope: a project, or what a system metric watches. */
  metric?: string;
  names: AlertScopeNames;
}) {
  const t = useTranslations("alerts.scopeDisplay");
  const queueLabel = useQueueDisplayName();
  const missing = t("missing");
  const nameOf = (map: Map<number, string>) =>
    scopeId != null ? (map.get(scopeId) ?? missing) : missing;

  switch (scopeType) {
    case AlertScopeType.FOLDER:
      return <span>{t("FOLDER", { name: nameOf(names.folders) })}</span>;
    case AlertScopeType.TAG:
      return <span>{t("TAG", { name: nameOf(names.tags) })}</span>;
    case AlertScopeType.CASE:
      return <span>{t("CASE", { name: nameOf(names.cases) })}</span>;
    case AlertScopeType.MILESTONE:
      return <span>{t("MILESTONE", { name: nameOf(names.milestones) })}</span>;
    case AlertScopeType.RUN_NAME:
      return <span>{t("RUN_NAME", { text: scopeText ?? "" })}</span>;
    case AlertScopeType.WEBHOOK:
      return (
        <span>
          {t("WEBHOOK", {
            name: scopeText
              ? (names.webhooks.get(scopeText) ?? missing)
              : missing,
          })}
        </span>
      );
    case AlertScopeType.LLM_INTEGRATION:
      return (
        <span>
          {t("LLM_INTEGRATION", { name: nameOf(names.llmIntegrations) })}
        </span>
      );
    case AlertScopeType.CODE_REPOSITORY:
      return (
        <span>
          {t("CODE_REPOSITORY", { name: nameOf(names.codeRepositories) })}
        </span>
      );
    case AlertScopeType.INTEGRATION:
      return (
        <span>{t("INTEGRATION", { name: nameOf(names.integrations) })}</span>
      );
    case AlertScopeType.QUEUE:
      return (
        <span>
          {t("QUEUE", { name: scopeText ? queueLabel(scopeText) : missing })}
        </span>
      );
    default:
      return <span>{t(wholeScopeKey(metric))}</span>;
  }
}

/** The whole-scope wording: the project, or everything a system metric watches. */
function wholeScopeKey(metric: string | undefined) {
  const definition = metric ? getAlertMetricDefinition(metric) : undefined;
  if (!definition?.system) return "PROJECT";
  switch (definition.subjectType) {
    case AlertSubjectType.LLM_INTEGRATION:
      return "ALL_LLM_INTEGRATIONS";
    case AlertSubjectType.CODE_REPOSITORY:
      return "ALL_CODE_REPOSITORIES";
    case AlertSubjectType.INTEGRATION:
      return "ALL_INTEGRATIONS";
    case AlertSubjectType.QUEUE:
      return "ALL_QUEUES";
    default:
      return "WHOLE_INSTALLATION";
  }
}
