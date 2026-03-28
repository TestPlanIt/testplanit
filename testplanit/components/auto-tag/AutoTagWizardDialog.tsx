"use client";

import { useDebounce } from "@/components/Debounce";
import { DataTable } from "@/components/tables/DataTable";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Badge } from "@/components/ui/badge";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Bot,
  CheckCircle2,
  Compass,
  ListChecks,
  ListTree,
  Loader2,
  PlayCircle,
  Search,
  Sparkles,
  Tag,
  Tags,
  XCircle,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { defaultPageSizeOptions } from "~/lib/contexts/PaginationContext";
import type { EntityType } from "~/lib/llm/services/auto-tag/types";
import { cn } from "~/utils";
import { invalidateModelQueries } from "~/utils/optimistic-updates";
import {
  isAutomatedCaseSource,
  isAutomatedTestRunType,
} from "~/utils/testResultTypes";
import { EntityDetailPopover } from "./EntityDetailPopover";
import { TagChip } from "./TagChip";
import type { AutoTagSuggestionEntity, UseAutoTagJobReturn } from "./types";
import { useAutoTagJob } from "./useAutoTagJob";

type WizardStep = "configure" | "analyzing" | "review";

function EntityJobStatus({
  icon: Icon,
  label,
  count,
  job,
  onCancel,
  cancelLabel,
  cancelled,
  t,
}: {
  icon: typeof ListTree;
  label: string;
  count: number;
  job: UseAutoTagJobReturn;
  onCancel: () => void;
  cancelLabel: string;
  cancelled?: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const isActive = job.status === "waiting" || job.status === "active";
  const isDone = job.status === "completed";
  const isFailed = job.status === "failed";

  const analyzed = job.progress?.analyzed ?? 0;
  const total = job.progress?.total ?? count;
  const isFinalizing = isActive && job.progress?.finalizing;

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        cancelled && "line-through opacity-50"
      )}
    >
      {isActive && <Loader2 className="h-3 w-3 animate-spin" />}
      {isDone && <CheckCircle2 className="h-3 w-3 text-success" />}
      {isFailed && <XCircle className="h-3 w-3 text-destructive" />}
      {cancelled && <XCircle className="h-3 w-3" />}
      {!isActive && !isDone && !isFailed && !cancelled && (
        <div className="h-3 w-3" />
      )}
      <Icon className="h-3 w-3" />
      <span className="flex-1">
        {label}
        {" ("}
        {analyzed}/{total}
        {")"}
        {isFinalizing && (
          <span className="ml-1 italic">{` — ${t("progress.finalizing")}`}</span>
        )}
      </span>
      {isActive && (
        <button
          type="button"
          onClick={onCancel}
          className="ml-1 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-destructive"
          title={cancelLabel}
        >
          <XCircle className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Get the correct icon for an entity based on type and metadata */
function getEntityIcon(entity: {
  entityType: EntityType;
  automated?: boolean;
  source?: string;
  testRunType?: string;
  failed?: boolean;
  truncated?: boolean;
  errorMessage?: string;
}) {
  const isFailed = entity.failed || !!entity.errorMessage;
  const colorClass = isFailed ? "text-destructive" : "text-muted-foreground";

  switch (entity.entityType) {
    case "repositoryCase":
      return entity.automated || isAutomatedCaseSource(entity.source) ? (
        <Bot
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isFailed ? "text-destructive" : "text-primary"
          )}
        />
      ) : (
        <ListChecks className={cn("h-3.5 w-3.5 shrink-0", colorClass)} />
      );
    case "testRun":
      return isAutomatedTestRunType(entity.testRunType) ? (
        <Bot
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isFailed ? "text-destructive" : "text-primary"
          )}
        />
      ) : (
        <PlayCircle className={cn("h-3.5 w-3.5 shrink-0", colorClass)} />
      );
    case "session":
      return <Compass className={cn("h-3.5 w-3.5 shrink-0", colorClass)} />;
  }
}

/** DataTable-compatible row for the review step */
interface AutoTagReviewRow {
  id: string;
  name: string;
  entityId: number;
  entityType: EntityType;
  tags: AutoTagSuggestionEntity["tags"];
  currentTags: string[];
  automated?: boolean;
  source?: string;
  testRunType?: string;
  failed?: boolean;
  truncated?: boolean;
  errorMessage?: string;
}

function getEntityKey(entityType: EntityType, entityId: number): string {
  return `${entityType}:${entityId}`;
}

