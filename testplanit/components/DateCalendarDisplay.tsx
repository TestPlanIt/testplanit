import { DateFormatter } from "@/components/DateFormatter";

interface CalendarDisplayProps {
  date: Date;
  showYear?: boolean;
  /** The date is a calendar day stored at UTC midnight; show that day everywhere. */
  dateOnly?: boolean;
}

export function CalendarDisplay({
  date,
  showYear = false,
  dateOnly = false,
}: CalendarDisplayProps) {
  return (
    <div className="flex w-20 flex-col items-center justify-center rounded-lg border-4 border-primary bg-primary text-accent">
      <span className="w-full rounded-t-lg bg-accent p-1 text-center text-sm font-semibold text-accent-foreground">
        <DateFormatter
          date={date}
          formatString={showYear ? "MMM yyyy" : "MMM"}
          dateOnly={dateOnly}
        />
      </span>
      <span className="text-2xl font-bold text-primary-foreground">
        <DateFormatter date={date} formatString="d" dateOnly={dateOnly} />
      </span>
    </div>
  );
}
