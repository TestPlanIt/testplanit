"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateFormatter } from "@/components/DateFormatter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { ApplicationArea, RepositoryCaseSource } from "~/zenstack/models";
import { keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Bot, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePathname, useRouter } from "~/lib/navigation";

import { useProjectPermissions } from "~/hooks/useProjectPermissions";

import {
  extractCandidatesFromBuffer,
  extractSummaryFromBuffer,
  type PartialCandidate,
} from "./streamingParser";

/**
 * Inline report preset for the Automation Candidates report.
 *
 * Mirrors the contract of `MatrixReportPreset`: ReportRenderer early-returns
 * to render this component for the `automation-candidates` report type,
 * bypassing the standard chart/table pipeline. The component owns its own
 * data fetching, streaming, and Generate/History/Delete chrome; the
 * ReportBuilder shell still owns title / save / share + the report-type
 * picker around it.
 *
 * Why not the DataTable pipeline: the snapshot output is a ranked list with
 * per-row rationale, not a dimension-by-metric aggregation. Each row needs
 * the rationale rendered alongside the rank/score. And the action chrome
 * (Generate, History picker, Delete) is specific to snapshot-style reports
 * — fitting it into the shared shell would require widening the shell with
 * conditionals for every snapshot-style report we add. Mirroring matrix's
 * preset pattern keeps the shared shell tight.
 */

const REPORT_TYPE = "automation_candidates";

interface CandidateMetrics {
  executionCount: number;
  estimateSeconds: number | null;
  flakinessScore: number | null;
  createdAtIso: string;
}

interface SnapshotOutput {
  candidates: Array<{
    caseId: number;
    rank: number;
    score: number;
    rationale: string;
    /** Concrete metrics that drove this case's ranking — used in the UI
     *  to surface the strategy-specific number next to each row. May
     *  be absent on snapshots generated before this field was added. */
    metrics?: CandidateMetrics;
    /** Case name frozen at generation time. Lets anonymous viewers of a
     *  public Share Link see a human-readable label without an
     *  authenticated case-metadata fetch. Absent on pre-rollout
     *  snapshots — the renderer falls back to "Test Case #N". */
    name?: string;
  }>;
  summary: string;
  totalManualCases: number;
  rankedCount: number;
  truncated: boolean;
  truncatedSentCount?: number;
  /** Which strategy picked the input set. Recorded per snapshot so
   *  viewers can see "ranked via Most Executed" even if the project
   *  default changes later. */
  selectionStrategy?: string;
  /** "heuristic" when the project had no active LLM at generate time
   *  and the ranking was built from the strategy's metric directly.
   *  Surfaced as a badge so viewers don't mistake it for AI reasoning. */
  generationMode?: "llm" | "heuristic";
}

interface SnapshotRow {
  id: number;
  status: string;
  startedAt: Date | string;
  completedAt: Date | string | null;
  errorMessage: string | null;
  output: unknown;
  generatedBy: { id: string; name: string | null; email: string };
}

export interface AutomationCandidatesReportPresetProps {
  projectId: number;
  /** Header actions from the ReportBuilder shell (Share, Save, etc.). */
  headerActions?: React.ReactNode;
  /** Shared-link viewer mode: hide Generate / Delete actions. */
  readOnly?: boolean;
  /**
   * Snapshot pre-fetched by the public-share endpoint. When set, the preset
   * skips its history hook (which requires authenticated project read) and
   * renders just this snapshot. Mirrors `MatrixReportPreset`'s
   * `prefetchedAxes`. `null` means the project has no completed snapshots
   * yet — render the empty state.
   */
  prefetchedSnapshot?: SnapshotRow | null;
}

