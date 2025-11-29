import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow, type Locale } from "date-fns";
import { DateFormatter } from "@/components/DateFormatter";
import { useSession } from "next-auth/react";
import { cn, type ClassValue } from "~/utils";

interface RelativeTimeTooltipProps {
  date: Date | string;
  isPending?: boolean;
  dateFnsLocale?: Locale;
  dateFormat?: string;
  timeFormat?: string;
  timezone?: string;
  className?: ClassValue;
  children?: React.ReactNode;
}

export function RelativeTimeTooltip({
  date,
  isPending = false,
  dateFnsLocale,
  dateFormat,
  timeFormat,
  timezone,
  className,
  children,
}: RelativeTimeTooltipProps) {
  const { data: session } = useSession();
  const dateObj = typeof date === "string" ? new Date(date) : date;
  
  // Use user's preferred formats from session, fallback to props, then defaults
  const userDateFormat = session?.user?.preferences?.dateFormat || dateFormat;
  const userTimeFormat = session?.user?.preferences?.timeFormat || timeFormat;
  const userTimezone = session?.user?.preferences?.timezone || timezone;
  
  const formatString = userDateFormat && userTimeFormat ? `${userDateFormat} ${userTimeFormat}` : undefined;
  
  const relativeTime = !isPending
    ? formatDistanceToNow(dateObj, {
        addSuffix: true,
        locale: dateFnsLocale,
      })
    : null;

  const displayContent = children || (
    <div className={cn(className)}>{relativeTime}</div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{displayContent}</TooltipTrigger>
        <TooltipContent>
          <div className="flex gap-1">
            <DateFormatter
              date={dateObj}
              formatString={formatString}
              timezone={userTimezone}
            />
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}