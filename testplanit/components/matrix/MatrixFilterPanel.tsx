"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { ConfigurationNameDisplay } from "@/components/ConfigurationNameDisplay";
import DatasetNameDisplay from "@/components/parameters/DatasetNameDisplay";
import StatusDotDisplay from "@/components/StatusDotDisplay";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { searchProjectDataSets } from "~/app/actions/searchProjectDataSets";
import { searchProjectMatrixConfigurations } from "~/app/actions/searchProjectMatrixConfigurations";
import { searchProjectStatuses } from "~/app/actions/searchProjectStatuses";
import { useMatrixFilters } from "~/hooks/useMatrixFilters";

interface OptionRow {
  id: number;
  name: string;
}

interface StatusOptionRow {
  id: number;
  name: string;
  color: string;
}

interface DatasetOptionRow {
  id: number;
  name: string;
  isShared: boolean;
  ownerCaseName: string | null;
}

/**
 * Matrix-preset filter panel. Mounted inside the ReportBuilder shell's
 * filter rail (NOT above the grid) so the matrix preset matches the UX
 * of the other pre-built reports.
 *
 * Filter sources:
 *   - Statuses: scoped to the current project via `ProjectStatusAssignment`,
 *     rendered with `StatusDotDisplay` so users recognize statuses by
 *     their color swatch (matches the dropdowns in Test Runs).
 *   - Configurations: global (Configurations is a system-wide model — its
 *     project relevance is implicit via the runs that consume it).
 *   - DataSets: scoped to the current project (owner + shared).
 *
 * Date range comes from the report-builder shell's existing date picker;
 * `useMatrixFilters` reads `startDate`/`endDate` from the URL so no parallel
 * date inputs are needed here.
 *
 * Status hydration: when the URL pre-selects status ids (e.g. shared link
 * with `?status=2`), the combobox would otherwise show ID-only chips until
 * the user re-opens the picker. A single `useClientQueries(schema).status.useFindMany` query rehydrates
 * those ids to `{name, color}` so the chip shows the proper dot + label
 * on first paint.
 */
