"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import type { MatrixFilters } from "~/lib/matrix/types";

interface MatrixToolbarProps {
  projectId: number;
  filters: MatrixFilters;
  hasData: boolean;
}

/**
 * Page-level chrome above the filter bar: title + Export CSV.
 *
 * The export hits the dedicated server-side streaming route
 * (`/api/projects/{id}/matrix/export`) — anchored as a plain `<a download>`
 * so the browser handles the response stream natively. Disabled when there
 * is no data to export (avoids hitting the route with an empty grid).
 */
export function MatrixToolbar({
  projectId,
  filters,
  hasData,
}: MatrixToolbarProps) {
  const t = useTranslations("projects.matrix");

  const exportUrl = useMemo(() => {
    const sp = new URLSearchParams();
    filters.statusIds?.forEach((id) => sp.append("status", String(id)));
    filters.configIds?.forEach((id) => sp.append("config", String(id)));
    filters.datasetIds?.forEach((id) => sp.append("dataset", String(id)));
    if (filters.dateFrom) sp.set("from", filters.dateFrom);
    if (filters.dateTo) sp.set("to", filters.dateTo);
    const qs = sp.toString();
    return qs
      ? `/api/projects/${projectId}/matrix/export?${qs}`
      : `/api/projects/${projectId}/matrix/export`;
  }, [projectId, filters]);

  return (
    <div
      className="flex items-center justify-between border-b p-3"
      data-testid="matrix-toolbar"
    >
      <h1 className="text-lg font-medium">{t("pageTitle")}</h1>
      {hasData ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          data-testid="matrix-export-csv"
        >
          <a href={exportUrl} download>
            <Download className="mr-1 h-4 w-4" />
            {t("exportCsv")}
          </a>
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled
          data-testid="matrix-export-csv"
        >
          <Download className="mr-1 h-4 w-4" />
          {t("exportCsv")}
        </Button>
      )}
    </div>
  );
}
