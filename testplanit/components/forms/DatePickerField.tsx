import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn, type ClassValue } from "~/utils";
import { getDateFnsLocale } from "~/utils/locales";
import { Control } from "react-hook-form";
import { HelpPopover } from "@/components/ui/help-popover";
import { useState } from "react";

interface DatePickerFieldProps {
  control: Control<any>;
  name: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  minDate?: Date;
  maxDate?: Date;
  className?: ClassValue;
  helpKey?: string;
}

export function DatePickerField({
  control,
  name,
  label,
  placeholder,
  disabled = false,
  minDate = new Date("1900-01-01"),
  maxDate = new Date("2099-12-31"),
  className,
  helpKey,
}: DatePickerFieldProps) {
  const locale = useLocale();
  const t = useTranslations("common.actions");
  const [popoverOpen, setPopoverOpen] = useState(false);

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
                    "w-[240px] pl-3 text-left font-normal",
                    !field.value && "text-muted-foreground"
                  )}
                  disabled={disabled}
                >
                  {field.value ? (
                    format(field.value, "PPP", {
                      locale: getDateFnsLocale(locale),
                    })
                  ) : (
                    <span>{placeholder}</span>
                  )}
                  <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </FormControl>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={field.value}
                onSelect={(date) => {
                  field.onChange(date);
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
