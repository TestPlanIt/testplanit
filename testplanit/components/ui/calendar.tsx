import { useLocale } from "next-intl";
import * as React from "react";
import { DayPicker } from "react-day-picker";

import { buttonVariants } from "@/components/ui/button";
import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { cn } from "~/utils";
import { getDateFnsLocale } from "~/utils/locales";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  const currentLocale = useLocale();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      locale={getDateFnsLocale(currentLocale)}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        // `caption` was a v9 deprecated alias removed in v10; it never applied
        // at runtime (the month caption reads `month_caption`), so dropping it
        // preserves the current left-aligned caption layout.
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex w-full justify-between",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        weekdays: "flex",
        weekday:
          "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].outside)]:bg-accent/50 [&:has([aria-selected].range-end)]:rounded-e-md",
          props.mode === "range"
            ? "[&:has(>.range-end)]:rounded-e-md [&:has(>.range-start)]:rounded-s-md first:[&:has([aria-selected])]:rounded-s-md last:[&:has([aria-selected])]:rounded-e-md"
            : "[&:has([aria-selected])]:rounded-md"
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 p-0 font-medium text-sm aria-selected:opacity-100"
        ),
        range_start: "range-start",
        range_end: "range-end",
        selected:
          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground rounded-md",
        today: "ring-1 ring-muted-foreground/30 text-foreground rounded-md",
        outside:
          "outside text-muted-foreground/30 aria-selected:bg-accent/50 aria-selected:text-muted-foreground",
        disabled: "text-muted-foreground opacity-50",
        range_middle:
          "aria-selected:bg-primary/20 aria-selected:text-foreground",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: (({ ...props }: any) => {
          if (props.orientation === "left") {
            return (
              <ChevronLeftIcon
                className={cn("h-4 w-4 rtl:rotate-180")}
                {...props}
              />
            );
          }
          return (
            <ChevronRightIcon
              className={cn("h-4 w-4 rtl:rotate-180")}
              {...props}
            />
          );
        }) as any,
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
