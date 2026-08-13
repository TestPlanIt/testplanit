"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import React from "react";
import { CALENDAR_DATE_TIMEZONE } from "~/utils/calendarDate";
import { getDateFnsLocale } from "~/utils/locales";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";

type DateFormatterProps = {
  date: Date | string | null;
  formatString?: string;
  timezone?: string | null;
  /**
   * When true (default), the formatted value is wrapped in a tooltip that
   * reveals the full date and time in the viewer's preferred date/time format.
   * Useful when the visible value shows only the date (or only the time), or
   * is truncated. Set to false for format previews/samples or when the
   * formatter is already rendered inside another tooltip/popover.
   */
  tooltip?: boolean;
  /**
   * Marks `date` as a calendar date rather than an instant — a milestone due
   * date, not a moment something happened. Formats in UTC (where the value was
   * pinned on write) instead of the viewer's zone, and drops the time from the
   * tooltip, since there is no meaningful time to reveal. See
   * `~/utils/calendarDate`.
   *
   * Passing this for a real instant silently misreports it by up to a day, so
   * it stays opt-in per call site.
   */
  dateOnly?: boolean;
};

const DEFAULT_TOOLTIP_FORMAT = "MM/dd/yyyy hh:mm a";
const DEFAULT_DATE_ONLY_TOOLTIP_FORMAT = "MM/dd/yyyy";

export const DateFormatter: React.FC<DateFormatterProps> = ({
  date,
  formatString = "MM-dd-yyyy",
  timezone,
  tooltip = true,
  dateOnly = false,
}) => {
  const locale = useLocale();
  const dateLocale = getDateFnsLocale(locale);
  const { data: session } = useSession();

  const dateObject = typeof date === "string" ? new Date(date) : date;
  if (
    !dateObject ||
    !(dateObject instanceof Date) ||
    isNaN(dateObject.getTime())
  ) {
    return null;
  }

  // Format the date with the given format/timezone, falling back to UTC and
  // then local time if the timezone is invalid (mirrors prior behavior).
  const formatValue = (rawFormatString: string, tz?: string | null): string => {
    const finalFormatString = mapDateTimeFormatString(rawFormatString);
    try {
      if (tz) {
        return formatInTimeZone(
          dateObject,
          tz.replace(/_/g, "/"),
          finalFormatString,
          { locale: dateLocale }
        );
      }
      return format(dateObject, finalFormatString, { locale: dateLocale });
    } catch (error) {
      console.warn(
        `Error formatting date with timezone "${tz}" (IANA: "${tz?.replace(/_/g, "/")}"):`,
        error
      );
      try {
        return (
          formatInTimeZone(dateObject, "Etc/UTC", finalFormatString, {
            locale: dateLocale,
          }) + " (UTC)"
        );
      } catch (utcError) {
        console.error(
          "Error formatting date with fallback UTC timezone:",
          utcError
        );
        return (
          format(dateObject, finalFormatString, { locale: dateLocale }) +
          " (Local)"
        );
      }
    }
  };

  // A calendar date is pinned to UTC midnight on write, so UTC is the only
  // zone that reads it back as the day it was authored as.
  const effectiveTimezone = dateOnly ? CALENDAR_DATE_TIMEZONE : timezone;
  const formattedDate = formatValue(formatString, effectiveTimezone);

  if (!tooltip) {
    return <>{formattedDate}</>;
  }

  // Tooltip shows the full date + time in the viewer's preferred format — or
  // the date alone for a calendar date, whose time carries no information.
  const preferredDateFormat = session?.user?.preferences?.dateFormat;
  const preferredTimeFormat = session?.user?.preferences?.timeFormat;
  const preferredTimezone = session?.user?.preferences?.timezone;
  const tooltipFormatString = dateOnly
    ? (preferredDateFormat ?? DEFAULT_DATE_ONLY_TOOLTIP_FORMAT)
    : preferredDateFormat && preferredTimeFormat
      ? `${preferredDateFormat} ${preferredTimeFormat}`
      : DEFAULT_TOOLTIP_FORMAT;
  const tooltipText = formatValue(
    tooltipFormatString,
    dateOnly ? CALENDAR_DATE_TIMEZONE : (timezone ?? preferredTimezone)
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{formattedDate}</span>
      </TooltipTrigger>
      <TooltipContent>{tooltipText}</TooltipContent>
    </Tooltip>
  );
};
