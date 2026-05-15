"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useMatrixCsvExport } from "~/hooks/useMatrixCsvExport";
import type { AxesShape } from "~/lib/matrix/types";

import { MatrixGrid } from "./MatrixGrid";

interface MatrixReportPresetProps {
  axes: AxesShape;
  projectId: number;
}

/**
 * Thin wrapper that mounts `MatrixGrid` inside the report-builder shell.
 *
 * Adds a minimal local toolbar — only an export button — because the outer
 * report shell already provides the page chrome (title, save, share). The
 * export uses the client-side CSV emit (`useMatrixCsvExport`), not the
 * server-side `/export` route, because the AxesShape is already in memory
 * here from the report shell's fetch.
 */
export function MatrixReportPreset({
  axes,
  projectId,
}: MatrixReportPresetProps) {
  const t = useTranslations("projects.matrix");
  const exportToCsv = useMatrixCsvExport();

  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end border-b p-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => exportToCsv(axes, `project-${projectId}`)}
          data-testid="matrix-preset-export-csv"
        >
          <Download className="h-4 w-4" />
          {t("exportCsv")}
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        <MatrixGrid axes={axes} projectId={projectId} />
      </div>
    </div>
  );
}
