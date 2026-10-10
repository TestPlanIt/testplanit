"use client";

import { useTranslations } from "next-intl";
import { AlertScopeType } from "~/zenstack/models";

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
}

export function AlertScopeLabel({
  scopeType,
  scopeId,
  scopeText,
  system = false,
  names,
}: {
  scopeType: AlertScopeType;
  scopeId: number | null | undefined;
  scopeText: string | null | undefined;
  /** A system alert: its whole-scope wording names the AI integrations, not a project. */
  system?: boolean;
  names: AlertScopeNames;
}) {
  const t = useTranslations("alerts.scopeDisplay");
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
    default:
      return <span>{t(system ? "ALL_LLM_INTEGRATIONS" : "PROJECT")}</span>;
  }
}
