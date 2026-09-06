"use client";

import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import React from "react";
import type { CaseDraftStatus as Status } from "~/hooks/useCaseDraft";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";

interface CaseDraftStatusProps {
  status: Status;
  lastSavedAt: Date | null;
  className?: string;
}

/**
 * The editor's auto-save indicator: "Saving…", "All changes saved 2:41 PM", or
 * a failure state that says a retry is coming.
 *
 * Formats through date-fns with the viewer's locale, time-format preference and
 * timezone rather than `toLocaleTimeString`, matching DateFormatter. It cannot
 * simply *be* a DateFormatter: the time is an ICU argument inside a sentence,
 * so it has to reach `t()` as a string.
 */
export function CaseDraftStatus({
  status,
  lastSavedAt,
  className = "",
}: CaseDraftStatusProps) {
  const t = useTranslations("repository.draft");
  const locale = useLocale();
  const { data: session } = useSession();

  const preferences = session?.user?.preferences;
  const formattedTime = React.useMemo(() => {
    if (!lastSavedAt) return null;
    const formatString = mapDateTimeFormatString(
      preferences?.timeFormat ?? "HH_MM_A"
    );
    const timezone = preferences?.timezone;
    const dateLocale = getDateFnsLocale(locale);
    try {
      return timezone
        ? formatInTimeZone(
            lastSavedAt,
            timezone.replace(/_/g, "/"),
            formatString,
            { locale: dateLocale }
          )
        : format(lastSavedAt, formatString, { locale: dateLocale });
    } catch {
      return format(lastSavedAt, formatString, { locale: dateLocale });
    }
  }, [lastSavedAt, locale, preferences]);

  if (status === "idle" && !lastSavedAt) return null;

  const base = `flex items-center gap-1.5 text-xs ${className}`;

  if (status === "saving") {
    return (
      <span
        className={`${base} text-muted-foreground`}
        role="status"
        aria-live="polite"
        data-testid="case-draft-status"
        data-status="saving"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
        {t("saving")}
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        className={`${base} text-destructive`}
        role="status"
        aria-live="polite"
        data-testid="case-draft-status"
        data-status="error"
      >
        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
        {t("saveFailed")}
      </span>
    );
  }

  if (status === "dirty") {
    return (
      <span
        className={`${base} text-muted-foreground`}
        role="status"
        aria-live="polite"
        data-testid="case-draft-status"
        data-status="dirty"
      >
        {t("unsaved")}
      </span>
    );
  }

  if (!formattedTime) return null;

  return (
    <span
      className={`${base} text-muted-foreground`}
      role="status"
      aria-live="polite"
      data-testid="case-draft-status"
      data-status="saved"
    >
      <Check className="h-3.5 w-3.5 shrink-0" />
      {t("saved", { time: formattedTime })}
    </span>
  );
}

export default CaseDraftStatus;
