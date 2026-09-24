"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { DateFormatter } from "@/components/DateFormatter";
import { Snowflake } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import type { FrozenReportMeta } from "~/lib/reports/frozenReportMeta";

/** When a frozen report was captured, by whom, and whether rows were cut. */
export function FrozenReportBanner({ frozen }: { frozen: FrozenReportMeta }) {
  const t = useTranslations("reports.frozen");
  const { data: session } = useSession();
  // The viewer's date/time format and timezone when signed in; anonymous
  // viewers of a public link get a readable default in their browser's zone.
  const preferences = session?.user?.preferences;
  const formatString = preferences?.dateFormat
    ? `${preferences.dateFormat} ${preferences.timeFormat || "HH:mm"}`
    : "PPp";
  const date = () => (
    <DateFormatter
      date={frozen.capturedAt}
      formatString={formatString}
      timezone={preferences?.timezone}
      tooltip={false}
    />
  );

  return (
    <Alert data-testid="frozen-report-banner" className="items-center">
      <Snowflake className="h-4 w-4" />
      <AlertDescription className="space-y-1">
        <p>
          {frozen.capturedByName
            ? t.rich("capturedBy", { date, name: frozen.capturedByName })
            : t.rich("capturedAt", { date })}
        </p>
        {frozen.truncated && (
          <p data-testid="frozen-report-truncated">
            {t("truncatedNotice", {
              rowCount: frozen.rowCount,
              totalRowCount: frozen.totalRowCount,
            })}
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
