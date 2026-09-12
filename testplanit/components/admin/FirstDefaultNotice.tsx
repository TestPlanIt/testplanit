"use client";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { AlertDescription, AlertTitle } from "@/components/ui/alert";
import { WarningAlert } from "@/components/ui/warning-alert";

/**
 * Shown in an admin "Add" dialog while the catalog (or scope) has no default
 * row: the row being created is forced to be the default, and the Default
 * switch is locked on.
 */
export function FirstDefaultNotice({
  "data-testid": testId = "first-default-notice",
}: {
  "data-testid"?: string;
}) {
  const t = useTranslations("common.defaults");
  return (
    <WarningAlert data-testid={testId}>
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>{t("firstTitle")}</AlertTitle>
      <AlertDescription>{t("firstDescription")}</AlertDescription>
    </WarningAlert>
  );
}

/**
 * Shown in an admin "Edit" dialog for the row that is the current default:
 * the Default switch is locked because unsetting it would leave the catalog
 * without a default. The default moves when another row is set as default.
 */
export function DefaultLockedNotice({
  "data-testid": testId = "default-locked-notice",
}: {
  "data-testid"?: string;
}) {
  const t = useTranslations("common.defaults");
  return (
    <WarningAlert data-testid={testId}>
      <TriangleAlert className="h-4 w-4" />
      <AlertTitle>{t("lockedTitle")}</AlertTitle>
      <AlertDescription>{t("lockedDescription")}</AlertDescription>
    </WarningAlert>
  );
}
