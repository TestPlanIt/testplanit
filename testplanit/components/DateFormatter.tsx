import React from "react";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useLocale } from "next-intl";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";

type DateFormatterProps = {
  date: Date | string | null;
  formatString?: string;
  timezone?: string | null;
};

export const DateFormatter: React.FC<DateFormatterProps> = ({
  date,
  formatString = "MM-dd-yyyy",
  timezone,
}) => {
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);

  const dateObject = typeof date === "string" ? new Date(date) : date;
  if (
    !dateObject ||
    !(dateObject instanceof Date) ||
    isNaN(dateObject.getTime())
  ) {
    return null;
  }

  const finalFormatString = mapDateTimeFormatString(formatString);

  let formattedDate: string;
  let suffix = "";

  try {
    if (timezone) {
      const ianaTimezone = timezone.replace(/_/g, "/");
      formattedDate = formatInTimeZone(
        dateObject,
        ianaTimezone,
        finalFormatString,
        { locale: dateLocale }
      );
    } else {
      formattedDate = format(dateObject, finalFormatString, {
        locale: dateLocale,
      });
    }
  } catch (error) {
    console.warn(
      `Error formatting date with timezone "${timezone}" (IANA: "${timezone?.replace(/_/g, "/")}"):`,
      error
    );
    try {
      formattedDate = formatInTimeZone(
        dateObject,
        "Etc/UTC",
        finalFormatString,
        { locale: dateLocale }
      );
      suffix = " (UTC)";
    } catch (utcError) {
      console.error(
        "Error formatting date with fallback UTC timezone:",
        utcError
      );
      formattedDate = format(dateObject, finalFormatString, {
        locale: dateLocale,
      });
      suffix = " (Local)";
    }
  }

  return (
    <>
      {formattedDate}{suffix}
    </>
  );
};
