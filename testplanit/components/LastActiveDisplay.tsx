import React from "react";
import { formatDistanceToNow } from "date-fns";
import { useSession } from "next-auth/react";
import { useLocale } from "next-intl";
import { getDateFnsLocale } from "~/utils/locales";
import { DateFormatter } from "@/components/DateFormatter";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type LastActiveDisplayProps = {
  date: Date | string | null | undefined;
};

export const LastActiveDisplay: React.FC<LastActiveDisplayProps> = ({
  date,
}) => {
  const { data: session } = useSession();
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);

  if (!date) {
    return <>-</>;
  }

  const dateObj = typeof date === "string" ? new Date(date) : date;

  if (isNaN(dateObj.getTime())) {
    return <>-</>;
  }

  const preferredDateFormat = session?.user?.preferences?.dateFormat;
  const preferredTimeFormat = session?.user?.preferences?.timeFormat;
  const preferredTimezone = session?.user?.preferences?.timezone;

  const defaultFormatString = "MM/dd/yyyy hh:mm a";
  const formatString =
    preferredDateFormat && preferredTimeFormat
      ? `${preferredDateFormat} ${preferredTimeFormat}`
      : defaultFormatString;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="truncate">
            {formatDistanceToNow(dateObj, {
              addSuffix: true,
              locale: dateFnsLocale,
            })}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <DateFormatter
            date={dateObj}
            formatString={formatString}
            timezone={preferredTimezone}
          />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
