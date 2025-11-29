import { DateFormat, TimeFormat } from "@prisma/client";

// Mapping enums to date-fns format strings
const dateFormats: Record<DateFormat, string> = {
  [DateFormat.MM_DD_YYYY_SLASH]: "MM/dd/yyyy",
  [DateFormat.MM_DD_YYYY_DASH]: "MM-dd-yyyy",
  [DateFormat.DD_MM_YYYY_SLASH]: "dd/MM/yyyy",
  [DateFormat.DD_MM_YYYY_DASH]: "dd-MM-yyyy",
  [DateFormat.YYYY_MM_DD]: "yyyy-MM-dd",
  [DateFormat.MMM_D_YYYY]: "MMM d, yyyy",
  [DateFormat.D_MMM_YYYY]: "d MMM yyyy",
};

const timeFormats: Record<TimeFormat, string> = {
  [TimeFormat.HH_MM]: "HH:mm",
  [TimeFormat.HH_MM_A]: "hh:mm a",
  [TimeFormat.HH_MM_Z]: "HH:mm z",
  [TimeFormat.HH_MM_Z_A]: "hh:mm z a",
};

// Renamed function for clarity and exported it
export const mapDateTimeFormatString = (formatString: string): string => {
  // Attempt to match the entire string as a DateFormat enum key
  const dateFormatKey = Object.keys(DateFormat).find(
    (key) => DateFormat[key as keyof typeof DateFormat] === formatString
  ) as keyof typeof DateFormat;

  if (dateFormatKey && dateFormats[DateFormat[dateFormatKey]]) {
    return dateFormats[DateFormat[dateFormatKey]];
  }

  // Attempt to match the entire string as a TimeFormat enum key
  const timeFormatKey = Object.keys(TimeFormat).find(
    (key) => TimeFormat[key as keyof typeof TimeFormat] === formatString
  ) as keyof typeof TimeFormat;

  if (timeFormatKey && timeFormats[TimeFormat[timeFormatKey]]) {
    return timeFormats[TimeFormat[timeFormatKey]];
  }

  // Handle combined date and time format (split by space)
  const parts = formatString.split(" ");
  if (parts.length === 2) {
    const datePart = parts[0];
    const timePart = parts[1];

    const mappedDatePart = dateFormats[datePart as DateFormat];
    const mappedTimePart = timeFormats[timePart as TimeFormat];

    if (mappedDatePart && mappedTimePart) {
      return `${mappedDatePart} ${mappedTimePart}`;
    }
  }

  // If no match found, assume it's a raw date-fns format string or invalid
  return formatString;
};
