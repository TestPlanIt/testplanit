import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Control, FieldPath, FieldValues } from "react-hook-form";
import { cn, type ClassValue } from "~/utils";
import { fromCalendarDate, toCalendarDate } from "~/utils/calendarDate";
import { getDateFnsLocale } from "~/utils/locales";

interface DatePickerFieldProps<T extends FieldValues = FieldValues> {
  control: Control<T>;
  name: FieldPath<T>;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  className?: ClassValue;
  helpKey?: string;
  /**
   * Stores the picked day as a calendar date — UTC midnight — instead of
   * midnight in the browser's zone, so the value means the same day to every
   * reader and can be rendered without timezone conversion. Set it wherever
   * the field is displayed with `dateOnly` (milestone start/due dates); see
   * `~/utils/calendarDate`.
   *
   * The conversion runs in both directions, because react-day-picker and
   * date-fns `format` both read a Date in local time: a stored UTC midnight
   * would otherwise highlight and label the previous day west of Greenwich.
   */
  dateOnly?: boolean;
}

export function DatePickerField<T extends FieldValues = FieldValues>({
  control,
  name,
  label,
  placeholder,
  disabled = false,
  minDate = new Date("1900-01-01"),
  maxDate = new Date("2099-12-31"),
  className,
  helpKey,
  dateOnly = false,
}: DatePickerFieldProps<T>) {
  const locale = useLocale();
  const t = useTranslations("common.actions");
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Local-time view of the stored value, for the calendar grid and the label.
  const toLocal = (value: Date | null | undefined) =>
    value && dateOnly ? fromCalendarDate(value) : (value ?? undefined);

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn("flex flex-col", className)}>
          {label && (
            <FormLabel className="flex items-center">
              {label}
              {helpKey && <HelpPopover helpKey={helpKey} />}
            </FormLabel>
          )}
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <FormControl>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[240px] ps-3 text-start font-normal",
                    !field.value && "text-muted-foreground"
                  )}
                  disabled={disabled}
                >
                  {field.value ? (
                    format(toLocal(field.value)!, "PPP", {
                      locale: getDateFnsLocale(locale),
                    })
                  ) : (
                    <span>{placeholder}</span>
                  )}
                  <CalendarDays className="ms-auto h-4 w-4 opacity-50" />
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={toLocal(field.value)}
                onSelect={(date) => {
                  field.onChange(
                    date && dateOnly ? toCalendarDate(date) : date
                  );
                  setPopoverOpen(false);
                }}
                disabled={(date) => date > maxDate || date < minDate}
                autoFocus
              />
              <div className="p-2 border-t border-border">
                <Button
                  variant="ghost"
                  className="w-full justify-center text-sm"
                  onClick={() => {
                    field.onChange(null);
                    setPopoverOpen(false);
                  }}
                  disabled={!field.value}
                >
                  {t("clear")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
