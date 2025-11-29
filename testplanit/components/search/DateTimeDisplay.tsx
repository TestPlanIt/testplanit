import React from "react";
import { DateFormatter } from "@/components/DateFormatter";
import { cn, type ClassValue } from "~/utils";

interface DateTimeDisplayProps {
  date: string | Date;
  label?: string;
  showTime?: boolean;
  formatString?: string;
  timezone?: string | null;
  className?: ClassValue;
}

export function DateTimeDisplay({ 
  date, 
  label, 
  showTime = false, 
  formatString,
  timezone,
  className 
}: DateTimeDisplayProps) {
  // Default format based on showTime
  const defaultFormat = showTime ? "MM-dd-yyyy HH:mm" : "MM-dd-yyyy";
  const format = formatString || defaultFormat;
  
  return (
    <span className={cn("text-xs text-muted-foreground", className)}>
      {label && <>{label}: </>}
      <DateFormatter date={date} formatString={format} timezone={timezone} />
    </span>
  );
}