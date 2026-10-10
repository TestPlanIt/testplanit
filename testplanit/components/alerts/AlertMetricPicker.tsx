"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  ALERT_METRIC_CATALOGUE,
  type AlertMetricDefinition,
} from "~/lib/alerts/catalogue";
import { AlertMetric, AlertSubjectType } from "~/zenstack/models";
import { cn } from "~/utils";

/** Group order on the picker: what the metric watches, most common first. */
const GROUP_ORDER: AlertSubjectType[] = [
  AlertSubjectType.CASE,
  AlertSubjectType.RUN,
  AlertSubjectType.SESSION,
  AlertSubjectType.MILESTONE,
  AlertSubjectType.PROJECT,
  AlertSubjectType.WEBHOOK,
  AlertSubjectType.LLM_INTEGRATION,
];

/**
 * Searchable, grouped metric picker. Metrics are grouped by the subject
 * they watch, straight from the catalogue, so a new metric needs no change
 * here. Each row shows the label and its one-line description; scheduled
 * metrics carry a "checked daily" badge. `system` narrows the list to the
 * system metrics (a system alert) or to the project ones.
 */
export function AlertMetricPicker({
  value,
  onChange,
  disabled,
  system = false,
}: {
  value: AlertMetric;
  onChange: (metric: AlertMetric) => void;
  disabled?: boolean;
  system?: boolean;
}) {
  const t = useTranslations("alerts");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (entry: AlertMetricDefinition) => {
      if (!q) return true;
      const label = t(`metrics.${entry.metric}.label` as never).toLowerCase();
      const description = t(
        `metrics.${entry.metric}.description` as never
      ).toLowerCase();
      return label.includes(q) || description.includes(q);
    };
    return GROUP_ORDER.map((subject) => ({
      subject,
      entries: ALERT_METRIC_CATALOGUE.filter(
        (entry) =>
          entry.subjectType === subject &&
          (entry.system === true) === system &&
          matches(entry)
      ),
    })).filter((group) => group.entries.length > 0);
  }, [query, t, system]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between bg-transparent font-normal hover:bg-muted"
          data-testid="alert-rule-metric"
        >
          <span className="truncate">
            {t(`metrics.${value}.label` as never)}
          </span>
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[360px] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("form.metricSearch")}
            // Room for the focus ring: the popover clips its overflow and
            // the input otherwise sits flush against its top edge.
            className="my-0.5"
            data-testid="alert-metric-search"
          />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>{t("form.metricNoMatch")}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.subject}
                heading={t(`metricGroups.${group.subject}` as never)}
              >
                {group.entries.map((entry) => (
                  <CommandItem
                    key={entry.metric}
                    value={entry.metric}
                    onSelect={() => {
                      onChange(entry.metric);
                      setOpen(false);
                    }}
                    className="items-start gap-2 py-2"
                    data-testid={`alert-metric-${entry.metric}`}
                  >
                    <Check
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        entry.metric === value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">
                          {t(`metrics.${entry.metric}.label` as never)}
                        </span>
                        {entry.path === "scheduled" && (
                          <Badge
                            variant="outline"
                            className="shrink-0 whitespace-nowrap text-[10px]"
                          >
                            {entry.schedule === "hourly"
                              ? t("form.checkedHourly")
                              : t("form.checkedDaily")}
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {t(`metrics.${entry.metric}.description` as never)}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
