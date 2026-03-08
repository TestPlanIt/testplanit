"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Sparkles,
  Loader2,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  ListTree,
  PlayCircle,
  Compass,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { invalidateModelQueries } from "~/utils/optimistic-updates";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/tables/DataTable";
import type { EntityType } from "~/lib/llm/services/auto-tag/types";
import { useAutoTagJob } from "./useAutoTagJob";
import { TagChip } from "./TagChip";
import type { AutoTagSuggestionEntity, UseAutoTagJobReturn } from "./types";

type WizardStep = "configure" | "analyzing" | "review";

function EntityJobStatus({
  icon: Icon,
  label,
  count,
  job,
  t,
}: {
  icon: typeof ListTree;
  label: string;
  count: number;
  job: UseAutoTagJobReturn;
  t: (key: string) => string;
}) {
  const isActive = job.status === "waiting" || job.status === "active";
  const isDone = job.status === "completed";
  const isFailed = job.status === "failed";

  const analyzed = job.progress?.analyzed ?? 0;
  const total = job.progress?.total ?? count;
  const isFinalizing = isActive && job.progress?.finalizing;

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {isActive && <Loader2 className="h-3 w-3 animate-spin" />}
      {isDone && <CheckCircle2 className="h-3 w-3 text-success" />}
      {isFailed && <XCircle className="h-3 w-3 text-destructive" />}
      {!isActive && !isDone && !isFailed && <div className="h-3 w-3" />}
      <Icon className="h-3 w-3" />
      <span>
        {label} ({analyzed}/{total})
        {isFinalizing && (
          <span className="ml-1 italic">{` — ${t("progress.finalizing")}`}</span>
        )}
      </span>
    </div>
  );
}

const ENTITY_TYPE_ICONS: Record<EntityType, typeof ListTree> = {
  repositoryCase: ListTree,
  testRun: PlayCircle,
  session: Compass,
};

/** DataTable-compatible row for the review step */
interface AutoTagReviewRow {
  id: string;
  name: string;
  entityId: number;
  entityType: EntityType;
  tags: AutoTagSuggestionEntity["tags"];
  currentTags: string[];
}

interface AutoTagWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  caseIds: number[];
  sessionIds: number[];
  runIds: number[];
}

