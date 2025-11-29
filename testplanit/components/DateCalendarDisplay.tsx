import { DateFormatter } from "@/components/DateFormatter";

interface CalendarDisplayProps {
  date: Date;
  showYear?: boolean;
}

export function CalendarDisplay({
  date,
  showYear = false,
}: CalendarDisplayProps) {
  return (
    <div className="flex flex-col items-center justify-center w-20 border-4 border-primary rounded-lg bg-primary text-accent">
      <span className="text-sm font-semibold bg-accent text-secondary-foreground w-full text-center rounded-t-lg p-1">
        <DateFormatter
          date={date}
          formatString={showYear ? "MMM yyyy" : "MMM"}
        />
      </span>
      <span className="text-2xl font-bold text-primary-foreground">
        <DateFormatter date={date} formatString="d" />
      </span>
    </div>
  );
}
