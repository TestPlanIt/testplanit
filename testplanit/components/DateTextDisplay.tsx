import { DateFormatter } from "@/components/DateFormatter";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { CircleCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { stripYearFromFormat } from "~/utils/dateFormat";
import { mapDateTimeFormatString } from "~/utils/mapDateTimeFormat";

interface DateTextDisplayProps {
  startDate?: Date | null;
  endDate?: Date | null;
  isCompleted?: boolean;
  /**
   * Prefix for the start date, e.g. "Started". Pass it only where the date
   * would otherwise read as a bare timestamp; a start-to-end range explains
   * itself and takes no label.
   */
  startLabel?: string;
  /**
   * Collapse against the nearest `@container` ancestor as it narrows: the year
   * drops below @2xl, and the "Completed" label becomes a check icon below
   * @xl. The tooltip still carries the full dates either way.
   *
   * Off by default, and deliberately opt-in: with no container ancestor the
   * `@`-variants never match, which would leave the collapsed form showing
   * permanently. Only set it inside a container.
   */
  responsive?: boolean;
}

export function DateTextDisplay({
  startDate,
  endDate,
  isCompleted = false,
  startLabel,
  responsive = false,
}: DateTextDisplayProps) {
  const { data: session } = useSession();
  const tGlobal = useTranslations();

  const dateFormat = session?.user.preferences?.dateFormat;
  const timezone = session?.user.preferences?.timezone;
  // Map FIRST: the stored preference is a DateFormat enum value (e.g.
  // "MMM_D_YYYY"), not a date-fns format. Stripping the year off the enum key
  // produces a string that matches nothing in the lookup table and then gets
  // treated as a raw format, where tokens like `D` are invalid and throw.
  const shortFormat = stripYearFromFormat(
    mapDateTimeFormatString(dateFormat ?? "MM-dd-yyyy")
  );

  const formatted = (date: Date, format?: string) => (
    <DateFormatter date={date} formatString={format} timezone={timezone} />
  );

  // Which calendar day a date falls on depends on where the viewer is, so the
  // comparison runs in their timezone — a result at 23:50 and one at 00:10 the
  // next morning are two days, and must not collapse.
  const dayKey = (date: Date) => {
    if (timezone) {
      try {
        return formatInTimeZone(
          date,
          timezone.replace(/_/g, "/"),
          "yyyy-MM-dd"
        );
      } catch {
        // Invalid zone: fall through to local time. DateFormatter already
        // warns about it on the render path.
      }
    }
    return format(date, "yyyy-MM-dd");
  };

  // Both ends on one day reads as a stutter ("Dec 9, 2025 - Dec 9, 2025"), so
  // the range collapses to that day. Only for an actual range: a completed
  // entity passes its end date alone, and blanking that would leave nothing.
  const sameDayRange =
    !isCompleted &&
    !!startDate &&
    !!endDate &&
    dayKey(startDate) === dayKey(endDate);

  // Both forms render; the container query picks one. Swapping the format
  // string can't be done in CSS, so the alternative is measuring in JS.
  const datePart = (date: Date) =>
    responsive ? (
      <>
        <span className="hidden @2xl:inline">
          {formatted(date, dateFormat)}
        </span>
        <span className="@2xl:hidden">{formatted(date, shortFormat)}</span>
      </>
    ) : (
      formatted(date, dateFormat)
    );

  const completedLabel = responsive ? (
    <>
      <span className="hidden @xl:inline">
        {tGlobal("common.fields.completed")}:{" "}
      </span>
      <CircleCheck
        className="@xl:hidden inline-block w-4 h-4 me-1 align-text-bottom"
        aria-label={tGlobal("common.fields.completed")}
      />
    </>
  ) : (
    <span>{tGlobal("common.fields.completed")}: </span>
  );

  const content = (
    <div className="text-sm text-muted-foreground text-end">
      {startDate && !isCompleted && (
        <span className="whitespace-nowrap">
          {startLabel && `${startLabel}: `}
          {datePart(startDate)}
        </span>
      )}
      {startDate && endDate && !isCompleted && !sameDayRange && (
        <span> - </span>
      )}
      {isCompleted && endDate && completedLabel}
      {endDate && !sameDayRange && (
        <span className="whitespace-nowrap">{datePart(endDate)}</span>
      )}
    </div>
  );

  const tooltipContent = (
    <>
      {startDate && !isCompleted && (
        <>
          {startLabel && `${startLabel}: `}
          {formatted(startDate, dateFormat)}
        </>
      )}
      {startDate && endDate && !isCompleted && !sameDayRange && (
        <span> - </span>
      )}
      {isCompleted && endDate && (
        <span>{tGlobal("common.fields.completed")}: </span>
      )}
      {endDate && !sameDayRange && formatted(endDate, dateFormat)}
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent>
        <p className="text-sm">{tooltipContent}</p>
      </TooltipContent>
    </Tooltip>
  );
}
