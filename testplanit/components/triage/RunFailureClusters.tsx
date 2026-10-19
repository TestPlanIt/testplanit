"use client";

import { DataTable } from "@/components/tables/DataTable";
import type {
  ColumnDef,
  VisibilityState,
} from "@/components/tables/tableFeatures";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import {
  ClassificationBadge,
  SignatureStatusBadge,
} from "@/components/triage/badges";
import { Badge } from "@/components/ui/badge";
import { Microscope } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CollapsibleSection } from "~/components/CollapsibleSection";
import { Link } from "~/lib/navigation";
import { cn } from "~/utils";
import type {
  FailureClassification,
  FailureClassificationSource,
  FailureSignatureStatus,
} from "~/zenstack/models";

export interface RunResultSignatureIssue {
  id: number;
  name: string;
  externalId?: string | null;
  externalUrl?: string | null;
  externalKey?: string | null;
  title?: string | null;
  description?: string | null;
  externalStatus?: string | null;
  priority?: string | null;
  lastSyncedAt?: string | Date | null;
  data?: unknown;
  integration?: { id: number; provider: string; name: string } | null;
  issueTypeName?: string | null;
  issueTypeIconUrl?: string | null;
}

export interface RunResultSignature {
  id: number;
  title: string;
  classification: FailureClassification;
  classificationSource: FailureClassificationSource | null;
  aiConfidence: number | null;
  status: FailureSignatureStatus;
  issues: { issue: RunResultSignatureIssue }[];
}

interface RunFailureClustersProps {
  projectId: number;
  /** The run's automated result rows (one per attempt). */
  rows: {
    resultId: number;
    resultType: string;
    failureSignatureId?: number | null;
    failureSignature?: RunResultSignature | null;
  }[];
  selectedSignatureIds: number[];
  onToggleSignature: (signatureId: number) => void;
}

type ClusterRow = {
  id: number;
  title: string;
  count: number;
  classification: FailureClassification;
  classificationSource: FailureClassificationSource | null;
  aiConfidence: number | null;
  status: FailureSignatureStatus;
  issues: RunResultSignatureIssue[];
};

type SortState = { column: string; direction: "asc" | "desc" };
const DEFAULT_SORT: SortState = { column: "count", direction: "desc" };

function pickSortValue(row: ClusterRow, column: string): string | number {
  switch (column) {
    case "title":
      return row.title;
    case "classification":
      return row.classification;
    case "status":
      return row.status;
    case "issues":
      return row.issues.length;
    default:
      return row.count;
  }
}

/**
 * Groups a run's FAILURE/ERROR results by failure signature. Clicking a
 * row filters the results table to that signature.
 */
