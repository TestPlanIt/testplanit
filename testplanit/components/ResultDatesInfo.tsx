"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { CalendarArrowDown, CalendarArrowUp } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import React from "react";
import { cn, type ClassValue } from "~/utils";

export interface ResultDatesInfoProps {
  /** Earliest result. */
  startDate?: Date | null;
  /** Latest result — only passed for completed runs/sessions. */
  endDate?: Date | null;
  className?: ClassValue;
}

/**
 * "Started" / "Ended" for a test run or session, both derived from its
 * results. Sits beside CreationInfo at the foot of the details panel and
 * matches its type scale — creation and execution are the same kind of
 * provenance line, and neither is an editable field.
 */
export const ResultDatesInfo: React.FC<ResultDatesInfoProps> = ({
  startDate,
  endDate,
  className,
}) => {
  const t = useTranslations("common.fields");
  const { data: session } = useSession();

  if (!startDate && !endDate) {
    return null;
  }

  const formatString = `${
    session?.user.preferences?.dateFormat || "MM-dd-yyyy"
  } ${session?.user.preferences?.timeFormat || "HH:mm"}`;
  const timezone = session?.user.preferences?.timezone;

  const row = (label: string, icon: React.ReactNode, date: Date) => (
    <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0 w-full">
      {icon}
      <span className="shrink-0">{label}:</span>
      <span className="truncate">
        <DateFormatter
          date={date}
          formatString={formatString}
          timezone={timezone}
        />
      </span>
    </div>
  );

  return (
    <div className={cn("space-y-2 w-full", className)}>
      {startDate &&
        row(
          t("started"),
          <CalendarArrowUp className="h-4 w-4 shrink-0" />,
          startDate
        )}
      {endDate &&
        row(
          t("ended"),
          <CalendarArrowDown className="h-4 w-4 shrink-0" />,
          endDate
        )}
    </div>
  );
};

export default ResultDatesInfo;
