"use client";

import { useTranslations } from "next-intl";

import {
  glyphFromStatus,
  IterationStatusPip,
} from "@/components/iterations/IterationStatusPip";
import { Link } from "~/lib/navigation";
import type { CellSummary, StatusMapEntry } from "~/lib/matrix/types";

/**
 * Drill-down popover surfaced by `MatrixCell` on click.
 *
 * Renders one row per iteration in the cell with a status pip + label
 * + link to the run page (preselects the iteration via `?iteration=` and
 * the case via `?selectedCase=` so the run page opens the iteration
 * sidebar in the right place). The link uses `~/lib/navigation`'s `Link`
 * so the i18n locale prefix is preserved.
 *
 * In-flight iterations (those without a recorded result yet) don't appear
 * in `cell.iterations` because the aggregation route only returns
 * iterations that have been touched. The footer hint surfaces that to
 * the user explicitly.
 */
export function MatrixCellPopover({
  cell,
  statusMap,
  projectId,
  caseId,
}: {
  cell: CellSummary;
  statusMap: Record<number, StatusMapEntry>;
  projectId: number;
  caseId: number;
}) {
  const t = useTranslations("projects.matrix");

  return (
    <div className="p-3" data-testid="matrix-cell-popover">
      <div className="mb-2 font-medium">
        {t("popoverTitle", { count: cell.iterationCount })}
      </div>
      <ul className="max-h-64 space-y-1 overflow-auto">
        {cell.iterations.map((iter) => {
          const status = iter.statusId ? statusMap[iter.statusId] : null;
          const glyph = glyphFromStatus(
            status
              ? {
                  isSuccess: status.isSuccess,
                  isFailure: status.isFailure,
                  isCompleted: status.isCompleted,
                }
              : null,
            false
          );
          return (
            <li
              key={iter.id}
              className="flex items-center gap-2 text-sm"
              data-testid={`matrix-popover-row-${iter.id}`}
            >
              <IterationStatusPip
                glyph={glyph}
                statusColor={status?.colorValue}
              />
              <span className="flex-1 truncate" title={status?.name ?? ""}>
                {iter.label ?? t("iterationUnlabeled", { index: iter.id })}
              </span>
              <Link
                href={`/projects/runs/${projectId}/${iter.runId}?iteration=${iter.id}&selectedCase=${caseId}`}
                className="truncate text-xs text-primary hover:underline"
                data-testid={`matrix-popover-link-${iter.id}`}
                title={iter.runName}
              >
                {iter.runName}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("popoverInflightHint")}
      </p>
    </div>
  );
}
