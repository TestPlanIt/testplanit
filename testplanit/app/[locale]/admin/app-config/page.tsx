"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useDebounce } from "@/components/Debounce";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CirclePlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { AddAppConfig } from "./AddAppConfig";
import { getColumns } from "./columns";
import { DeleteAppConfig } from "./DeleteAppConfig";
import { EditAppConfig } from "./EditAppConfig";
import { AppConfigRow } from "./types";

export default function AppConfigsPage() {
  return <AppConfigs />;
}

function AppConfigs() {
  const locale = useLocale();
  const t = useTranslations("admin.appConfig");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const [searchString, setSearchString] = useState("");
  const [valueSearchString, setValueSearchString] = useState("");
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "key",
    direction: "asc",
  });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [addAppConfigOpen, setAddAppConfigOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<AppConfigRow | null>(null);
  const [deletingConfig, setDeletingConfig] = useState<AppConfigRow | null>(
    null
  );

  const debouncedSearchString = useDebounce(searchString, 300);
  const debouncedValueSearchString = useDebounce(valueSearchString, 300);

  // Full-set fetch: the value filter below runs client-side over every config,
  // and the virtualized table renders only the visible window, so there's no
  // pagination and value-search covers the whole set (not just one page).
  const { data: appConfigs, isLoading } = useClientQueries(
    schema
  ).appConfig.useFindMany({
    where: {
      key: {
        contains: debouncedSearchString,
        mode: "insensitive",
      },
    },
    orderBy: {
      [sortConfig.column]: sortConfig.direction,
    },
  });

  // Transform AppConfig to AppConfigRow and filter by value
  const tableData: AppConfigRow[] = useMemo(() => {
    let filteredConfigs = appConfigs || [];

    // Filter by value if value search string exists
    if (debouncedValueSearchString) {
      filteredConfigs = filteredConfigs.filter((config) => {
        const valueString =
          typeof config.value === "object"
            ? JSON.stringify(config.value)
            : String(config.value);
        return valueString
          .toLowerCase()
          .includes(debouncedValueSearchString.toLowerCase());
      });
    }

    return filteredConfigs.map((config) => ({
      ...config,
      id: config.key, // Use key as id since it's unique
      name: config.key, // Use key as name to satisfy DataRow
    }));
  }, [appConfigs, debouncedValueSearchString]);

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig.column === column && sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig({ column: "key", direction: "asc" });
    } else {
      setSortConfig({ column, direction });
    }
  };

  const columns = useMemo(
    () => getColumns(tCommon, setEditingConfig, setDeletingConfig),
    [tCommon]
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle data-testid="app-config-title">
              {tGlobal("admin.menu.appConfig")}
            </CardTitle>
          </SectionHeader>
          <Button
            onClick={() => setAddAppConfigOpen(true)}
            aria-label={t("addConfig")}
            className="group gap-0 transition-all duration-200 hover:gap-2"
          >
            <CirclePlus className="h-4 w-4" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
              {t("addConfig")}
            </span>
          </Button>
        </div>
        {addAppConfigOpen && (
          <AddAppConfig
            open={addAppConfigOpen}
            onClose={() => setAddAppConfigOpen(false)}
          />
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Filter
              key="app-config-filter"
              className="max-w-none"
              placeholder={t("filterPlaceholder")}
              initialSearchString={searchString}
              onSearchChange={setSearchString}
              dataTestId="app-config-filter-input"
            />
            <Filter
              key="app-config-value-filter"
              className="max-w-none"
              placeholder={tCommon("placeholders.filterByValue")}
              initialSearchString={valueSearchString}
              onSearchChange={setValueSearchString}
              dataTestId="app-config-value-filter-input"
            />
          </div>

          {tableData.length > 0 && (
            <p className="text-end text-sm text-muted-foreground">
              {tGlobal("admin.auditLogs.showing", {
                loaded: tableData.length.toLocaleString(locale),
                total: tableData.length.toLocaleString(locale),
              })}
            </p>
          )}
        </div>
        <div className="mt-4 w-full">
          <DataTable
            virtualized
            fillViewport
            flexColumnId="value"
            columns={columns as any}
            data={tableData}
            onSortChange={handleSortChange}
            onSortColumn={handleSortColumn}
            sortConfig={sortConfig}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            isLoading={isLoading}
            resetKey={`${debouncedSearchString}|${debouncedValueSearchString}|${sortConfig.column}|${sortConfig.direction}`}
            testIdPrefix="admin-app-config-table"
            rowTestIdPrefix="admin-app-config-row"
          />
        </div>
      </CardContent>
      {editingConfig && (
        <EditAppConfig
          config={editingConfig}
          open={true}
          onClose={() => setEditingConfig(null)}
        />
      )}
      {deletingConfig && (
        <DeleteAppConfig
          config={deletingConfig}
          open={true}
          onClose={() => setDeletingConfig(null)}
        />
      )}
    </Card>
  );
}
