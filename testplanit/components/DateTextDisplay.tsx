import { DateFormatter } from "@/components/DateFormatter";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("dates");

  return (
    <div className="text-sm text-muted-foreground">
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
      {isCompleted && endDate && <span>{t("completed")}: </span>}
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
}