export function AutoTagWizardDialog({
  open,
  onOpenChange,
  projectId,
  caseIds,
  sessionIds,
  runIds,
}: AutoTagWizardDialogProps) {
  const t = useTranslations("autoTag");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>("configure");

  // Entity type inclusion toggles
  const [includeCases, setIncludeCases] = useState(true);
  const [includeRuns, setIncludeRuns] = useState(true);
  const [includeSessions, setIncludeSessions] = useState(true);

  // Reset toggles when dialog opens
  useEffect(() => {
    if (open) {
      setIncludeCases(true);
      setIncludeRuns(true);
      setIncludeSessions(true);
    }
  }, [open]);

  const selectedTotal =
    (includeCases ? caseIds.length : 0) +
    (includeRuns ? runIds.length : 0) +
    (includeSessions ? sessionIds.length : 0);

  // One hook per entity type (API constraint: single entityType per job)
  const autoTagCases = useAutoTagJob(`autoTagJob:repositoryCase:${projectId}`);
  const autoTagSessions = useAutoTagJob(`autoTagJob:session:${projectId}`);
  const autoTagRuns = useAutoTagJob(`autoTagJob:testRun:${projectId}`);

  const allJobs = useMemo(
    () => [autoTagCases, autoTagSessions, autoTagRuns] as const,
    [autoTagCases, autoTagSessions, autoTagRuns]
  );

  // Aggregate progress across all jobs using the known entity counts as total
  // so the progress bar doesn't reset between entity types
  const aggregateProgress = useMemo(() => {
    let analyzed = 0;
    for (const job of allJobs) {
      if (job.progress) {
        analyzed += job.progress.analyzed;
      }
    }
    return { analyzed, total: selectedTotal };
  }, [allJobs, selectedTotal]);

  const anyFailed = allJobs.some((j) => j.status === "failed");
  const anyActive = allJobs.some(
    (j) => j.status === "waiting" || j.status === "active"
  );
  // Show "Preparing results..." when analysis is done but jobs haven't completed yet.
  // Check each active job individually: if its own progress shows analyzed >= total, it's finalizing.
  const anyFinalizing = anyActive && allJobs.some((j) => {
    if (j.status !== "active" && j.status !== "waiting") return false;
    if (j.progress?.finalizing) return true;
    if (j.progress && j.progress.total > 0 && j.progress.analyzed >= j.progress.total) return true;
    return false;
  });
  const failedError = allJobs.find((j) => j.status === "failed")?.error;
  // Collect batch-level errors from completed jobs (e.g. LLM config issues)
  const batchErrors = allJobs
    .filter((j) => j.status === "completed" && j.error)
    .map((j) => j.error!)
    .filter((e, i, arr) => arr.indexOf(e) === i); // dedupe

  // Merge suggestions from all completed jobs
  const allSuggestions = useMemo(() => {
    return allJobs.flatMap((j) => j.suggestions ?? []);
  }, [allJobs]);

  // Transition to review when all jobs complete (or fail)
  const allDone = allJobs.every(
    (j) => j.status === "completed" || j.status === "failed" || j.status === "idle"
  );
  useEffect(() => {
    if (step === "analyzing" && !anyActive && allDone) {
      setStep("review");
    }
  }, [step, anyActive, allDone]);

  // Restore step from persisted jobs on open
  useEffect(() => {
    if (!open) return;
    if (anyActive) {
      setStep("analyzing");
    } else if (allSuggestions.length > 0) {
      setStep("review");
    } else {
      setStep("configure");
    }
  }, [open]);

  // ── Actions ────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    setStep("analyzing");
    const projectIdNum = Number(projectId);
    const promises: Promise<void>[] = [];
    if (includeCases && caseIds.length > 0) {
      promises.push(
        autoTagCases.submit(caseIds, "repositoryCase", projectIdNum)
      );
    }
    if (includeSessions && sessionIds.length > 0) {
      promises.push(
        autoTagSessions.submit(sessionIds, "session", projectIdNum)
      );
    }
    if (includeRuns && runIds.length > 0) {
      promises.push(autoTagRuns.submit(runIds, "testRun", projectIdNum));
    }
    await Promise.all(promises);
  }, [
    projectId,
    caseIds,
    sessionIds,
    runIds,
    includeCases,
    includeRuns,
    includeSessions,
    autoTagCases,
    autoTagSessions,
    autoTagRuns,
  ]);

  const handleCancel = useCallback(async () => {
    await Promise.all(allJobs.map((j) => j.cancel()));
    setStep("configure");
  }, [allJobs]);

  const handleClose = useCallback(() => {
    if (anyActive) return;
    onOpenChange(false);
    if (step === "review") {
      for (const j of allJobs) j.reset();
      setStep("configure");
    }
  }, [anyActive, onOpenChange, step, allJobs]);

  // ── Review helpers ─────────────────────────────────────────────────

  const [reviewColumnVisibility, setReviewColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const mergedSelections = useMemo(() => {
    const merged = new Map<number, Set<string>>();
    for (const job of allJobs) {
      for (const [k, v] of job.selections) {
        merged.set(k, v);
      }
    }
    return merged;
  }, [allJobs]);

  const mergedSummary = useMemo(() => {
    let existingCount = 0;
    let newCount = 0;
    for (const job of allJobs) {
      existingCount += job.summary.existingCount;
      newCount += job.summary.newCount;
    }
    return { existingCount, newCount };
  }, [allJobs]);

  const totalSelected = mergedSummary.existingCount + mergedSummary.newCount;

  // Find which job owns a given entity for toggle/edit/apply
  const findJobForEntity = useCallback(
    (entityId: number) => {
      return allJobs.find((j) =>
        j.suggestions?.some((s) => s.entityId === entityId)
      );
    },
    [allJobs]
  );

  const handleToggle = useCallback(
    (entityId: number, tagName: string) => {
      findJobForEntity(entityId)?.toggleTag(entityId, tagName);
    },
    [findJobForEntity]
  );

  const handleEdit = useCallback(
    (entityId: number, oldName: string, newName: string) => {
      findJobForEntity(entityId)?.editTag(entityId, oldName, newName);
    },
    [findJobForEntity]
  );

  // ── Review DataTable rows & columns ────────────────────────────────

  const reviewRows = useMemo<AutoTagReviewRow[]>(
    () =>
      allSuggestions.map((entity) => ({
        id: `${entity.entityType}-${entity.entityId}`,
        name: entity.entityName,
        entityId: entity.entityId,
        entityType: entity.entityType,
        tags: entity.tags,
        currentTags: entity.currentTags,
      })),
    [allSuggestions]
  );

  const reviewColumns = useMemo<ColumnDef<AutoTagReviewRow, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        size: 280,
        minSize: 200,
        maxSize: 400,
        enableResizing: true,
        enableHiding: false,
        cell: ({ row }) => {
          const Icon = ENTITY_TYPE_ICONS[row.original.entityType];
          return (
            <div className="flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{row.original.name}</span>
            </div>
          );
        },
      },
      {
        id: "suggestedTags",
        header: t("review.suggestedTags"),
        enableHiding: false,
        minSize: 450,
        enableResizing: true,
        cell: ({ row }) => {
          const entity = row.original;
          const entitySelections = mergedSelections.get(entity.entityId);
          if (entity.tags.length === 0) {
            return (
              <span className="text-xs text-muted-foreground">
                {t("review.noSuggestions")}
              </span>
            );
          }
          return (
            <div className="flex flex-wrap gap-1.5">
              {entity.tags.map((tag, idx) => (
                <TagChip
                  key={`${tag.tagName}-${idx}`}
                  tagName={tag.tagName}
                  isExisting={tag.isExisting}
                  isAccepted={entitySelections?.has(tag.tagName) ?? false}
                  onToggle={() => handleToggle(entity.entityId, tag.tagName)}
                  onEdit={(newName) =>
                    handleEdit(entity.entityId, tag.tagName, newName)
                  }
                />
              ))}
            </div>
          );
        },
      },
    ],
    [tCommon, t, mergedSelections, handleToggle, handleEdit]
  );

  const [isApplying, setIsApplying] = useState(false);

  const handleApply = useCallback(async () => {
    setIsApplying(true);
    try {
      await Promise.all(allJobs.map((j) => j.apply()));

      await Promise.all([
        invalidateModelQueries(queryClient, "RepositoryCases"),
        invalidateModelQueries(queryClient, "TestRuns"),
        invalidateModelQueries(queryClient, "Sessions"),
        invalidateModelQueries(queryClient, "Tags"),
      ]);

      const { existingCount, newCount } = mergedSummary;
      const entityCount = new Set(
        allSuggestions
          .filter((e) => (mergedSelections.get(e.entityId)?.size ?? 0) > 0)
          .map((e) => e.entityId)
      ).size;
      const tagCount = existingCount + newCount;

      toast.success(
        newCount > 0
          ? t("review.applySuccessNewTags", { tagCount, entityCount, newCount })
          : t("review.applySuccess", { tagCount, entityCount })
      );

      onOpenChange(false);
      for (const j of allJobs) j.reset();
      setStep("configure");
    } catch (err: any) {
      toast.error(err.message || t("review.applyError"));
    } finally {
      setIsApplying(false);
    }
  }, [
    allJobs,
    mergedSummary,
    allSuggestions,
    mergedSelections,
    queryClient,
    onOpenChange,
    t,
  ]);

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <Dialog
      open={open}
      onOpenChange={step === "analyzing" ? undefined : handleClose}
    >
      <DialogContent
        className={
          step === "review"
            ? "flex h-[80vh] max-h-[700px] max-w-[900px] flex-col"
            : "max-w-[500px]"
        }
      >
        {step === "configure" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                {t("actions.aiAutoTag")}
              </DialogTitle>
              <DialogDescription>{t("wizard.description")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              {caseIds.length > 0 && (
                <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent/50">
                  <Checkbox
                    checked={includeCases}
                    onCheckedChange={(v) => setIncludeCases(!!v)}
                  />
                  <ListTree className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">
                    {t("wizard.entityLine", {
                      count: caseIds.length,
                      type: t("actions.entityTypes.repositoryCase"),
                    })}
                  </span>
                </label>
              )}
              {runIds.length > 0 && (
                <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent/50">
                  <Checkbox
                    checked={includeRuns}
                    onCheckedChange={(v) => setIncludeRuns(!!v)}
                  />
                  <PlayCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">
                    {t("wizard.entityLine", {
                      count: runIds.length,
                      type: t("actions.entityTypes.testRun"),
                    })}
                  </span>
                </label>
              )}
              {sessionIds.length > 0 && (
                <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent/50">
                  <Checkbox
                    checked={includeSessions}
                    onCheckedChange={(v) => setIncludeSessions(!!v)}
                  />
                  <Compass className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">
                    {t("wizard.entityLine", {
                      count: sessionIds.length,
                      type: t("actions.entityTypes.session"),
                    })}
                  </span>
                </label>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <Button onClick={handleStart} disabled={selectedTotal === 0}>
                <Sparkles className="h-4 w-4" />
                {t("wizard.startAnalysis")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "analyzing" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                {t("actions.aiAutoTag")}
              </DialogTitle>
              <DialogDescription>
                {t("wizard.analyzingDescription")}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {anyFailed ? (
                <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="text-sm text-destructive">
                    {failedError || t("progress.failed")}
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <p className="text-sm">
                      {anyFinalizing
                        ? t("progress.finalizing")
                        : aggregateProgress.total > 0
                          ? t("progress.analyzed", {
                              analyzed: aggregateProgress.analyzed,
                              total: aggregateProgress.total,
                            })
                          : t("progress.starting")}
                    </p>
                  </div>
                  <Progress
                    value={
                      aggregateProgress.total > 0
                        ? Math.round(
                            (aggregateProgress.analyzed /
                              aggregateProgress.total) *
                              100
                          )
                        : undefined
                    }
                    className="h-2"
                  />
                  <div className="mt-2 space-y-1">
                    {includeCases && caseIds.length > 0 && (
                      <EntityJobStatus
                        icon={ListTree}
                        label={t("actions.entityTypes.repositoryCase")}
                        count={caseIds.length}
                        job={autoTagCases}
                        t={t}
                      />
                    )}
                    {includeRuns && runIds.length > 0 && (
                      <EntityJobStatus
                        icon={PlayCircle}
                        label={t("actions.entityTypes.testRun")}
                        count={runIds.length}
                        job={autoTagRuns}
                        t={t}
                      />
                    )}
                    {includeSessions && sessionIds.length > 0 && (
                      <EntityJobStatus
                        icon={Compass}
                        label={t("actions.entityTypes.session")}
                        count={sessionIds.length}
                        job={autoTagSessions}
                        t={t}
                      />
                    )}
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleCancel}>
                {tCommon("cancel")}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "review" && (
          <>
            <DialogHeader>
              <DialogTitle>{t("review.title")}</DialogTitle>
              <DialogDescription>{t("review.description")}</DialogDescription>
            </DialogHeader>

            {anyFailed && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                <span className="text-sm text-destructive">
                  {failedError || t("progress.failed")}
                </span>
              </div>
            )}

            {batchErrors.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600 mt-0.5" />
                <div className="text-sm text-yellow-700 dark:text-yellow-500">
                  <p className="font-medium">{t("review.batchErrors")}</p>
                  <ul className="mt-1 list-disc pl-4">
                    {batchErrors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {reviewRows.length > 0 ? (
              <div className="min-h-0 flex-1 overflow-auto w-full">
                <DataTable
                  columns={reviewColumns}
                  data={reviewRows}
                  columnVisibility={reviewColumnVisibility}
                  onColumnVisibilityChange={setReviewColumnVisibility}
                  pageSize={reviewRows.length}
                />
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {t("review.noSuggestions")}
                </p>
              </div>
            )}

            <DialogFooter>
              <div className="flex flex-col items-end gap-1">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleClose}>
                    {tCommon("cancel")}
                  </Button>
                  <Button
                    onClick={handleApply}
                    disabled={isApplying || totalSelected === 0}
                  >
                    {isApplying && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {isApplying
                      ? t("review.applying")
                      : tCommon("actions.apply")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {totalSelected > 0
                    ? t("review.footerSummary", {
                        existingCount: mergedSummary.existingCount,
                        newCount: mergedSummary.newCount,
                      })
                    : t("review.noTagsSelected")}
                </p>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
