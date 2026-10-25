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
import { Loader2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RERANK_MAX_CANDIDATES } from "~/lib/schemas/riskRerank";
import { schema } from "~/zenstack/schema";
import { RiskScoreCell } from "./RiskScoreCell";

/** Rows fetched per page; the list loads more as it is scrolled. */
export const RISK_PAGE_SIZE = 50;
const SCORE_STEP = 5;
const ROW_HEIGHT = 52;

// Nothing here is hideable; the table still wants the visibility pair, and
// every column must be named in it or it is dropped from the render.
const noopVisibilityChange = () => {};

/** How often the dialog asks whether the re-rank has finished. */
const POLL_INTERVAL_MS = 2000;
/** Give up listening after this long; the job itself is unaffected. */
const MAX_POLL_ATTEMPTS = 90;

/** A model's answer, in the shape the table reads. */
export interface AppliedRanking {
  /** Case id -> its place in the new order. */
  order: Map<number, number>;
  /** Case id -> why it sits there, for the cases the model spoke about. */
  rationale: Map<number, string>;
  model: string | null;
  rankedCount: number;
}

/**
 * Re-orders what is loaded without touching what is loaded. Rows the ranking
 * does not mention keep their score order underneath it — pages fetched
 * after a re-rank land there too, rather than disappearing.
 */
export function applyRanking<T extends { id: number }>(
  rows: T[],
  ranking: AppliedRanking | null
): T[] {
  if (!ranking || ranking.order.size === 0) return rows;
  const place = (row: T) =>
    ranking.order.get(row.id) ?? Number.MAX_SAFE_INTEGER;
  return [...rows].sort((a, b) => place(a) - place(b));
}

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
  /**
   * What the run being composed is about. Supplying it offers the LLM
   * re-rank; null leaves the dialog on its deterministic order alone.
   */
  runContext?: {
    name: string;
    description: string | null;
    tags?: string[];
  } | null;
}