export function MatrixFilterPanel({ projectId }: { projectId: number }) {
  const t = useTranslations("projects.matrix");
  const { filters, setFilters } = useMatrixFilters();

  const statusIds = filters.statusIds ?? [];

  // Hydrate URL-loaded status ids → {name, color}. The combobox's `value` is
  // user-controlled; without a hydrate step, a fresh page load with
  // `?status=2` would show "#2" until the user re-opened the dropdown.
  const { data: hydratedStatusesRaw } = useClientQueries(
    schema
  ).status.useFindMany(
    {
      where: { id: { in: statusIds } },
      select: {
        id: true,
        name: true,
        color: { select: { value: true } },
      },
    },
    { enabled: statusIds.length > 0 }
  );

  const selectedStatuses: StatusOptionRow[] = useMemo(() => {
    const byId = new Map<
      number,
      { id: number; name: string; color: { value: string } | null }
    >(
      (
        (hydratedStatusesRaw ?? []) as Array<{
          id: number;
          name: string;
          color: { value: string } | null;
        }>
      ).map((s) => [s.id, s])
    );
    return statusIds.map((id) => {
      const hit = byId.get(id);
      return {
        id,
        name: hit?.name ?? `#${id}`,
        color: hit?.color?.value ?? "#B1B2B3",
      };
    });
  }, [statusIds, hydratedStatusesRaw]);

  // Hydrate URL-loaded configuration ids → names. The "(none)" sentinel
  // (id === 0) doesn't exist in the DB, so filter it out of the lookup.
  const configIds = filters.configIds ?? [];
  const realConfigIds = configIds.filter((id) => id !== 0);
  const { data: hydratedConfigsRaw } = useClientQueries(
    schema
  ).configurations.useFindMany(
    {
      where: { id: { in: realConfigIds } },
      select: { id: true, name: true },
    },
    { enabled: realConfigIds.length > 0 }
  );

  const selectedConfigs: OptionRow[] = useMemo(() => {
    const byId = new Map<number, { id: number; name: string }>(
      ((hydratedConfigsRaw ?? []) as Array<{ id: number; name: string }>).map(
        (c) => [c.id, c]
      )
    );
    return configIds.map((id) => {
      if (id === 0) return { id: 0, name: t("configNone") };
      const hit = byId.get(id);
      return { id, name: hit?.name ?? `#${id}` };
    });
  }, [configIds, hydratedConfigsRaw, t]);

  const datasetIds = filters.datasetIds ?? [];
  const { data: hydratedDatasetsRaw } = useClientQueries(
    schema
  ).dataSet.useFindMany(
    {
      where: { id: { in: datasetIds } },
      select: {
        id: true,
        name: true,
        isShared: true,
        ownerCase: { select: { name: true } },
      },
    },
    { enabled: datasetIds.length > 0 }
  );

  const selectedDatasets: DatasetOptionRow[] = useMemo(() => {
    type Row = {
      id: number;
      name: string;
      isShared: boolean;
      ownerCase: { name: string } | null;
    };
    const byId = new Map<number, Row>(
      ((hydratedDatasetsRaw ?? []) as Row[]).map((d) => [d.id, d])
    );
    return datasetIds.map((id) => {
      const hit = byId.get(id);
      return {
        id,
        name: hit?.name ?? `#${id}`,
        isShared: hit?.isShared ?? false,
        ownerCaseName: hit?.ownerCase?.name ?? null,
      };
    });
  }, [datasetIds, hydratedDatasetsRaw]);

  return (
    <div className="grid gap-4" data-testid="matrix-filter-panel">
      <div className="grid gap-1.5">
        <label className="text-sm font-medium">{t("filterStatusLabel")}</label>
        <MultiAsyncCombobox<StatusOptionRow>
          value={selectedStatuses}
          onValueChange={(opts) =>
            setFilters({ statusIds: opts.map((o) => o.id) })
          }
          fetchOptions={(query, page, pageSize) =>
            searchProjectStatuses(projectId, query, page, pageSize)
          }
          renderOption={(opt) => (
            <StatusDotDisplay name={opt.name} color={opt.color} />
          )}
          renderSelectedOption={(opt) => (
            <StatusDotDisplay name={opt.name} color={opt.color} />
          )}
          getOptionValue={(opt) => opt.id}
          getOptionLabel={(opt) => opt.name}
          placeholder={t("filterStatusPlaceholder")}
          pageSize={20}
        />
      </div>

      <div className="grid gap-1.5">
        <label className="text-sm font-medium">{t("filterConfigLabel")}</label>
        <MultiAsyncCombobox<OptionRow>
          value={selectedConfigs}
          onValueChange={(opts) =>
            setFilters({ configIds: opts.map((o) => o.id) })
          }
          fetchOptions={async (query, page, pageSize) => {
            const real = await searchProjectMatrixConfigurations(
              projectId,
              query,
              page,
              pageSize
            );
            // Synthetic "(none)" sentinel matches the cell axis "(none)"
            // column. Only show on the first page when there's no search
            // query — otherwise it pollutes paginated results.
            if (page === 0 && (!query || query.trim().length === 0)) {
              return {
                results: [{ id: 0, name: t("configNone") }, ...real.results],
                total: real.total + 1,
              };
            }
            return real;
          }}
          renderOption={(opt) => <ConfigurationNameDisplay name={opt.name} />}
          renderSelectedOption={(opt) => (
            <ConfigurationNameDisplay name={opt.name} />
          )}
          getOptionValue={(opt) => opt.id}
          getOptionLabel={(opt) => opt.name}
          placeholder={t("filterConfigPlaceholder")}
          pageSize={20}
        />
      </div>

      <div className="grid gap-1.5">
        <label className="text-sm font-medium">{t("filterDatasetLabel")}</label>
        <MultiAsyncCombobox<DatasetOptionRow>
          value={selectedDatasets}
          onValueChange={(opts) =>
            setFilters({ datasetIds: opts.map((o) => o.id) })
          }
          fetchOptions={(query, page, pageSize) =>
            searchProjectDataSets(projectId, query, page, pageSize)
          }
          renderOption={(opt) => (
            <DatasetNameDisplay
              name={opt.name}
              isShared={opt.isShared}
              ownerCaseName={opt.ownerCaseName}
            />
          )}
          renderSelectedOption={(opt) => (
            <DatasetNameDisplay
              name={opt.name}
              isShared={opt.isShared}
              ownerCaseName={opt.ownerCaseName}
            />
          )}
          getOptionValue={(opt) => opt.id}
          getOptionLabel={(opt) => opt.name}
          placeholder={t("filterDatasetPlaceholder")}
          pageSize={20}
        />
      </div>
    </div>
  );
}
