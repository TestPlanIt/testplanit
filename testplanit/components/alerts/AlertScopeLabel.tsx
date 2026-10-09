"use client";

import { useTranslations } from "next-intl";
import { AlertScopeType } from "~/zenstack/models";

/** Names of the things rules point at, batch-loaded once by the page. */
export interface AlertScopeNames {
  folders: Map<number, string>;
  tags: Map<number, string>;
  cases: Map<number, string>;
  milestones: Map<number, string>;
}

export function AlertScopeLabel({
  scopeType,
  scopeId,
  scopeText,
  names,
}: {
  scopeType: AlertScopeType;
  scopeId: number | null | undefined;
  scopeText: string | null | undefined;
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
    default:
      return <span>{t("PROJECT")}</span>;
  }
}