export function RiskDialog({
  open,
  onOpenChange,
  projectId,
  currentSelection,
  onAccept,
  runContext = null,
}: RiskDialogProps) {
  const t = useTranslations("runs.risk");
  const tCommon = useTranslations("common");
  const [minScore, setMinScore] = useState(0);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [ranking, setRanking] = useState<AppliedRanking | null>(null);
  const [reranking, setReranking] = useState(false);
  const jobRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const stopListening = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    jobRef.current = null;
    setReranking(false);
  }, []);

  // The threshold defines the candidate set, so changing it starts the
  // choice over: keeping ids from the old set would mean adding cases the
  // list no longer shows, and the counts would disagree about how many are
  // selected. A ranking of the old set is just as stale.
  useEffect(() => {
    setRowSelection({});
    setRanking(null);
    stopListening();
  }, [minScore, stopListening]);

  // Nothing outlives the dialog: a poll still running would keep asking
  // about a job nobody is waiting for.
  useEffect(() => {
    if (!open) stopListening();
    return stopListening;
  }, [open, stopListening]);

  const queries = useClientQueries(schema);

  const where = useMemo(
    () => ({
      projectId,
      isDeleted: false,
      isArchived: false,
      // `gte` also drops never-scored cases, which have nothing to rank by.
      riskScore: { gte: minScore },
      ...(currentSelection.length > 0
        ? { id: { notIn: currentSelection } }
        : {}),
    }),
    [projectId, minScore, currentSelection]
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

  /** Best-effort: a job already running cannot be stopped, only ignored. */
  const dropJob = useCallback(
    (jobId: string | null) => {
      if (!jobId) return;
      void fetch(`/api/projects/${projectId}/risk/rerank/cancel/${jobId}`, {
        method: "POST",
      }).catch(() => {});
    },
    [projectId]
  );

  const rerank = useCallback(async () => {
    // A second press before the first POST answers would queue a second job
    // and pay for a second model call; the button becomes Cancel either way.
    if (!runContext || rows.length === 0 || abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setReranking(true);
    try {
      // Deliberately NOT aborted with the controller: a submit cut off
      // mid-flight can still have queued a job, and without its id there is
      // nothing left to cancel. It finishes, then the check below cancels.
      const submit = await fetch(`/api/projects/${projectId}/risk/rerank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The list is score-ordered, so the head of what is loaded is
          // the top of the ranking. Over the cap the route answers 400, not
          // a trim, so the trimming happens here.
          caseIds: rows.slice(0, RERANK_MAX_CANDIDATES).map((row) => row.id),
          runContext: {
            name: runContext.name,
            description: runContext.description,
            tags: runContext.tags,
          },
        }),
      });
      if (submit.status === 409) {
        toast.error(t("rerank.noModel"));
        stopListening();
        return;
      }
      const submitted = await submit.json();
      if (!submit.ok) throw new Error(submitted.error ?? "submit failed");
      if (abortRef.current !== controller) {
        dropJob(submitted.jobId);
        return;
      }
      jobRef.current = submitted.jobId;

      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        if (controller.signal.aborted) return;
        const response = await fetch(
          `/api/projects/${projectId}/risk/rerank/status/${submitted.jobId}`,
          { signal: controller.signal }
        );
        const status = await response.json();
        if (!response.ok) throw new Error(status.error ?? "status failed");
        if (status.failed) throw new Error("rerank job failed");
        if (status.state !== "completed") continue;

        // `stopListening` drops this controller when the threshold changes
        // or the dialog closes. An answer that lands after that describes a
        // candidate set the user has already moved on from.
        if (abortRef.current !== controller) return;

        const outcome = status.result ?? {};
        if (outcome.skipped === "no_provider") {
          toast.error(t("rerank.noModel"));
        } else if (outcome.skipped === "unreadable") {
          toast.error(t("rerank.unreadable"));
        } else if (!outcome.ranked?.length) {
          toast.error(t("rerank.failed"));
        } else {
          const entries: { caseId: number; rationale: string }[] =
            outcome.ranked;
          setRanking({
            order: new Map(entries.map((e, index) => [e.caseId, index])),
            rationale: new Map(
              entries
                .filter((e) => e.rationale)
                .map((e) => [e.caseId, e.rationale])
            ),
            model: outcome.model ?? null,
            rankedCount: outcome.rankedCount ?? entries.length,
          });
          if (rows.length > RERANK_MAX_CANDIDATES) {
            toast.info(t("rerank.capped", { count: RERANK_MAX_CANDIDATES }));
          }
        }
        stopListening();
        return;
      }
      toast.error(t("rerank.timedOut"));
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        console.error("[risk-rerank]", error);
        toast.error(t("rerank.failed"));
      }
    } finally {
      if (abortRef.current === controller) stopListening();
    }
  }, [dropJob, projectId, rows, runContext, stopListening, t]);

  const cancelRerank = useCallback(() => {
    const jobId = jobRef.current;
    stopListening();
    dropJob(jobId);
  }, [dropJob, stopListening]);

  const orderedRows = useMemo(
    () => applyRanking(rows, ranking),
    [rows, ranking]
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
            {ranking?.rationale.get(row.original.id) && (
              <p
                className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground"
                data-testid={`risk-rationale-${row.original.id}`}
              >
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{ranking.rationale.get(row.original.id)}</span>
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
    [t, tCommon, projectId, ranking]
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

          {runContext && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (reranking ? cancelRerank() : void rerank())}
              disabled={!reranking && rows.length === 0}
              data-testid="risk-rerank"
            >
              {reranking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("rerank.cancel")}
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {t("rerank.action")}
                </>
              )}
            </Button>
          )}
        </div>

        {ranking && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm"
            data-testid="risk-rerank-applied"
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>
              {t("rerank.applied", { count: ranking.rankedCount })}
              {ranking.model ? ` · ${ranking.model}` : ""}
            </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setRanking(null)}
              data-testid="risk-rerank-restore"
            >
              {t("rerank.restore")}
            </Button>
          </div>
        )}

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
            data={orderedRows}
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
            resetKey={`${minScore}:${ranking ? "ranked" : "score"}`}
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