interface AutoTagWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  caseIds: number[];
  sessionIds: number[];
  runIds: number[];
  /** IDs of entities that currently have no tags assigned */
  untaggedCaseIds?: number[];
  untaggedSessionIds?: number[];
  untaggedRunIds?: number[];
  /** Skip the configure step and immediately start analysis */
  autoStart?: boolean;
}

export function AutoTagWizardDialog({
  open,
  onOpenChange,
  projectId,
  caseIds,
  sessionIds,
  runIds,
  untaggedCaseIds,
  untaggedSessionIds,
  untaggedRunIds,
  autoStart,
}: AutoTagWizardDialogProps) {
  const t = useTranslations("autoTag");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  const [step, setStep] = useState<WizardStep>("configure");

  // Entity type inclusion toggles
  const [includeCases, setIncludeCases] = useState(true);
  const [includeRuns, setIncludeRuns] = useState(true);
  const [includeSessions, setIncludeSessions] = useState(true);
  const [untaggedOnly, setUntaggedOnly] = useState(false);
  const [allowNewTags, setAllowNewTags] = useState(true);

  // Reset toggles when dialog opens
  useEffect(() => {
    if (open) {
      setIncludeCases(true);
      setIncludeRuns(true);
      setIncludeSessions(true);
      setUntaggedOnly(false);
      setAllowNewTags(true);
    }
  }, [open]);

  // Effective IDs based on untaggedOnly toggle
  const effectiveCaseIds =
    untaggedOnly && untaggedCaseIds ? untaggedCaseIds : caseIds;
  const effectiveSessionIds =
    untaggedOnly && untaggedSessionIds ? untaggedSessionIds : sessionIds;
  const effectiveRunIds =
    untaggedOnly && untaggedRunIds ? untaggedRunIds : runIds;

  const selectedTotal =
    (includeCases ? effectiveCaseIds.length : 0) +
    (includeRuns ? effectiveRunIds.length : 0) +
    (includeSessions ? effectiveSessionIds.length : 0);

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
  const anyFinalizing =
    anyActive &&
    allJobs.some((j) => {
      if (j.status !== "active" && j.status !== "waiting") return false;
      if (j.progress?.finalizing) return true;
      if (
        j.progress &&
        j.progress.total > 0 &&
        j.progress.analyzed >= j.progress.total
      )
        return true;
      return false;
    });
  const failedError = allJobs.find((j) => j.status === "failed")?.error;
  // Merge suggestions from all completed jobs
  const allSuggestions = useMemo(() => {
    return allJobs.flatMap((j) => j.suggestions ?? []);
  }, [allJobs]);

  // Transition to review when all jobs complete (or fail)
  // At least one job must have been submitted (non-idle) to prevent immediate transition
  const anySubmitted = allJobs.some((j) => j.status !== "idle");
  const allDone =
    anySubmitted &&
    allJobs.every(
      (j) =>
        j.status === "completed" || j.status === "failed" || j.status === "idle"
    );
  // If all jobs individually cancelled (all idle) while analyzing, go back to configure
  const allIdle = allJobs.every((j) => j.status === "idle");
  useEffect(() => {
    if (step === "analyzing" && !anyActive && allDone) {
      setStep("review");
    } else if (step === "analyzing" && allIdle) {
      setStep("configure");
    }
  }, [step, anyActive, allDone, allIdle]);

  // Restore step from persisted jobs on open
  useEffect(() => {
    if (!open) return;
    if (anyActive) {
      setStep("analyzing");
    } else if (allSuggestions.length > 0) {
      setStep("review");
    } else if (!autoStart) {
      setStep("configure");
    }
  }, [allSuggestions.length, anyActive, open, autoStart]);

  // ── Actions ────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    setStep("analyzing");
    const projectIdNum = Number(projectId);
    const promises: Promise<void>[] = [];
    if (includeCases && effectiveCaseIds.length > 0) {
      promises.push(
        autoTagCases.submit(effectiveCaseIds, "repositoryCase", projectIdNum, {
          allowNewTags,
        })
      );
    }
    if (includeSessions && effectiveSessionIds.length > 0) {
      promises.push(
        autoTagSessions.submit(effectiveSessionIds, "session", projectIdNum, {
          allowNewTags,
        })
      );
    }
    if (includeRuns && effectiveRunIds.length > 0) {
      promises.push(
        autoTagRuns.submit(effectiveRunIds, "testRun", projectIdNum, {
          allowNewTags,
        })
      );
    }
    await Promise.all(promises);
  }, [
    projectId,
    effectiveCaseIds,
    effectiveSessionIds,
    effectiveRunIds,
    includeCases,
    includeRuns,
    includeSessions,
    allowNewTags,
    autoTagCases,
    autoTagSessions,
    autoTagRuns,
  ]);

  // Auto-start analysis when dialog opens with autoStart (skip configure step)
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (
      open &&
      autoStart &&
      !anyActive &&
      allSuggestions.length === 0 &&
      !autoStartedRef.current
    ) {
      autoStartedRef.current = true;
      handleStart();
    }
    if (!open) {
      autoStartedRef.current = false;
    }
  }, [open, autoStart, anyActive, allSuggestions.length, handleStart]);

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
    const merged = new Map<string, Set<string>>();
    for (const job of allJobs) {
      if (!job.suggestions) continue;
      for (const entity of job.suggestions) {
        const selection = job.selections.get(entity.entityId);
        if (!selection) continue;
        merged.set(getEntityKey(entity.entityType, entity.entityId), selection);
      }
    }
    return merged;
  }, [allJobs]);

  const mergedSummary = useMemo(() => {
    let assignCount = 0;
    let newCount = 0;
    for (const job of allJobs) {
      assignCount += job.summary.assignCount;
      newCount += job.summary.newCount;
    }
    return { assignCount, newCount };
  }, [allJobs]);

  const totalSelected = mergedSummary.assignCount;

  // Compute list of new tag names that will be created
  const newTagNames = useMemo(() => {
    const names = new Set<string>();
    for (const job of allJobs) {
      if (!job.suggestions) continue;
      for (const entity of job.suggestions) {
        const accepted = job.selections.get(entity.entityId);
        if (!accepted) continue;
        for (const tag of entity.tags) {
          if (accepted.has(tag.tagName) && !tag.isExisting) {
            names.add(tag.tagName);
          }
        }
      }
    }
    return Array.from(names).sort();
  }, [allJobs]);

  // Find which job owns a given entity for toggle/edit/apply
  const findJobForEntity = useCallback(
    (entityType: EntityType, entityId: number) => {
      return allJobs.find((j) =>
        j.suggestions?.some(
          (s) => s.entityId === entityId && s.entityType === entityType,
        )
      );
    },
    [allJobs]
  );

  const handleToggle = useCallback(
    (entityType: EntityType, entityId: number, tagName: string) => {
      findJobForEntity(entityType, entityId)?.toggleTag(entityId, tagName);
    },
    [findJobForEntity]
  );

  const handleEdit = useCallback(
    (
      entityType: EntityType,
      entityId: number,
      oldName: string,
      newName: string,
    ) => {
      findJobForEntity(entityType, entityId)?.editTag(
        entityId,
        oldName,
        newName,
      );
    },
    [findJobForEntity]
  );

  // ── Review filters & pagination ─────────────────────────────────

  const [reviewSearch, setReviewSearch] = useState("");
  const [showFailed, setShowFailed] = useState(true);
  const debouncedSearch = useDebounce(reviewSearch, 250);
  const [reviewEntityTypes, setReviewEntityTypes] = useState<EntityType[]>([
    "repositoryCase",
    "testRun",
    "session",
  ]);
  const [reviewSortConfig, setReviewSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });
  const userPreferredPageSize = useMemo<number | "All">(() => {
    const pref = session?.user?.preferences?.itemsPerPage;
    if (!pref) return 25;
    const parsed = parseInt(String(pref).replace("P", ""), 10);
    return !isNaN(parsed) && parsed > 0 ? parsed : 25;
  }, [session?.user?.preferences?.itemsPerPage]);

  const [reviewPage, setReviewPage] = useState(1);
  const [reviewPageSize, setReviewPageSize] = useState<number | "All">(
    userPreferredPageSize
  );

  // Reset filters when entering review step
  useEffect(() => {
    if (step === "review") {
      setReviewSearch("");
      setShowFailed(true);
      setReviewPage(1);
      setReviewPageSize(userPreferredPageSize);
      setReviewSortConfig({ column: "name", direction: "asc" });
      // Default to showing all entity types that have results
      const types = new Set(allSuggestions.map((s) => s.entityType));
      setReviewEntityTypes(Array.from(types) as EntityType[]);
    }
  }, [step, allSuggestions, userPreferredPageSize]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setReviewPage(1);
  }, [debouncedSearch, reviewEntityTypes, showFailed]);

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
        automated: entity.automated,
        source: entity.source,
        testRunType: entity.testRunType,
        failed: entity.failed,
        truncated: entity.truncated,
        errorMessage: entity.errorMessage,
      })),
    [allSuggestions]
  );

  const handleReviewSortChange = useCallback((column: string) => {
    setReviewSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
    setReviewPage(1);
  }, []);

  const filteredReviewRows = useMemo(() => {
    let rows = reviewRows;
    if (reviewEntityTypes.length < 3) {
      rows = rows.filter((r) => reviewEntityTypes.includes(r.entityType));
    }
    if (!showFailed) {
      rows = rows.filter((r) => !r.failed && !r.errorMessage && !r.truncated);
    }
    if (debouncedSearch.trim()) {
      const q = debouncedSearch.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q));
    }
    // Apply sorting
    const { column, direction } = reviewSortConfig;
    const dir = direction === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      if (column === "entityType") {
        return dir * a.entityType.localeCompare(b.entityType);
      }
      // Default: sort by name
      return dir * a.name.localeCompare(b.name);
    });
    return rows;
  }, [
    reviewRows,
    reviewEntityTypes,
    debouncedSearch,
    reviewSortConfig,
    showFailed,
  ]);

  const effectivePageSize =
    reviewPageSize === "All" ? filteredReviewRows.length : reviewPageSize;
  const totalFilteredPages =
    effectivePageSize > 0
      ? Math.ceil(filteredReviewRows.length / effectivePageSize)
      : 1;
  const paginatedReviewRows = useMemo(() => {
    if (reviewPageSize === "All") return filteredReviewRows;
    const start = (reviewPage - 1) * (reviewPageSize as number);
    return filteredReviewRows.slice(start, start + (reviewPageSize as number));
  }, [filteredReviewRows, reviewPage, reviewPageSize]);

  const reviewStartIndex =
    filteredReviewRows.length === 0
      ? 0
      : (reviewPage - 1) * effectivePageSize + 1;
  const reviewEndIndex = Math.min(
    reviewPage * effectivePageSize,
    filteredReviewRows.length
  );

  const reviewColumns = useMemo<ColumnDef<AutoTagReviewRow, unknown>[]>(
    () => [
      {
        id: "entityType",
        accessorKey: "entityType",
        header: tCommon("fields.type"),
        size: 48,
        minSize: 40,
        maxSize: 60,
        enableResizing: false,
        enableHiding: false,
        enableSorting: true,
        cell: ({ row }) => {
          const entity = row.original;
          return (
            <div className="flex items-center justify-center">
              {getEntityIcon(entity)}
            </div>
          );
        },
      },
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        size: 260,
        minSize: 180,
        maxSize: 400,
        enableResizing: true,
        enableHiding: false,
        enableSorting: true,
        cell: ({ row }) => {
          const entity = row.original;
          return (
            <EntityDetailPopover
              entityId={entity.entityId}
              entityType={entity.entityType}
              projectId={projectId}
              className={cn(
                "w-full",
                (entity.failed || entity.errorMessage) && "text-destructive",
                entity.truncated &&
                  !entity.failed &&
                  !entity.errorMessage &&
                  "text-warning"
              )}
            >
              {entity.name}
            </EntityDetailPopover>
          );
        },
      },
      {
        id: "suggestedTags",
        header: t("review.suggestedTags"),
        enableHiding: false,
        enableSorting: false,
        minSize: 450,
        enableResizing: true,
        cell: ({ row }) => {
          const entity = row.original;
          const entitySelections = mergedSelections.get(
            getEntityKey(entity.entityType, entity.entityId),
          );
          if (entity.failed || entity.errorMessage) {
            return (
              <span className="text-xs text-destructive">
                {t("review.analysisFailed")}
              </span>
            );
          }
          if (entity.truncated) {
            return (
              <span className="text-xs text-warning">
                {t("review.responseTruncated")}
              </span>
            );
          }
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
                  onToggle={() =>
                    handleToggle(entity.entityType, entity.entityId, tag.tagName)
                  }
                  onEdit={(newName) =>
                    handleEdit(
                      entity.entityType,
                      entity.entityId,
                      tag.tagName,
                      newName,
                    )
                  }
                />
              ))}
            </div>
          );
        },
      },
    ],
    [tCommon, t, mergedSelections, handleToggle, handleEdit, projectId]
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

      const { assignCount, newCount } = mergedSummary;
      const entityCount = new Set(
        allSuggestions
          .filter(
            (e) =>
              (mergedSelections.get(getEntityKey(e.entityType, e.entityId))
                ?.size ?? 0) > 0,
          )
          .map((e) => getEntityKey(e.entityType, e.entityId))
      ).size;
      const tagCount = assignCount;

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
                <Tags className="h-5 w-5" />
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
                      count: effectiveCaseIds.length,
                      type: t("actions.entityTypes.repositoryCase", {
                        count: effectiveCaseIds.length,
                      }),
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
                      count: effectiveRunIds.length,
                      type: t("actions.entityTypes.testRun", {
                        count: effectiveRunIds.length,
                      }),
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
                      count: effectiveSessionIds.length,
                      type: t("actions.entityTypes.session", {
                        count: effectiveSessionIds.length,
                      }),
                    })}
                  </span>
                </label>
              )}

              {/* Untagged-only filter */}
              <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent/50">
                <Switch
                  checked={untaggedOnly}
                  onCheckedChange={setUntaggedOnly}
                />
                <span className="text-sm">{t("wizard.untaggedOnly")}</span>
              </label>

              <label className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition-colors hover:bg-accent/50">
                <Switch
                  checked={allowNewTags}
                  onCheckedChange={setAllowNewTags}
                />
                <span className="text-sm">{t("wizard.allowNewTags")}</span>
              </label>
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
                <Tags className="h-5 w-5" />
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
                    {includeCases && effectiveCaseIds.length > 0 && (
                      <EntityJobStatus
                        icon={ListTree}
                        label={t("actions.entityTypes.repositoryCase", {
                          count: effectiveCaseIds.length,
                        })}
                        count={effectiveCaseIds.length}
                        job={autoTagCases}
                        onCancel={() => autoTagCases.cancel()}
                        cancelLabel={tCommon("cancel")}
                        cancelled={
                          step === "analyzing" && autoTagCases.status === "idle"
                        }
                        t={t}
                      />
                    )}
                    {includeRuns && effectiveRunIds.length > 0 && (
                      <EntityJobStatus
                        icon={PlayCircle}
                        label={t("actions.entityTypes.testRun", {
                          count: effectiveRunIds.length,
                        })}
                        count={effectiveRunIds.length}
                        job={autoTagRuns}
                        onCancel={() => autoTagRuns.cancel()}
                        cancelLabel={tCommon("cancel")}
                        cancelled={
                          step === "analyzing" && autoTagRuns.status === "idle"
                        }
                        t={t}
                      />
                    )}
                    {includeSessions && effectiveSessionIds.length > 0 && (
                      <EntityJobStatus
                        icon={Compass}
                        label={t("actions.entityTypes.session", {
                          count: effectiveSessionIds.length,
                        })}
                        count={effectiveSessionIds.length}
                        job={autoTagSessions}
                        onCancel={() => autoTagSessions.cancel()}
                        cancelLabel={tCommon("cancel")}
                        cancelled={
                          step === "analyzing" &&
                          autoTagSessions.status === "idle"
                        }
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

            {/* Filter bar */}
            {reviewRows.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t("review.filterEntities")}
                    value={reviewSearch}
                    onChange={(e) => setReviewSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                {/* Only show toggles if results contain multiple entity types */}
                {new Set(reviewRows.map((r) => r.entityType)).size > 1 && (
                  <ToggleGroup
                    type="multiple"
                    variant="outline"
                    value={reviewEntityTypes}
                    onValueChange={(v) => {
                      if (v.length > 0) setReviewEntityTypes(v as EntityType[]);
                    }}
                    className="gap-0"
                  >
                    {reviewRows.some(
                      (r) => r.entityType === "repositoryCase"
                    ) && (
                      <ToggleGroupItem
                        value="repositoryCase"
                        size="sm"
                        className="h-8 w-8 rounded-none first:rounded-l-md last:rounded-r-md border-r-0 last:border-r data-[state=on]:bg-muted-foreground/20"
                        aria-label={t("actions.entityTypes.repositoryCase", {
                          count: 2,
                        })}
                        title={t("actions.entityTypes.repositoryCase", {
                          count: 2,
                        })}
                      >
                        <ListChecks className="h-4 w-4" />
                      </ToggleGroupItem>
                    )}
                    {reviewRows.some((r) => r.entityType === "testRun") && (
                      <ToggleGroupItem
                        value="testRun"
                        size="sm"
                        className="h-8 w-8 rounded-none first:rounded-l-md last:rounded-r-md border-r-0 last:border-r data-[state=on]:bg-muted-foreground/20"
                        aria-label={t("actions.entityTypes.testRun", {
                          count: 2,
                        })}
                        title={t("actions.entityTypes.testRun", {
                          count: 2,
                        })}
                      >
                        <PlayCircle className="h-4 w-4" />
                      </ToggleGroupItem>
                    )}
                    {reviewRows.some((r) => r.entityType === "session") && (
                      <ToggleGroupItem
                        value="session"
                        size="sm"
                        className="h-8 w-8 rounded-none first:rounded-l-md last:rounded-r-md border-r-0 last:border-r data-[state=on]:bg-muted-foreground/20"
                        aria-label={t("actions.entityTypes.session", {
                          count: 2,
                        })}
                        title={t("actions.entityTypes.session", {
                          count: 2,
                        })}
                      >
                        <Compass className="h-4 w-4" />
                      </ToggleGroupItem>
                    )}
                  </ToggleGroup>
                )}
                {/* Show failed/truncated toggle only when there are failed rows */}
                {reviewRows.some(
                  (r) => r.failed || r.errorMessage || r.truncated
                ) && (
                  <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Switch
                      checked={showFailed}
                      onCheckedChange={setShowFailed}
                      className="scale-75"
                    />
                    {t("review.showFailed")}
                  </label>
                )}
              </div>
            )}

            {paginatedReviewRows.length > 0 ? (
              <>
                <div className="min-h-0 flex-1 overflow-auto w-full">
                  <DataTable
                    columns={reviewColumns}
                    data={paginatedReviewRows}
                    columnVisibility={reviewColumnVisibility}
                    onColumnVisibilityChange={setReviewColumnVisibility}
                    onSortChange={handleReviewSortChange}
                    sortConfig={reviewSortConfig}
                    pageSize={effectivePageSize}
                  />
                </div>
                {filteredReviewRows.length > 0 && (
                  <div className="flex items-center justify-between pt-1 w-full">
                    <PaginationInfo
                      startIndex={reviewStartIndex}
                      endIndex={reviewEndIndex}
                      totalRows={filteredReviewRows.length}
                      searchString={debouncedSearch}
                      pageSize={reviewPageSize}
                      pageSizeOptions={defaultPageSizeOptions}
                      handlePageSizeChange={(size) => {
                        setReviewPageSize(size);
                        setReviewPage(1);
                      }}
                    />
                    <div className="ml-auto">
                      <PaginationComponent
                        currentPage={reviewPage}
                        totalPages={totalFilteredPages}
                        onPageChange={setReviewPage}
                      />
                    </div>
                  </div>
                )}
              </>
            ) : reviewRows.length > 0 ? (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {t("review.noEntitiesMatch")}
                </p>
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
                    {isApplying && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isApplying
                      ? t("review.applying")
                      : tCommon("actions.apply")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {totalSelected > 0 ? (
                    <>
                      {t("review.footerAssignCount", {
                        assignCount: mergedSummary.assignCount,
                      })}
                      {mergedSummary.newCount > 0 && (
                        <>
                          {", "}
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="cursor-pointer underline decoration-dotted underline-offset-4"
                              >
                                {t("review.footerNewCount", {
                                  newCount: mergedSummary.newCount,
                                })}
                              </button>
                            </PopoverTrigger>
                            <PopoverContent
                              side="top"
                              className="w-auto max-w-80 p-3"
                            >
                              <p className="mb-2 text-xs font-medium">
                                {t("review.footerNewCount", {
                                  newCount: mergedSummary.newCount,
                                })}
                              </p>
                              <div
                                className="max-h-96 overflow-y-auto p-1"
                                onWheel={(e) => e.stopPropagation()}
                              >
                                <div className="flex flex-wrap gap-2">
                                  {newTagNames.map((name) => (
                                    <Badge
                                      key={name}
                                      variant="outline"
                                      className="outline-2 outline-offset-1 outline-primary/50"
                                    >
                                      <Tag className="mr-1 h-3 w-3 shrink-0" />
                                      {name}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </PopoverContent>
                          </Popover>
                        </>
                      )}
                    </>
                  ) : (
                    t("review.noTagsSelected")
                  )}
                </p>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