export function AutomationCandidatesReportPreset({
  projectId,
  headerActions,
  readOnly = false,
  prefetchedSnapshot,
}: AutomationCandidatesReportPresetProps) {
  // When the share endpoint pre-fetches a snapshot, it's the only thing
  // this component renders — no history list, no permission check, no
  // generate/delete chrome. Mirrors `MatrixReportPreset`'s `prefetchedAxes`
  // / `useMatrixAggregation` skip.
  const isPrefetched = prefetchedSnapshot !== undefined;
  const t = useTranslations("reports.ui.automationCandidates");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const { permissions } = useProjectPermissions(
    projectId,
    ApplicationArea.Reporting
  );
  const canAddEdit = !readOnly && permissions?.canAddEdit === true;
  const canDelete = !readOnly && permissions?.canDelete === true;

  const {
    data: history,
    isLoading: historyLoadingRaw,
    refetch: refetchHistory,
  } = useClientQueries(schema).llmReportSnapshot.useFindMany(
    {
      where: {
        projectId,
        reportType: REPORT_TYPE,
        isDeleted: false,
        // Failed runs are soft-deleted at write time (see route's
        // persistFailure); the dropdown should only show snapshots
        // worth viewing — completed rankings + any in-progress run.
        status: { in: ["complete", "running"] },
      },
      orderBy: { startedAt: "desc" },
      include: {
        generatedBy: { select: { id: true, name: true, email: true } },
      },
    },
    // Skip the authed history fetch entirely when the snapshot was
    // pre-fetched server-side — that's exactly the path the public-share
    // viewer takes, and the consumer has no session to authorize the
    // query.
    { enabled: !isPrefetched }
  );

  const historyLoading = isPrefetched ? false : historyLoadingRaw;

  const snapshots: SnapshotRow[] = useMemo(() => {
    if (isPrefetched) {
      // The share endpoint sends one snapshot or `null` (no completed
      // snapshots yet). Normalize to an array so the rest of the
      // component code paths are unchanged.
      return prefetchedSnapshot ? [prefetchedSnapshot] : [];
    }
    return (history ?? []) as unknown as SnapshotRow[];
  }, [history, isPrefetched, prefetchedSnapshot]);

  // Snapshot selection is URL state (`?snapshotId=N`) so a share captures
  // the snapshot the user is actually looking at, not whichever one happens
  // to be latest by the time someone opens the link. Local state mirrors
  // the URL for fast re-renders; writes go through router.replace.
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlSnapshotIdRaw = searchParams.get("snapshotId");
  const urlSnapshotId = urlSnapshotIdRaw
    ? Number.parseInt(urlSnapshotIdRaw, 10)
    : null;
  const [selectedSnapshotId, setSelectedSnapshotIdState] = useState<
    number | null
  >(urlSnapshotId && Number.isInteger(urlSnapshotId) ? urlSnapshotId : null);

  // When the prefetched-share viewer is active, the URL is the share URL —
  // we don't push our internal snapshot-id query into it. In every other
  // mode, mirror selection to the URL so it survives copy-paste + sharing.
  const setSelectedSnapshotId = useCallback(
    (id: number | null) => {
      setSelectedSnapshotIdState(id);
      if (isPrefetched) return;
      const params = new URLSearchParams(searchParams.toString());
      if (id == null) params.delete("snapshotId");
      else params.set("snapshotId", String(id));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    },
    [isPrefetched, pathname, router, searchParams]
  );

  // Default to the newest snapshot whenever the list changes — flips to a
  // freshly generated one without the user having to do anything.
  //
  // IMPORTANT: this auto-default updates LOCAL state only and must NOT write the
  // URL. This effect fires on mount, and when the preset mounts as part of
  // switching to the Reports tab (automation-candidates is the first pre-built
  // report), an automatic router.replace built from the still-stale searchParams
  // overwrites the in-flight tab/reportType navigation — bouncing the user back
  // to Report Builder and leaving a stray ?snapshotId. Explicit snapshot
  // selection (the dropdown) still goes through setSelectedSnapshotId and writes
  // the URL for share fidelity; an un-pinned auto-default resolves to "latest"
  // anyway, which is exactly the newest snapshot selected here.
  useEffect(() => {
    if (snapshots.length === 0) {
      if (selectedSnapshotId !== null) setSelectedSnapshotIdState(null);
      return;
    }
    if (
      selectedSnapshotId === null ||
      !snapshots.some((s) => s.id === selectedSnapshotId)
    ) {
      setSelectedSnapshotIdState(snapshots[0]!.id);
    }
  }, [snapshots, selectedSnapshotId]);

  const selectedSnapshot = snapshots.find((s) => s.id === selectedSnapshotId);

  // --- Generation (streaming) -----------------------------------------

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<{
    code?: string;
    message: string;
    rawOutputPreview?: string;
  } | null>(null);
  const [liveCandidates, setLiveCandidates] = useState<PartialCandidate[]>([]);
  const [liveSummary, setLiveSummary] = useState<string | null>(null);
  const [liveMetadata, setLiveMetadata] = useState<{
    totalManualCases: number;
    rankedCount: number;
    truncated: boolean;
    selectionStrategy?: string;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startGenerate = useCallback(
    async (opts?: { maxCases?: number; selectionStrategy?: string }) => {
      setGenerating(true);
      setGenError(null);
      setLiveCandidates([]);
      setLiveSummary(null);
      setLiveMetadata(null);

      const controller = new AbortController();
      abortRef.current = controller;

      let response: Response;
      try {
        response = await fetch("/api/reports/automation-candidates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            ...(typeof opts?.maxCases === "number"
              ? { maxCases: opts.maxCases }
              : {}),
            ...(typeof opts?.selectionStrategy === "string"
              ? { selectionStrategy: opts.selectionStrategy }
              : {}),
          }),
          signal: controller.signal,
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setGenError({
            message: err instanceof Error ? err.message : String(err),
          });
        }
        setGenerating(false);
        return;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/event-stream")) {
        let body: { error?: string; code?: string } | null = null;
        try {
          body = (await response.json()) as { error?: string; code?: string };
        } catch {
          body = null;
        }
        setGenError({
          code: body?.code,
          message: body?.error ?? t("errors.generateFailed"),
        });
        setGenerating(false);
        return;
      }

      if (!response.body) {
        setGenError({ message: t("errors.generateFailed") });
        setGenerating(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let llmBuffer = "";

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          const events = textBuffer.split("\n\n");
          textBuffer = events.pop() ?? "";

          for (const evt of events) {
            for (const line of evt.split("\n")) {
              const trimmed = line.trimStart();
              if (!trimmed.startsWith("data:")) continue;
              const json = trimmed.slice("data:".length).trim();
              if (!json) continue;
              let payload: Record<string, unknown>;
              try {
                payload = JSON.parse(json) as Record<string, unknown>;
              } catch {
                continue;
              }
              const type = payload.type;
              if (type === "metadata") {
                setLiveMetadata({
                  totalManualCases: Number(payload.totalManualCases),
                  rankedCount: Number(payload.rankedCount),
                  truncated: Boolean(payload.truncated),
                  selectionStrategy:
                    typeof payload.selectionStrategy === "string"
                      ? payload.selectionStrategy
                      : undefined,
                });
              } else if (type === "chunk") {
                const delta =
                  typeof payload.delta === "string" ? payload.delta : "";
                if (delta) {
                  llmBuffer += delta;
                  const parsed = extractCandidatesFromBuffer(llmBuffer).sort(
                    (a, b) => a.rank - b.rank
                  );
                  setLiveCandidates(parsed);
                  const summary = extractSummaryFromBuffer(llmBuffer);
                  if (summary != null) setLiveSummary(summary);
                }
              } else if (type === "done") {
                await refetchHistory();
                await queryClient.invalidateQueries({
                  queryKey: ["zenstack", "LlmReportSnapshot"],
                });
                // Force-select the snapshot we just generated. The
                // "newest snapshot wins" effect lower down only fires
                // when the prior selection has been removed from the
                // list — after a fresh generation the old selection is
                // still there at index 1, so without this nudge the
                // viewer would keep staring at the previous run.
                if (typeof payload.snapshotId === "number") {
                  setSelectedSnapshotId(payload.snapshotId);
                }
              } else if (type === "error") {
                setGenError({
                  code:
                    typeof payload.code === "string" ? payload.code : undefined,
                  message:
                    typeof payload.message === "string"
                      ? payload.message
                      : t("errors.generateFailed"),
                  rawOutputPreview:
                    typeof payload.rawOutputPreview === "string"
                      ? payload.rawOutputPreview
                      : undefined,
                });
              }
            }
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setGenError({
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        setGenerating(false);
        abortRef.current = null;
      }
    },
    [projectId, refetchHistory, queryClient, setSelectedSnapshotId, t]
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // The preset's Run trigger lives in ReportBuilder's left-panel Run Report
  // button (keeps one mental model: pick a report, configure it, click Run
  // Report). ReportBuilder dispatches a CustomEvent on click; we listen.
  // Loose coupling vs. a context + ref — this preset doesn't need any other
  // bidirectional state with the shell, so a window event keeps the
  // dependency surface tiny and matches the matrix preset's "self-contained"
  // philosophy.
  useEffect(() => {
    if (!canAddEdit) return;
    const handler = (e: Event) => {
      if (generating) return;
      const detail = (
        e as CustomEvent<{ maxCases?: number; selectionStrategy?: string }>
      ).detail;
      void startGenerate({
        maxCases:
          typeof detail?.maxCases === "number" ? detail.maxCases : undefined,
        selectionStrategy:
          typeof detail?.selectionStrategy === "string"
            ? detail.selectionStrategy
            : undefined,
      });
    };
    window.addEventListener("automation-candidates:run", handler);
    return () =>
      window.removeEventListener("automation-candidates:run", handler);
  }, [canAddEdit, generating, startGenerate]);

  // --- Delete ---------------------------------------------------------

  const [deleteTargetId, setDeleteTargetId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const onDeleteConfirm = useCallback(async () => {
    if (deleteTargetId == null) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(
        `/api/reports/automation-candidates/${deleteTargetId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? t("errors.deleteFailed"));
      }
      await refetchHistory();
      await queryClient.invalidateQueries({
        queryKey: ["zenstack", "LlmReportSnapshot"],
      });
      setDeleteTargetId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  }, [deleteTargetId, refetchHistory, queryClient, t]);

  // --- Derived render data --------------------------------------------

  const renderedCandidates = generating
    ? liveCandidates
    : selectedSnapshot?.status === "complete" && selectedSnapshot.output != null
      ? (selectedSnapshot.output as unknown as SnapshotOutput).candidates
      : [];

  const renderedSummary = generating
    ? liveSummary
    : selectedSnapshot?.status === "complete" && selectedSnapshot.output != null
      ? (selectedSnapshot.output as unknown as SnapshotOutput).summary
      : null;

  const isInitialEmpty =
    !historyLoading && snapshots.length === 0 && !generating && !genError;

  // Generation is triggered by ReportBuilder's left-panel Run Report button
  // (see CustomEvent wiring above), so the preset's own top bar only holds
  // history selection + the shell's headerActions. We render it only when
  // there's something to show: more than one snapshot OR shell actions.
  const showTopBar = snapshots.length > 1 || headerActions;

  return (
    <div className="flex flex-col" data-testid="automation-candidates-preset">
      {showTopBar && (
        <div className="flex items-center justify-end gap-2 border-b p-2">
          {snapshots.length > 1 && (
            <Select
              value={selectedSnapshotId ? String(selectedSnapshotId) : ""}
              onValueChange={(v) => setSelectedSnapshotId(parseInt(v, 10))}
              disabled={generating}
            >
              <SelectTrigger
                className="w-auto max-w-2xl [&>span]:truncate"
                data-testid="automation-candidates-history-select"
              >
                <SelectValue placeholder={t("historyPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {snapshots.map((snap) => (
                  <SelectItem key={snap.id} value={String(snap.id)}>
                    <SnapshotLabel snap={snap} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {headerActions}
        </div>
      )}

      <div className="flex flex-col gap-4 p-4">
        <ReportHeader
          snapshot={generating ? null : (selectedSnapshot ?? null)}
          strategy={
            generating
              ? (liveMetadata?.selectionStrategy ?? null)
              : selectedSnapshot?.status === "complete" &&
                  selectedSnapshot.output != null
                ? ((selectedSnapshot.output as unknown as SnapshotOutput)
                    .selectionStrategy ?? null)
                : null
          }
        />
        {historyLoading && (
          <div
            className="flex items-center justify-center gap-2 py-12 text-muted-foreground"
            data-testid="automation-candidates-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {tCommon("loading")}
          </div>
        )}

        {genError && (
          <Card className="border-destructive/40">
            <CardContent className="pt-6 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1 flex-1 min-w-0">
                <p className="font-medium">{t("errors.title")}</p>
                <p className="text-sm text-muted-foreground">
                  {genError.message}
                </p>
                {genError.rawOutputPreview && (
                  <pre className="mt-2 max-h-64 overflow-auto rounded border bg-muted/50 p-2 text-xs whitespace-pre-wrap break-all">
                    {genError.rawOutputPreview}
                  </pre>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {isInitialEmpty && (
          <Card>
            <CardContent className="pt-6 text-center space-y-4">
              <Bot className="h-10 w-10 mx-auto text-muted-foreground/60" />
              <div>
                <p className="font-medium">{t("emptyState.title")}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {canAddEdit
                    ? t("emptyState.canGenerate")
                    : t("emptyState.noPermission")}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {selectedSnapshot && !generating && (
          <SnapshotMetaBar
            snapshot={selectedSnapshot}
            canDelete={canDelete}
            onDeleteRequest={() => setDeleteTargetId(selectedSnapshot.id)}
          />
        )}

        {(generating ||
          (selectedSnapshot?.status === "complete" &&
            renderedCandidates.length > 0)) && (
          <RankedList
            projectId={projectId}
            candidates={renderedCandidates}
            generating={generating}
            liveMetadata={liveMetadata}
            selectionStrategy={
              // While a generation is streaming, the live metadata frame
              // carries the strategy; otherwise read it off the selected
              // snapshot's persisted output.
              generating
                ? (liveMetadata?.selectionStrategy ?? null)
                : selectedSnapshot?.status === "complete" &&
                    selectedSnapshot.output != null
                  ? ((selectedSnapshot.output as unknown as SnapshotOutput)
                      .selectionStrategy ?? null)
                  : null
            }
          />
        )}

        {renderedSummary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("summaryHeading")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-line">{renderedSummary}</p>
            </CardContent>
          </Card>
        )}

        {selectedSnapshot?.status === "failed" && !generating && (
          <Card className="border-destructive/40">
            <CardContent className="pt-6 space-y-2">
              <p className="font-medium">{t("errors.snapshotFailed")}</p>
              <p className="text-sm text-muted-foreground">
                {selectedSnapshot.errorMessage ?? t("errors.generateFailed")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog
        open={deleteTargetId != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTargetId(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("delete.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void onDeleteConfirm();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {t("delete.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SnapshotLabel({ snap }: { snap: SnapshotRow }) {
  const t = useTranslations("reports.ui.automationCandidates");
  // Match the viewer's preferred date+time format so dropdown entries
  // and the meta bar render identically.
  const { data: session } = useSession();
  const dateTimeFormat = session?.user?.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : undefined;
  // Same title resolution as the report header, so a dropdown entry
  // reads like "Automation Candidates ranked by Most Executed (highest
  // ROI) — Jun 1, 2026 5:38 PM". Failed snapshots are already filtered
  // out of the list, so the only non-default status that can appear
  // here is "running".
  const output =
    snap.status === "complete" && snap.output != null
      ? (snap.output as unknown as SnapshotOutput)
      : null;
  const strategy = output?.selectionStrategy ?? null;
  const title = strategy
    ? t("titleWithStrategy", {
        strategy: t(
          `strategies.${strategy}` as
            | "strategies.most_executed"
            | "strategies.flakiest_first"
            | "strategies.longest_first"
            | "strategies.oldest_first"
            | "strategies.newest_first"
            | "strategies.random"
        ),
      })
    : t("title");
  return (
    <span className="flex items-center gap-2">
      {/* tooltip=false: the dropdown items are inside Radix's Select
          surface, which suppresses hover, so the default tooltip never
          shows anyway and is just noise to the a11y tree. */}
      <span className="truncate">{title}</span>
      <span className="text-muted-foreground">{"—"}</span>
      <DateFormatter
        date={snap.startedAt}
        formatString={dateTimeFormat}
        tooltip={false}
      />
      {snap.status !== "complete" && (
        <Badge variant={statusVariant(snap.status)} className="capitalize">
          {statusLabel(t, snap.status)}
        </Badge>
      )}
    </span>
  );
}

/** Map a snapshot status string to its translated label. Written as an
 *  explicit switch (no template-literal key) so multi-namespace
 *  `useTranslations()` files don't trip next-intl's local TS2554
 *  false-positive on `t(\`status.${x}\`)`. */
function statusLabel(
  t: ReturnType<typeof useTranslations<"reports.ui.automationCandidates">>,
  status: string
): string {
  switch (status) {
    case "complete":
      return t("status.complete");
    case "failed":
      return t("status.failed");
    case "running":
      return t("status.running");
    default:
      return status;
  }
}

/**
 * Renders the concrete metric value behind a candidate's ranking, picked
 * by the active selection strategy. So when the user sees "#3 Login flow",
 * they can also see "47 runs" (most_executed), "18m forecast"
 * (longest_first), "Flips 42%" (flakiest_first), or "Created 2023-03-12"
 * (oldest_first / newest_first). `random` shows nothing — the strategy
 * itself has no signal to display.
 */
/**
 * Top-of-report header. Reads "Automation Candidates" when no snapshot
 * is selected, or "Automation Candidates ranked by Most Executed" once
 * a snapshot's strategy is known — telling the user up front the lens
 * the ranking was generated through.
 */
function ReportHeader({
  strategy,
  snapshot,
}: {
  strategy: string | null;
  /** When a snapshot is being viewed, its status + heuristic flag are
   *  rendered as right-justified chips on the title row. Null while
   *  there's no snapshot yet (empty state) or during a fresh generation. */
  snapshot?: SnapshotRow | null;
}) {
  const t = useTranslations("reports.ui.automationCandidates");
  const title = strategy
    ? t("titleWithStrategy", {
        strategy: t(
          `strategies.${strategy}` as
            | "strategies.most_executed"
            | "strategies.flakiest_first"
            | "strategies.longest_first"
            | "strategies.oldest_first"
            | "strategies.newest_first"
            | "strategies.random"
        ),
      })
    : t("title");
  const output =
    snapshot && snapshot.status === "complete" && snapshot.output != null
      ? (snapshot.output as unknown as SnapshotOutput)
      : null;
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {snapshot && (
        <div className="flex items-center gap-2 shrink-0">
          {/* Complete is the expected steady state — surfacing a chip
              for it just adds visual noise. Only the non-default
              statuses get a badge. */}
          {snapshot.status !== "complete" && (
            <Badge
              variant={statusVariant(snapshot.status)}
              className="capitalize"
            >
              {statusLabel(t, snapshot.status)}
            </Badge>
          )}
          {output?.generationMode === "heuristic" && (
            <Badge
              variant="secondary"
              title={t("heuristicBadgeTooltip")}
              data-testid="automation-candidates-heuristic-badge"
            >
              {t("heuristicBadge")}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function StrategyMetric({
  strategy,
  metrics,
}: {
  strategy: string;
  metrics: CandidateMetrics;
}) {
  const t = useTranslations("reports.ui.automationCandidates.metric");
  // Created date for the date-based strategies renders through
  // DateFormatter so it picks up the viewer's preferred date format
  // (same path as the Generated date on the meta bar).
  const { data: session } = useSession();
  const userDateFormat = session?.user?.preferences?.dateFormat;
  switch (strategy) {
    case "most_executed":
      return (
        <span data-testid="automation-candidate-metric">
          {t("executions", { count: String(metrics.executionCount) })}
        </span>
      );
    case "longest_first":
      return (
        <span data-testid="automation-candidate-metric">
          {metrics.estimateSeconds != null
            ? t("forecast", {
                value: formatDuration(metrics.estimateSeconds),
              })
            : t("forecastUnset")}
        </span>
      );
    case "flakiest_first":
      return (
        <span data-testid="automation-candidate-metric">
          {metrics.flakinessScore != null
            ? t("flakiness", {
                value: String(Math.round(metrics.flakinessScore * 100)),
              })
            : t("flakinessUnset")}
        </span>
      );
    case "oldest_first":
    case "newest_first":
      return (
        <span
          data-testid="automation-candidate-metric"
          className="inline-flex items-center gap-1"
        >
          {t("createdLabel")}{" "}
          <DateFormatter
            date={metrics.createdAtIso}
            formatString={userDateFormat}
            tooltip={false}
          />
        </span>
      );
    default:
      return null;
  }
}

/** Format seconds into a compact human-friendly duration string. Picks
 *  the largest sensible unit so the chip stays narrow: 45 → "45s",
 *  120 → "2m", 3600 → "1h", 5400 → "1h 30m", 86400 → "24h". */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin === 0 ? `${hours}h` : `${hours}h ${remMin}m`;
}

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "complete":
      return "default";
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
    default:
      return "outline";
  }
}

function SnapshotMetaBar({
  snapshot,
  canDelete,
  onDeleteRequest,
}: {
  snapshot: SnapshotRow;
  canDelete: boolean;
  onDeleteRequest: () => void;
}) {
  const t = useTranslations("reports.ui.automationCandidates");
  // Display "Generated …" in the viewer's preferred date+time format
  // rather than DateFormatter's MM-dd-yyyy fallback, matching how other
  // surfaces (datasets-list, webhook-deliveries, etc.) read it.
  const { data: session } = useSession();
  const dateTimeFormat = session?.user?.preferences?.dateFormat
    ? `${session.user.preferences.dateFormat} ${session.user.preferences.timeFormat || "HH:mm"}`
    : undefined;
  const output =
    snapshot.status === "complete" && snapshot.output != null
      ? (snapshot.output as unknown as SnapshotOutput)
      : null;
  const strategyLabel = output?.selectionStrategy
    ? t(
        `strategies.${output.selectionStrategy}` as
          | "strategies.most_executed"
          | "strategies.flakiest_first"
          | "strategies.longest_first"
          | "strategies.oldest_first"
          | "strategies.newest_first"
          | "strategies.random"
      )
    : "";
  const sourceLine = output
    ? output.truncated
      ? t("sourcedFromNewestN", {
          ranked: String(output.rankedCount),
          total: String(output.totalManualCases),
          strategy: strategyLabel,
        })
      : t("sourcedFromAll", {
          total: String(output.totalManualCases),
          strategy: strategyLabel,
        })
    : null;
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap text-sm text-muted-foreground">
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
        <span>
          {t("generatedAt")}{" "}
          <DateFormatter
            date={snapshot.startedAt}
            formatString={dateTimeFormat}
          />
          {snapshot.generatedBy?.name
            ? ` ${t("by")} ${snapshot.generatedBy.name}`
            : null}
        </span>
        {sourceLine && <span className="text-xs italic">{sourceLine}</span>}
      </div>
      {canDelete && (
        <Button
          variant="destructive"
          size="sm"
          onClick={onDeleteRequest}
          data-testid="automation-candidates-delete"
        >
          <Trash2 className="h-4 w-4" />
          {t("delete.button")}
        </Button>
      )}
    </div>
  );
}

function RankedList({
  projectId,
  candidates,
  generating,
  liveMetadata,
  selectionStrategy,
}: {
  projectId: number;
  candidates: Array<{
    caseId: number;
    rank: number;
    score: number;
    rationale: string;
    metrics?: CandidateMetrics;
    /** Case name frozen at generation time. Absent during live stream
     *  (the chunks only carry rank/score/rationale) and on pre-rollout
     *  snapshots — both fall through to the live ZenStack fetch and
     *  then to the "Test Case #N" fallback. */
    name?: string;
  }>;
  generating: boolean;
  liveMetadata: {
    totalManualCases: number;
    rankedCount: number;
    truncated: boolean;
  } | null;
  selectionStrategy: string | null;
}) {
  const t = useTranslations("reports.ui.automationCandidates");
  // Fetch the case metadata we need to render CaseDisplay for every
  // ranked entry: name, source, automated, hasParameters, isDeleted.
  // The ranked-list output only carries caseId/rank/score/rationale, so
  // the metadata lookup is a separate read. This is a live read (the case
  // may have been renamed since the snapshot was generated) — the
  // snapshot stores the ranking, the cases keep their own state.
  const caseIds = useMemo(() => candidates.map((c) => c.caseId), [candidates]);
  const { data: caseRecords } = useClientQueries(
    schema
  ).repositoryCases.useFindMany(
    {
      where: { id: { in: caseIds }, projectId },
      select: {
        id: true,
        name: true,
        source: true,
        automated: true,
        hasParameters: true,
        isDeleted: true,
      },
    },
    {
      enabled: caseIds.length > 0,
      // While the live stream is appending new candidates, the `id IN […]`
      // set grows on every chunk and the query refetches. Without
      // `placeholderData`, prior data flashes to undefined during each
      // refetch, the case map empties, and every already-rendered row
      // visibly degrades from "Login flow" back to "Test Case #N" before
      // the new data lands — that's the flicker. Holding the previous
      // result during refetch keeps the existing rows stable; the new
      // row paints once with its name when the refetch completes.
      placeholderData: keepPreviousData,
    }
  );
  const caseById = useMemo(() => {
    const map = new Map<
      number,
      {
        id: number;
        name: string;
        source: RepositoryCaseSource;
        automated: boolean;
        hasParameters: boolean;
        isDeleted: boolean;
      }
    >();
    // The ZenStack hook's data type widens to include the placeholderData
    // helper's function form; cast through `unknown` so the for-of can
    // iterate the actual array shape at runtime.
    const records = (caseRecords ?? []) as unknown as Array<{
      id: number;
      name: string;
      source: RepositoryCaseSource;
      automated: boolean;
      hasParameters: boolean;
      isDeleted: boolean;
    }>;
    for (const c of records) {
      map.set(c.id, {
        id: c.id,
        name: c.name,
        source: c.source,
        automated: c.automated,
        hasParameters: c.hasParameters,
        isDeleted: c.isDeleted,
      });
    }
    return map;
  }, [caseRecords]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between gap-2">
          <span>{t("rankedList.heading")}</span>
          {generating && (
            <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {liveMetadata
                ? t("rankedList.streamingWithCount", {
                    count: String(candidates.length),
                    total: String(liveMetadata.rankedCount),
                  })
                : t("rankedList.streaming")}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("rankedList.empty")}
          </p>
        ) : (
          <ol className="space-y-3" data-testid="automation-candidates-list">
            {candidates.map((c) => {
              const meta = caseById.get(c.caseId);
              return (
                <li
                  key={c.caseId}
                  className="grid grid-cols-[auto_1fr_auto] gap-3 items-start border rounded-md p-3"
                  data-testid={`automation-candidate-${c.caseId}`}
                >
                  <div className="text-sm font-mono text-muted-foreground w-8 text-end shrink-0 pt-0.5">
                    {`#${c.rank}`}
                  </div>
                  <div className="min-w-0 space-y-1">
                    {meta ? (
                      <CaseDisplay
                        id={meta.id}
                        name={meta.name}
                        source={meta.source}
                        automated={meta.automated}
                        hasParameters={meta.hasParameters}
                        isDeleted={meta.isDeleted}
                        link={`/projects/repository/${projectId}/${meta.id}`}
                        size="medium"
                        maxLines={2}
                      />
                    ) : c.name ? (
                      // No live case metadata (anonymous viewer of a public
                      // Share Link), but the snapshot froze the name at
                      // generation time. Render that without the source /
                      // automated / parameter chips, which come from live
                      // case state we don't have here.
                      <span className="font-medium">{c.name}</span>
                    ) : (
                      <span className="font-medium">
                        {t("rankedList.caseRef", { id: String(c.caseId) })}
                      </span>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {c.rationale}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 max-w-[140px] text-xs text-end pt-0.5 break-words [&_*]:whitespace-normal">
                    <Badge variant="default">
                      {t("rankedList.score", {
                        score: String(Math.round(c.score)),
                      })}
                    </Badge>
                    {selectionStrategy && c.metrics && (
                      <StrategyMetric
                        strategy={selectionStrategy}
                        metrics={c.metrics}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