export function RunFailureClusters({
  projectId,
  rows,
  selectedSignatureIds,
  onToggleSignature,
}: RunFailureClustersProps) {
  const t = useTranslations("triage");
  const tCommon = useTranslations("common");
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});

  const { clusters, ungrouped } = useMemo(() => {
    const byId = new Map<number, ClusterRow>();
    let ungrouped = 0;
    for (const row of rows) {
      if (row.resultType !== "FAILURE" && row.resultType !== "ERROR") continue;
      const signature = row.failureSignature;
      if (!signature) {
        ungrouped++;
        continue;
      }
      const entry = byId.get(signature.id);
      if (entry) {
        entry.count++;
      } else {
        byId.set(signature.id, {
          id: signature.id,
          title: signature.title,
          count: 1,
          classification: signature.classification,
          classificationSource: signature.classificationSource,
          aiConfidence: signature.aiConfidence,
          status: signature.status,
          issues: signature.issues.map((link) => link.issue),
        });
      }
    }
    return { clusters: [...byId.values()], ungrouped };
  }, [rows]);

  const sortedClusters = useMemo(() => {
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...clusters].sort((a, b) => {
      const av = pickSortValue(a, sort.column);
      const bv = pickSortValue(b, sort.column);
      if (typeof av === "number" && typeof bv === "number") {
        return direction * (av - bv);
      }
      return (
        direction *
        String(av).localeCompare(String(bv), undefined, { sensitivity: "base" })
      );
    });
  }, [clusters, sort]);

  const tTitle = tCommon("fields.title");
  const tInRun = t("runPanel.inRunColumn");
  const tClassification = t("columns.classification");
  const tStatus = tCommon("actions.status");
  const tIssues = tCommon("fields.issues");
  const tView = t("runPanel.open");

  const columns = useMemo<ColumnDef<ClusterRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: tTitle,
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 520,
        minSize: 120,
        cell: ({ row, column }) => (
          <button
            type="button"
            style={{ maxWidth: column.getSize() }}
            className="block w-full cursor-pointer truncate text-start font-mono text-xs hover:underline"
            title={row.original.title}
            aria-pressed={selectedSignatureIds.includes(row.original.id)}
            onClick={() => onToggleSignature(row.original.id)}
            data-testid="run-failure-cluster-title"
          >
            {row.original.title}
          </button>
        ),
      },
      {
        id: "count",
        accessorKey: "count",
        header: tInRun,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 150,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.count}</span>
        ),
      },
      {
        id: "classification",
        accessorKey: "classification",
        header: tClassification,
        enableSorting: true,
        enableResizing: true,
        size: 190,
        cell: ({ row }) => (
          <ClassificationBadge
            classification={row.original.classification}
            source={row.original.classificationSource}
          />
        ),
      },
      {
        id: "status",
        accessorKey: "status",
        header: tStatus,
        enableSorting: true,
        enableResizing: true,
        size: 130,
        cell: ({ row }) => (
          <SignatureStatusBadge status={row.original.status} />
        ),
      },
      {
        id: "issues",
        accessorFn: (row) => row.issues.length,
        header: tIssues,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 130,
        cell: ({ row }) =>
          row.original.issues.length > 0 ? (
            <IssuesListDisplay
              issues={row.original.issues.map((issue) => ({
                ...issue,
                projectIds: [projectId],
              }))}
              size="small"
            />
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 140,
        cell: ({ row }) => (
          <Link
            href={`/projects/triage/${projectId}/${row.original.id}`}
            onClick={(event) => event.stopPropagation()}
            className="text-xs text-primary hover:underline"
            data-testid="run-failure-cluster-view"
          >
            {tView}
          </Link>
        ),
      },
    ],
    [
      projectId,
      selectedSignatureIds,
      onToggleSignature,
      tTitle,
      tInRun,
      tClassification,
      tStatus,
      tIssues,
      tView,
    ]
  );

  if (clusters.length === 0 && ungrouped === 0) return null;

  return (
    <CollapsibleSection
      storageKey="tpi.run.failureClusters.collapsed"
      icon={<Microscope className="h-4 w-4" aria-hidden />}
      title={
        <span className="flex items-center gap-2">
          <span>{t("runPanel.title")}</span>
          <Badge variant="secondary" className="font-normal">
            {clusters.length}
          </Badge>
        </span>
      }
      contentClassName="p-0"
      className="space-y-2"
    >
      <p className="pb-2 text-sm text-muted-foreground">{t("runPanel.hint")}</p>
      <div data-testid="run-failure-clusters-panel">
        <DataTable
          virtualized
          columns={columns}
          data={sortedClusters}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          sortConfig={sort}
          onSortChange={(column) =>
            setSort((prev) =>
              prev.column === column
                ? {
                    column,
                    direction: prev.direction === "asc" ? "desc" : "asc",
                  }
                : { column, direction: column === "title" ? "asc" : "desc" }
            )
          }
          onSortColumn={(column, direction) =>
            setSort(direction ? { column, direction } : DEFAULT_SORT)
          }
          getRowId={(row) => String(row.id)}
          getRowProps={(row) => {
            const selected = selectedSignatureIds.includes(row.original.id);
            return {
              className: cn(selected && "table-row-surface-selected"),
              "aria-pressed": selected,
            };
          }}
          columnSizingStorageKey="run-failure-clusters"
          testIdPrefix="run-failure-clusters"
          rowTestIdPrefix="run-failure-cluster"
        />
      </div>
      {ungrouped > 0 && (
        <p className="pt-2 text-xs text-muted-foreground">
          {t("notGrouped", { count: ungrouped })}
        </p>
      )}
    </CollapsibleSection>
  );
}
