import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";

export interface ReportDatePreferences {
  dateFormat?: string | null;
  timeFormat?: string | null;
  timezone?: string | null;
}

const DEFAULT_DATE_FORMAT = "MM-dd-yyyy";

/**
 * An ISO timestamp from a scan or check report, in the user's date and time
 * format and timezone, for use inside a translated sentence. An unparsable
 * value is shown as it is.
 */
export function formatReportDate(
  iso: string,
  locale: string,
  preferences?: ReportDatePreferences | null
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const preferred =
    preferences?.dateFormat && preferences?.timeFormat
      ? `${preferences.dateFormat} ${preferences.timeFormat}`
      : (preferences?.dateFormat ?? DEFAULT_DATE_FORMAT);
  const formatString = mapDateTimeFormatString(preferred);
  const dateLocale = getDateFnsLocale(locale);
  const timezone = preferences?.timezone;
  try {
    return timezone
      ? formatInTimeZone(date, timezone.replace(/_/g, "/"), formatString, {
          locale: dateLocale,
        })
      : format(date, formatString, { locale: dateLocale });
  } catch {
    return format(date, formatString, { locale: dateLocale });
  }
}
