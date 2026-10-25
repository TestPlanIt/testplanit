"use client";

import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { DataTable } from "@/components/tables/DataTable";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import type {
  ColumnDef,
  RowSelectionState,
} from "@/components/tables/tableFeatures";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { schema } from "~/zenstack/schema";
import { RiskScoreCell } from "./RiskScoreCell";

/** The other of the two case kinds. */
function otherKind(kind: "manual" | "automated") {
  return kind === "manual" ? "automated" : "manual";
}

/** Rows fetched per page; the list loads more as it is scrolled. */
export const RISK_PAGE_SIZE = 50;
const SCORE_STEP = 5;
const ROW_HEIGHT = 52;

// Nothing here is hideable; the table still wants the visibility pair, and
// every column must be named in it or it is dropped from the render.
const noopVisibilityChange = () => {};

interface RiskCandidate {
  id: number;
  name: string;
  automated: boolean;
  isDeleted: boolean;
  riskScore: number | null;
  riskReasons: unknown;
  folder?: { name: string } | null;
}

interface RiskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  /** Cases already picked for the run; they are left out of the candidates. */
  currentSelection: number[];
  onAccept: (ids: number[]) => void;
}

export function RiskDialog({
  open,
  onOpenChange,
  projectId,
  currentSelection,
  onAccept,
}: RiskDialogProps) {
  const t = useTranslations("runs.risk");
  const tCommon = useTranslations("common");
  const [minScore, setMinScore] = useState(0);
  // Both kinds to start; the last one checked cannot be unchecked, so the
  // list always has something it could show.
  const [kinds, setKinds] = useState({ manual: true, automated: true });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  // The threshold defines the candidate set, so changing it starts the
  // choice over: keeping ids from the old set would mean adding cases the
  // list no longer shows, and the counts would disagree about how many are
  // selected.
  useEffect(() => {
    setRowSelection({});
  }, [minScore, kinds]);

  const queries = useClientQueries(schema);

  const where = useMemo(
    () => ({
      projectId,
      isDeleted: false,
      isArchived: false,
      // `gte` also drops never-scored cases, which have nothing to rank by.
      riskScore: { gte: minScore },
      // Only a narrowing: with both kinds wanted there is nothing to say.
      ...(kinds.manual === kinds.automated
        ? {}
        : { automated: kinds.automated }),
      ...(currentSelection.length > 0
        ? { id: { notIn: currentSelection } }
        : {}),
    }),
    [projectId, minScore, kinds, currentSelection]
  );
  const queryArgs = useMemo(
    () => ({
      where,
      orderBy: [{ riskScore: "desc" as const }, { id: "asc" as const }],
      select: {
        id: true,
        name: true,
        automated: true,
        isDeleted: true,
        riskScore: true,
        riskReasons: true,
        folder: { select: { name: true } },
      },
      take: RISK_PAGE_SIZE,
    }),
    [where]
  );

  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = queries.repositoryCases.useInfiniteFindMany(queryArgs, {
    getNextPageParam: (lastPage: unknown[], allPages: unknown[][]) =>
      !lastPage || lastPage.length < RISK_PAGE_SIZE
        ? undefined
        : { ...queryArgs, skip: allPages.flat().length },
    enabled: open,
  });
  const { data: matchingTotal } = queries.repositoryCases.useCount(
    { where },
    { enabled: open }
  );

  // Selecting every match means ids the list has not paged in yet, so they
  // are fetched on demand — ids only, and only when asked for.
  const allMatchingIds = queries.repositoryCases.useFindMany(
    { where, select: { id: true } },
    { enabled: false }
  );
  const selectAllMatches = async () => {
    const { data } = await allMatchingIds.refetch();
    if (!data) return;
    setRowSelection(
      Object.fromEntries(
        (data as { id: number }[]).map((row) => [String(row.id), true])
      )
    );
  };

  const rows = useMemo<RiskCandidate[]>(
    () => (pages?.pages.flat() ?? []) as RiskCandidate[],
    [pages]
  );

  const selectedIds = useMemo(
    () =>
      Object.entries(rowSelection)
        .filter(([, picked]) => picked)
        .map(([id]) => Number(id))
        .filter((id) => Number.isInteger(id)),
    [rowSelection]
  );

  const columns = useMemo<ColumnDef<RiskCandidate>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(value === true)
            }
            aria-label={tCommon("aria.selectAll")}
            data-testid="risk-select-all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(value === true)}
            aria-label={row.original.name}
            data-testid={`risk-candidate-checkbox-${row.original.id}`}
          />
        ),
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        size: 48,
        minSize: 48,
        maxSize: 48,
      },
      {
        id: "case",
        header: t("caseColumn"),
        // Declared width is only a floor; `flexColumnId` hands this column
        // whatever the other two do not use.
        size: 320,
        enableSorting: false,
        meta: { wrap: true },
        cell: ({ row }) => (
          <div className="min-w-0">
            <CaseDisplay
              id={row.original.id}
              name={row.original.name}
              automated={row.original.automated}
              isDeleted={row.original.isDeleted}
              projectId={projectId}
              linkTarget="_blank"
              maxLines={1}
              className="text-sm font-medium"
            />
            {row.original.folder && (
              <p className="truncate text-xs text-muted-foreground">
                {row.original.folder.name}
              </p>
            )}
          </div>
        ),
      },
      {
        id: "riskScore",
        header: t("scoreColumn"),
        size: 90,
        minSize: 90,
        enableSorting: false,
        cell: ({ row }) => (
          <RiskScoreCell
            score={row.original.riskScore}
            reasons={row.original.riskReasons}
          />
        ),
      },
    ],
    [t, tCommon, projectId]
  );

  const columnVisibility = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id, true])),
    [columns]
  );

  const allLoadedSelected =
    rows.length > 0 && rows.every((row) => rowSelection[String(row.id)]);
  const unloadedMatches = Math.max(
    0,
    (matchingTotal ?? rows.length) - rows.length
  );
  const allMatchesSelected =
    allLoadedSelected &&
    matchingTotal != null &&
    matchingTotal > 0 &&
    selectedIds.length >= matchingTotal;

  const handleAccept = () => {
    onAccept(selectedIds);
    setRowSelection({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-h-[900px] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-64 items-center gap-3">
            <Label htmlFor="risk-min-score" className="whitespace-nowrap">
              {t("minimumScore")}
            </Label>
            <Slider
              id="risk-min-score"
              min={0}
              max={100}
              step={SCORE_STEP}
              value={[minScore]}
              onValueChange={([value]) => setMinScore(value)}
              className="w-40"
              data-testid="risk-min-score"
            />
            <span className="w-8 text-sm tabular-nums">{minScore}</span>
          </div>

          <div className="flex items-center gap-4">
            {(
              [
                ["manual", "fields.manual"],
                ["automated", "fields.automated"],
              ] as const
            ).map(([kind, labelKey]) => {
              // Unchecking the only one left would leave a list that can
              // never have a row in it, so that box holds.
              const isLast = kinds[kind] && !kinds[otherKind(kind)];
              return (
                <div key={kind} className="flex items-center gap-2">
                  <Checkbox
                    id={`risk-kind-${kind}`}
                    checked={kinds[kind]}
                    disabled={isLast}
                    onCheckedChange={(value) =>
                      setKinds((prev) => ({ ...prev, [kind]: value === true }))
                    }
                    data-testid={`risk-kind-${kind}`}
                  />
                  <Label
                    htmlFor={`risk-kind-${kind}`}
                    className="whitespace-nowrap"
                  >
                    {tCommon(labelKey)}
                  </Label>
                </div>
              );
            })}
          </div>
        </div>

        {allLoadedSelected && unloadedMatches > 0 && !allMatchesSelected && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"
            data-testid="risk-select-all-matches-prompt"
          >
            <span>{t("loadedSelected", { shown: rows.length })}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => void selectAllMatches()}
              disabled={allMatchingIds.isFetching}
              data-testid="risk-select-all-matches"
            >
              {t("selectAllMatches", { total: matchingTotal ?? 0 })}
            </Button>
          </div>
        )}

        {allMatchesSelected && (
          <p
            className="rounded-md bg-muted px-3 py-2 text-sm"
            data-testid="risk-all-matches-selected"
          >
            {t("allMatchesSelected", { total: matchingTotal ?? 0 })}
          </p>
        )}

        <div className="min-h-0 w-full flex-1">
          <DataTable<RiskCandidate>
            virtualized
            columns={columns}
            data={rows}
            getRowId={(row) => String(row.id)}
            rowTestIdPrefix="risk-candidate"
            rowSelection={rowSelection}
            onRowSelectionChange={setRowSelection}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={noopVisibilityChange}
            isLoading={isLoading || isFetchingNextPage}
            hasMore={!!hasNextPage}
            onLoadMore={fetchNextPage}
            estimateSize={ROW_HEIGHT}
            flexColumnId="case"
            resetKey={`${minScore}:${kinds.manual}:${kinds.automated}`}
            emptyMessage={t("noneMatch")}
            testIdPrefix="risk-candidates"
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleAccept}
            disabled={selectedIds.length === 0}
            data-testid="risk-accept"
          >
            {t("addCases", { count: selectedIds.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
