import { DateFormatter } from "@/components/DateFormatter";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DateTextDisplayProps {
  startDate?: Date | null;
  endDate?: Date | null;
  isCompleted?: boolean;
}

export function DateTextDisplay({
  startDate,
  endDate,
  isCompleted = false,
}: DateTextDisplayProps) {
  const { data: session } = useSession();
  const tGlobal = useTranslations();

  const content = (
    <div className="text-sm text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
      {startDate && !isCompleted && (
        <span className="whitespace-nowrap">
          <DateFormatter
            date={startDate}
            formatString={session?.user.preferences?.dateFormat}
            timezone={session?.user.preferences?.timezone}
          />
        </span>
      )}
      {startDate && endDate && !isCompleted && <span> - </span>}
      {isCompleted && endDate && (
        <span>{tGlobal("common.fields.completed")}: </span>
      )}
      {endDate && (
        <span className="whitespace-nowrap">
          <DateFormatter
            date={endDate}
            formatString={session?.user.preferences?.dateFormat}
            timezone={session?.user.preferences?.timezone}
          />
        </span>
      )}
    </div>
  );

  const tooltipContent = (
    <>
      {startDate && !isCompleted && (
        <DateFormatter
          date={startDate}
          formatString={session?.user.preferences?.dateFormat}
          timezone={session?.user.preferences?.timezone}
        />
      )}
      {startDate && endDate && !isCompleted && <span> - </span>}
      {isCompleted && endDate && (
        <span>{tGlobal("common.fields.completed")}: </span>
      )}
      {endDate && (
        <DateFormatter
          date={endDate}
          formatString={session?.user.preferences?.dateFormat}
          timezone={session?.user.preferences?.timezone}
        />
      )}
    </>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {content}
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-sm">{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
