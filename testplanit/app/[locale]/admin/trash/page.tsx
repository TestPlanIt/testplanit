"use client";

import { Filter } from "@/components/tables/Filter";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import DynamicIcon from "~/components/DynamicIcon";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { cn } from "~/utils";
import SoftDeletedDataTable from "./SoftDeletedDataTable";

import {
  softDeletedItemTypes,
  type TrashIconName as IconName,
} from "./itemTypes";

export default function TrashPage() {
  const tGlobal = useTranslations();
  const t = useTranslations("admin.trash");

  const [selectedTypeName, setSelectedTypeName] = useState(
    softDeletedItemTypes[0].name
  );
  const [typeFilter, setTypeFilter] = useState("");
  const [counts, setCounts] = useState<Record<string, number>>({});

  const fetchCounts = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/trash/counts");
      if (!response.ok) return;
      const { counts: fetchedCounts } = await response.json();
      setCounts(fetchedCounts ?? {});
    } catch {
      // Counts are a convenience; ignore failures and just omit the badges.
    }
  }, []);

  useEffect(() => {
    void fetchCounts();
  }, [fetchCounts]);

  // Resolve the translated label once per type so we can both render and filter.
  const typesWithLabels = useMemo(
    () =>
      softDeletedItemTypes
        .map((itemType) => ({
          ...itemType,
          label: tGlobal(itemType.translationKey as any),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [tGlobal]
  );

  const filteredTypes = useMemo(() => {
    const query = typeFilter.trim().toLowerCase();
    if (!query) return typesWithLabels;
    return typesWithLabels.filter((itemType) =>
      itemType.label.toLowerCase().includes(query)
    );
  }, [typesWithLabels, typeFilter]);

  const selectedType =
    typesWithLabels.find((itemType) => itemType.name === selectedTypeName) ??
    typesWithLabels[0];

  const totalCount = useMemo(
    () => Object.values(counts).reduce((sum, count) => sum + count, 0),
    [counts]
  );
  const hasCounts = Object.keys(counts).length > 0;
  const selectedCount = counts[selectedType.name] ?? 0;

  return (
    <Card>
      <CardHeader className="w-full">
        <SectionHeader className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CardTitle>{tGlobal("admin.menu.trash")}</CardTitle>
            <HelpPopover helpKey="trash" />
          </div>
          {hasCounts && (
            <span className="text-sm font-normal text-muted-foreground">
              {t("summary", { count: totalCount })}
            </span>
          )}
        </SectionHeader>
      </CardHeader>
      <CardContent>
        {/* Bound the master-detail region to the viewport on desktop so the page
            itself doesn't scroll; each column then scrolls independently at full
            height (rail list when it overflows, table body for infinite scroll). */}
        <div className="flex flex-col gap-4 md:h-[calc(100vh-15rem)] md:min-h-0 md:flex-row md:gap-6">
          {/* Left rail: filterable list of item types */}
          <div className="flex w-full shrink-0 flex-col md:w-72 md:min-h-0 md:border-e md:pe-4">
            <Filter
              placeholder={t("filterTypesPlaceholder")}
              initialSearchString={typeFilter}
              onSearchChange={setTypeFilter}
            />
            <div className="mt-3 flex flex-col gap-1 md:min-h-0 md:flex-1 md:overflow-y-auto md:pe-1">
              {filteredTypes.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  {tGlobal("common.labels.noResults")}
                </p>
              ) : (
                filteredTypes.map((itemType) => {
                  const isSelected = itemType.name === selectedType.name;
                  const count = counts[itemType.name] ?? 0;
                  return (
                    <button
                      key={itemType.name}
                      type="button"
                      onClick={() => setSelectedTypeName(itemType.name)}
                      aria-current={isSelected ? "true" : undefined}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-3 py-2 text-start text-sm transition-colors",
                        isSelected
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-foreground hover:bg-accent/50"
                      )}
                    >
                      <span className="flex min-w-0 items-center">
                        <DynamicIcon
                          name={itemType.iconName as IconName}
                          className="me-2 h-4 w-4 shrink-0"
                        />
                        <span className="truncate">{itemType.label}</span>
                      </span>
                      {count > 0 && (
                        <Badge
                          variant={isSelected ? "default" : "secondary"}
                          className="ms-2 shrink-0"
                        >
                          {count}
                        </Badge>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Detail pane: the selected type's table */}
          <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
            <div className="flex shrink-0 items-center px-2">
              <DynamicIcon
                name={selectedType.iconName as IconName}
                className="me-2 h-5 w-5 shrink-0"
              />
              <h2 className="text-lg font-semibold">{selectedType.label}</h2>
              {selectedCount > 0 && (
                <Badge variant="secondary" className="ms-2">
                  {selectedCount}
                </Badge>
              )}
            </div>
            <div className="min-h-0 flex-1">
              <SoftDeletedDataTable
                key={selectedType.name}
                itemType={selectedType.name}
                translationKey={selectedType.translationKey}
                onMutate={fetchCounts}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
