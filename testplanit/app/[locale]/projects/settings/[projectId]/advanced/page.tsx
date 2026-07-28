"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  PageCardHeader,
  ProjectHeaderInfo,
} from "@/components/ui/page-card-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WarningAlert } from "@/components/ui/warning-alert";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import type { IconName } from "~/types/globals";
import { Loader2, Save, Star, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { useRecordKeyConfig } from "~/hooks/useRecordKeyConfig";
import { ABANDONED_RUN_MIN_IDLE_MINUTES } from "~/lib/services/abandonedRuns";
import {
  isValidProjectKey,
  normalizeProjectKey,
  RECORD_TYPES,
  sanitizeKeyInput,
  suggestProjectKey,
} from "~/lib/recordKey";
import { useDebounce } from "@/components/Debounce";

export default function AdvancedPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { data: session, status } = useSession();
  const t = useTranslations("projects.settings.advanced");
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");

  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindUnique(
    {
      where: { id: projectId },
      // `name` + `iconUrl` are needed for the shared project-settings header
      // (matches the quickscript / ai-models sibling pages).
      select: {
        id: true,
        name: true,
        iconUrl: true,
        key: true,
        reviewWorkflowEnabled: true,
        requireResultFlipJustification: true,
        editResultsDurationSeconds: true,
        requireIssueOnFailure: true,
        excludeNotStartedFromRuns: true,
        autoLockCompositionOnInProgress: true,
        abandonedRunIdleMinutes: true,
        abandonedRunStateId: true,
        projectIntegrations: {
          where: { isActive: true, integration: { status: "ACTIVE" } },
          select: { id: true },
          take: 1,
        },
      },
    },
    {
      enabled: status === "authenticated" && Number.isFinite(projectId),
    }
  );

  const { systemEnabled: reviewFeatureSystemEnabled } =
    useReviewFeatureEnabled();
  const systemReviewWorkflowDisabled = reviewFeatureSystemEnabled === false;

  // System edit-window policy (ceiling). value: 0 = locked everywhere, N =
  // max seconds (projects may tighten), absent = no policy.
  const { data: editWindowConfig } = useClientQueries(
    schema
  ).appConfig.useFindUnique(
    { where: { key: "edit_results_duration" } },
    { enabled: status === "authenticated" }
  );
  const systemEditWindowSeconds =
    typeof editWindowConfig?.value === "number"
      ? (editWindowConfig.value as number)
      : null;
  const systemEditingLocked = systemEditWindowSeconds === 0;
  const systemMaxMinutes =
    systemEditWindowSeconds && systemEditWindowSeconds > 0
      ? Math.floor(systemEditWindowSeconds / 60)
      : null;

  // System abandoned automated-run policy (the default projects inherit).
  // value: N > 0 = idle minutes before the sweeper closes a run, absent/0 =
  // sweeping off unless the project overrides.
  const { data: abandonedRunConfig } = useClientQueries(
    schema
  ).appConfig.useFindUnique(
    { where: { key: "abandoned_run_idle_minutes" } },
    { enabled: status === "authenticated" }
  );
  const systemAbandonedMinutes =
    typeof abandonedRunConfig?.value === "number" &&
    (abandonedRunConfig.value as number) > 0
      ? (abandonedRunConfig.value as number)
      : null;

  // RUNS workflow states assignable as the abandoned-run target. New choices
  // must be enabled, but the currently-configured state is kept in the list
  // even if it was disabled since (keep-current convention).
  const { data: runWorkflows } = useClientQueries(schema).workflows.useFindMany(
    {
      where: {
        scope: "RUNS",
        isDeleted: false,
        projects: { some: { projectId } },
        OR: [
          { isEnabled: true },
          ...(project?.abandonedRunStateId != null
            ? [{ id: project.abandonedRunStateId }]
            : []),
        ],
      },
      orderBy: { order: "asc" },
      select: {
        id: true,
        name: true,
        workflowType: true,
        isEnabled: true,
        icon: { select: { name: true } },
        color: { select: { value: true } },
      },
    },
    {
      enabled:
        status === "authenticated" &&
        Number.isFinite(projectId) &&
        project !== undefined,
    }
  );

  // The state "Automatic" resolves to: the project's lowest-order enabled
  // DONE run workflow — the same fallback the sweeper uses. Starred in the
  // picker so it's clear which state you get without choosing one.
  const automaticFallbackStateId =
    (runWorkflows ?? []).find(
      (workflow) => workflow.workflowType === "DONE" && workflow.isEnabled
    )?.id ?? null;

  const updateProject = useClientQueries(schema).projects.useUpdate();

  // Access guard: ADMIN or PROJECTADMIN per D-18 / Open Question 4.
  // Mirrors the quickscript page guard: imperative `notFound()` from useEffect
  // so unauthorized users hit the global not-found surface.
  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) return;
    const access = session.user.access;
    if (access !== "ADMIN" && access !== "PROJECTADMIN") {
      notFound();
    }
  }, [session, status]);

  // Bail BEFORE we render the page body for ineligible users — useEffect runs
  // post-paint, so we also need a synchronous guard so the test (and real
  // users) never see the toggle for the wrong access level.
  if (session?.user) {
    const access = session.user.access;
    if (access !== "ADMIN" && access !== "PROJECTADMIN") {
      notFound();
    }
  }

  const reviewWorkflowEnabled = project?.reviewWorkflowEnabled ?? true;
  const requireResultFlipJustification =
    project?.requireResultFlipJustification ?? false;
  const requireIssueOnFailure = project?.requireIssueOnFailure ?? false;
  const excludeNotStartedFromRuns = project?.excludeNotStartedFromRuns ?? false;
  const autoLockCompositionOnInProgress =
    project?.autoLockCompositionOnInProgress ?? false;
  // Requiring a linked issue is only meaningful when the project has an active
  // issue integration to link from; without one the toggle is forced off.
  const hasIssueIntegration = (project?.projectIntegrations?.length ?? 0) > 0;

  const handleToggleReviewWorkflow = async (enabled: boolean) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { reviewWorkflowEnabled: enabled },
      });
      toast.success(
        enabled
          ? t("reviewWorkflow.enabledToast")
          : t("reviewWorkflow.disabledToast")
      );
    } catch {
      toast.error(t("reviewWorkflow.saveError"));
    }
  };

  const handleToggleResultFlipJustification = async (enabled: boolean) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { requireResultFlipJustification: enabled },
      });
      toast.success(
        enabled
          ? t("flipJustification.enabledToast")
          : t("flipJustification.disabledToast")
      );
    } catch {
      toast.error(t("flipJustification.saveError"));
    }
  };

  const handleToggleIssueOnFailure = async (enabled: boolean) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { requireIssueOnFailure: enabled },
      });
      toast.success(
        enabled
          ? t("issueOnFailure.enabledToast")
          : t("issueOnFailure.disabledToast")
      );
    } catch {
      toast.error(t("issueOnFailure.saveError"));
    }
  };

  const handleToggleExcludeNotStarted = async (enabled: boolean) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { excludeNotStartedFromRuns: enabled },
      });
      toast.success(
        enabled
          ? t("excludeNotStarted.enabledToast")
          : t("excludeNotStarted.disabledToast")
      );
    } catch {
      toast.error(t("excludeNotStarted.saveError"));
    }
  };

  const handleToggleAutoLockComposition = async (enabled: boolean) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { autoLockCompositionOnInProgress: enabled },
      });
      toast.success(
        enabled
          ? t("autoLockComposition.enabledToast")
          : t("autoLockComposition.disabledToast")
      );
    } catch {
      toast.error(t("autoLockComposition.saveError"));
    }
  };

  // Edit-window override controls. The persisted value is seconds (null =
  // inherit system, 0 = disable for this project, N = custom window).
  const [editWindowMode, setEditWindowMode] = useState<
    "inherit" | "disable" | "custom"
  >("inherit");
  const [customMinutes, setCustomMinutes] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [savingEditWindow, setSavingEditWindow] = useState(false);

  useEffect(() => {
    const seconds = project?.editResultsDurationSeconds;
    if (seconds === undefined) return;
    if (seconds === null) {
      setEditWindowMode("inherit");
      setCustomMinutes("");
    } else if (seconds === 0) {
      setEditWindowMode("disable");
      setCustomMinutes("");
    } else {
      setEditWindowMode("custom");
      setCustomMinutes(String(Math.max(1, Math.round(seconds / 60))));
    }
  }, [project?.editResultsDurationSeconds]);

  const handleSaveEditWindow = async () => {
    let nextSeconds: number | null;
    if (editWindowMode === "inherit") {
      nextSeconds = null;
    } else if (editWindowMode === "disable") {
      nextSeconds = 0;
    } else {
      const minutes = Number(customMinutes);
      if (!Number.isFinite(minutes) || minutes <= 0) {
        toast.error(t("editWindow.invalidMinutes"));
        return;
      }
      const capped =
        systemMaxMinutes !== null
          ? Math.min(minutes, systemMaxMinutes)
          : minutes;
      nextSeconds = Math.round(capped * 60);
    }
    setSavingEditWindow(true);
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { editResultsDurationSeconds: nextSeconds },
      });
      toast.success(t("editWindow.savedToast"));
    } catch {
      toast.error(t("editWindow.saveError"));
    } finally {
      setSavingEditWindow(false);
    }
  };

  // Abandoned automated-run override controls. The persisted threshold is
  // minutes (null = inherit system, 0 = disable for this project, N = custom)
  // plus an optional target RUNS state (null = automatic DONE fallback).
  const [abandonedMode, setAbandonedMode] = useState<
    "inherit" | "disable" | "custom"
  >("inherit");
  const [abandonedMinutes, setAbandonedMinutes] = useState("");
  const [abandonedStateId, setAbandonedStateId] = useState<string>("");
  const [savingAbandoned, setSavingAbandoned] = useState(false);

  useEffect(() => {
    const minutes = project?.abandonedRunIdleMinutes;
    if (minutes === undefined) return;
    if (minutes === null) {
      setAbandonedMode("inherit");
      setAbandonedMinutes("");
    } else if (minutes === 0) {
      setAbandonedMode("disable");
      setAbandonedMinutes("");
    } else {
      setAbandonedMode("custom");
      setAbandonedMinutes(String(minutes));
    }
  }, [project?.abandonedRunIdleMinutes]);

  // Seed the target-state picker: the saved override, else the automatic
  // fallback (first enabled Done state) once the workflow list arrives. The
  // `prev === ""` guard keeps a user's in-flight selection from being
  // clobbered when queries refresh.
  useEffect(() => {
    const stateId = project?.abandonedRunStateId;
    if (stateId === undefined) return;
    if (stateId !== null) {
      setAbandonedStateId(String(stateId));
    } else if (automaticFallbackStateId !== null) {
      setAbandonedStateId((prev) =>
        prev === "" ? String(automaticFallbackStateId) : prev
      );
    }
  }, [project?.abandonedRunStateId, automaticFallbackStateId]);

  const handleSaveAbandonedRuns = async () => {
    let nextMinutes: number | null;
    if (abandonedMode === "inherit") {
      nextMinutes = null;
    } else if (abandonedMode === "disable") {
      nextMinutes = 0;
    } else {
      const minutes = Number(abandonedMinutes);
      if (
        !Number.isFinite(minutes) ||
        minutes < ABANDONED_RUN_MIN_IDLE_MINUTES
      ) {
        toast.error(
          t("abandonedRuns.invalidMinutes", {
            min: ABANDONED_RUN_MIN_IDLE_MINUTES,
          })
        );
        return;
      }
      nextMinutes = Math.round(minutes);
    }
    setSavingAbandoned(true);
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: {
          abandonedRunIdleMinutes: nextMinutes,
          abandonedRunStateId:
            abandonedMode === "disable" || abandonedStateId === ""
              ? null
              : Number(abandonedStateId),
        },
      });
      toast.success(t("abandonedRuns.savedToast"));
    } catch {
      toast.error(t("abandonedRuns.saveError"));
    } finally {
      setSavingAbandoned(false);
    }
  };

  // Project record-key code. Only relevant when the system feature is enabled;
  // the code becomes the prefix in cosmetic keys like PROJECT-TC-1234.
  const { enabled: recordKeyFeatureEnabled, formatKey } = useRecordKeyConfig();
  const [projectKeyInput, setProjectKeyInput] = useState("");
  useEffect(() => {
    if (project?.key === undefined) return;
    setProjectKeyInput(project.key ?? "");
  }, [project?.key]);

  const normalizedProjectKey = normalizeProjectKey(projectKeyInput);
  const projectKeyValid =
    normalizedProjectKey === null || isValidProjectKey(normalizedProjectKey);
  const projectKeyDirty =
    (normalizedProjectKey ?? null) !== (project?.key ?? null);

  // Recommended code derived from the project name (e.g. "Web" → "WEB").
  const suggestedProjectKey = suggestProjectKey(project?.name);

  // Live uniqueness check: as the user types a valid, changed code, ask whether
  // another project already uses it. Codes are stored uppercase, so this is
  // case-insensitive. Debounced to avoid a query per keystroke and scoped to
  // projects the user can see; the DB unique index is the ultimate backstop.
  const debouncedProjectKey = useDebounce(normalizedProjectKey ?? "", 300);
  const shouldCheckUniqueness =
    recordKeyFeatureEnabled &&
    projectKeyValid &&
    debouncedProjectKey !== "" &&
    debouncedProjectKey !== (project?.key ?? "");
  const { data: conflictingProject, isFetching: checkingUniqueness } =
    useClientQueries(schema).projects.useFindFirst(
      {
        where: { key: debouncedProjectKey, id: { not: projectId } },
        select: { id: true },
      },
      { enabled: shouldCheckUniqueness }
    );
  const debounceCaughtUp = debouncedProjectKey === (normalizedProjectKey ?? "");
  const uniquenessPending =
    shouldCheckUniqueness && (!debounceCaughtUp || checkingUniqueness);
  const projectKeyTaken =
    shouldCheckUniqueness &&
    debounceCaughtUp &&
    !checkingUniqueness &&
    !!conflictingProject;

  const projectKeyPreview =
    normalizedProjectKey && projectKeyValid && !projectKeyTaken
      ? formatKey(RECORD_TYPES.TEST_CASE, normalizedProjectKey, 1234)
      : null;

  const canSaveProjectKey =
    !projectLoading &&
    !updateProject.isPending &&
    projectKeyValid &&
    projectKeyDirty &&
    !projectKeyTaken &&
    !uniquenessPending;

  const handleSaveProjectKey = async () => {
    if (!projectKeyValid) {
      toast.error(t("recordKey.invalid"));
      return;
    }
    if (projectKeyTaken) {
      toast.error(t("recordKey.taken"));
      return;
    }
    setSavingKey(true);
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { key: normalizedProjectKey },
      });
      toast.success(t("recordKey.savedToast"));
    } catch {
      // Backstop for the DB unique index (e.g. a conflicting project the user
      // can't see, or a race with a concurrent save).
      toast.error(t("recordKey.saveError"));
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <main data-testid="advanced-settings-page">
      <Card>
        <PageCardHeader
          className="w-full"
          title={t("title")}
          helpKey="projectAdvanced"
          description={<ProjectHeaderInfo project={project} />}
        />
        <CardContent className="space-y-6">
          {/* Project record-key code. Only shown when the system-wide
              record-key feature is enabled — the code becomes the prefix in
              cosmetic keys like PROJECT-TC-1234. */}
          {recordKeyFeatureEnabled && (
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-3">
                  <Label
                    htmlFor="project-record-key-input"
                    className="text-base font-medium"
                  >
                    {t("recordKey.label")}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {t("recordKey.description", {
                      example:
                        formatKey(
                          RECORD_TYPES.TEST_CASE,
                          suggestedProjectKey || "PROJECT",
                          1234
                        ) ?? "PROJECT-TC-1234",
                    })}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="project-record-key-input"
                      data-testid="project-record-key-input"
                      value={projectKeyInput}
                      maxLength={10}
                      placeholder={
                        suggestedProjectKey || t("recordKey.placeholder")
                      }
                      onChange={(e) =>
                        setProjectKeyInput(sanitizeKeyInput(e.target.value))
                      }
                      disabled={projectLoading || updateProject.isPending}
                      aria-invalid={!projectKeyValid || projectKeyTaken}
                      className="w-48 uppercase"
                    />
                    <Button
                      type="button"
                      data-testid="project-record-key-save"
                      onClick={handleSaveProjectKey}
                      disabled={!canSaveProjectKey}
                      aria-label={tActions("save")}
                      className="group gap-0 transition-all duration-200 hover:gap-2"
                    >
                      {savingKey ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                        {tActions("save")}
                      </span>
                    </Button>
                  </div>
                  {suggestedProjectKey &&
                    normalizedProjectKey !== suggestedProjectKey && (
                      <button
                        type="button"
                        data-testid="project-record-key-suggestion"
                        className="text-sm text-primary hover:underline"
                        onClick={() => setProjectKeyInput(suggestedProjectKey)}
                      >
                        {t("recordKey.useSuggestion", {
                          code: suggestedProjectKey,
                        })}
                      </button>
                    )}
                  {!projectKeyValid && (
                    <p className="text-sm text-destructive">
                      {t("recordKey.invalid")}
                    </p>
                  )}
                  {projectKeyTaken && (
                    <p
                      className="text-sm text-destructive"
                      data-testid="project-record-key-taken"
                    >
                      {t("recordKey.taken")}
                    </p>
                  )}
                  {projectKeyPreview && (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="project-record-key-preview"
                    >
                      {t("recordKey.previewLabel")}{" "}
                      <span className="font-mono">{projectKeyPreview}</span>
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Review workflow toggle (Phase 2's single Advanced toggle).
              Future Advanced toggles can append additional <Card> sections
              below without restructuring this layout. */}
          <Card>
            <CardContent className="pt-6">
              {/* Switch on the LEFT of the label — matches the Admin >
                  Workflows SystemFeatureCard pattern so toggle placement
                  is consistent between the system-wide and per-project
                  controls for the same feature. */}
              <div className="space-y-3">
                <Label className="flex items-center gap-3">
                  <Switch
                    id="review-workflow-toggle"
                    data-testid="review-workflow-toggle"
                    checked={reviewWorkflowEnabled}
                    onCheckedChange={handleToggleReviewWorkflow}
                    disabled={projectLoading || updateProject.isPending}
                  />
                  <span className="text-base font-medium">
                    {t("reviewWorkflow.label")}
                  </span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("reviewWorkflow.description")}
                </p>
                {reviewWorkflowEnabled && systemReviewWorkflowDisabled && (
                  <WarningAlert data-testid="review-workflow-system-disabled-warning">
                    <TriangleAlert className="h-4 w-4" />
                    <AlertTitle>
                      {t("reviewWorkflow.systemDisabledTitle")}
                    </AlertTitle>
                    <AlertDescription>
                      {t("reviewWorkflow.systemDisabledDescription")}
                    </AlertDescription>
                  </WarningAlert>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <Label className="flex items-center gap-3">
                  <Switch
                    id="result-flip-justification-toggle"
                    data-testid="result-flip-justification-toggle"
                    checked={requireResultFlipJustification}
                    onCheckedChange={handleToggleResultFlipJustification}
                    disabled={projectLoading || updateProject.isPending}
                  />
                  <span className="text-base font-medium">
                    {t("flipJustification.label")}
                  </span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("flipJustification.description")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <Label className="flex items-center gap-3">
                  <Switch
                    id="require-issue-on-failure-toggle"
                    data-testid="require-issue-on-failure-toggle"
                    checked={requireIssueOnFailure && hasIssueIntegration}
                    onCheckedChange={handleToggleIssueOnFailure}
                    disabled={
                      projectLoading ||
                      updateProject.isPending ||
                      !hasIssueIntegration
                    }
                  />
                  <span className="text-base font-medium">
                    {t("issueOnFailure.label")}
                  </span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("issueOnFailure.description")}
                </p>
                {!hasIssueIntegration && (
                  <WarningAlert data-testid="issue-on-failure-no-integration-warning">
                    <AlertTitle>
                      {t("issueOnFailure.noIntegrationTitle")}
                    </AlertTitle>
                    <AlertDescription>
                      {t("issueOnFailure.noIntegrationDescription")}
                    </AlertDescription>
                  </WarningAlert>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <Label className="flex items-center gap-3">
                  <Switch
                    id="exclude-not-started-from-runs-toggle"
                    data-testid="exclude-not-started-from-runs-toggle"
                    checked={excludeNotStartedFromRuns}
                    onCheckedChange={handleToggleExcludeNotStarted}
                    disabled={projectLoading || updateProject.isPending}
                  />
                  <span className="text-base font-medium">
                    {t("excludeNotStarted.label")}
                  </span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("excludeNotStarted.description")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <Label className="flex items-center gap-3">
                  <Switch
                    id="auto-lock-composition-toggle"
                    data-testid="auto-lock-composition-toggle"
                    checked={autoLockCompositionOnInProgress}
                    onCheckedChange={handleToggleAutoLockComposition}
                    disabled={projectLoading || updateProject.isPending}
                  />
                  <span className="text-base font-medium">
                    {t("autoLockComposition.label")}
                  </span>
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("autoLockComposition.description")}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <span className="text-base font-medium">
                  {t("editWindow.label")}
                </span>
                <p className="text-sm text-muted-foreground">
                  {t("editWindow.description")}
                </p>
                {systemEditingLocked ? (
                  <WarningAlert data-testid="edit-window-system-locked-warning">
                    <TriangleAlert className="h-4 w-4" />
                    <AlertTitle>{t("editWindow.systemLockedTitle")}</AlertTitle>
                    <AlertDescription>
                      {t("editWindow.systemLockedDescription")}
                    </AlertDescription>
                  </WarningAlert>
                ) : (
                  <div className="space-y-3">
                    <Select
                      value={editWindowMode}
                      onValueChange={(value) =>
                        setEditWindowMode(
                          value as "inherit" | "disable" | "custom"
                        )
                      }
                      disabled={projectLoading || updateProject.isPending}
                    >
                      <SelectTrigger
                        className="max-w-xs"
                        data-testid="edit-window-mode-select"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">
                          {systemMaxMinutes !== null
                            ? t("editWindow.modeInheritMinutes", {
                                minutes: systemMaxMinutes,
                              })
                            : t("editWindow.modeInheritNoLimit")}
                        </SelectItem>
                        <SelectItem value="disable">
                          {t("editWindow.modeDisable")}
                        </SelectItem>
                        <SelectItem value="custom">
                          {t("editWindow.modeCustom")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    {editWindowMode === "custom" && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm">
                          <Label
                            htmlFor="edit-window-minutes"
                            className="font-normal"
                          >
                            {t("editWindow.minutesBefore")}
                          </Label>
                          <Input
                            id="edit-window-minutes"
                            data-testid="edit-window-minutes-input"
                            type="number"
                            min={1}
                            max={systemMaxMinutes ?? undefined}
                            value={customMinutes}
                            onChange={(event) =>
                              setCustomMinutes(event.target.value)
                            }
                            className="w-24"
                            aria-label={t("editWindow.minutesAriaLabel")}
                          />
                          <span>
                            {t("editWindow.minutesUnit", {
                              minutes: Number(customMinutes) || 0,
                            })}
                          </span>
                        </div>
                        {systemMaxMinutes !== null && (
                          <p className="text-xs text-muted-foreground">
                            {t("editWindow.systemMaxHint", {
                              minutes: String(systemMaxMinutes),
                            })}
                          </p>
                        )}
                      </div>
                    )}
                    <Button
                      type="button"
                      onClick={handleSaveEditWindow}
                      disabled={projectLoading || updateProject.isPending}
                      data-testid="edit-window-save"
                      aria-label={t("editWindow.save")}
                      className="group gap-0 transition-all duration-200 hover:gap-2"
                    >
                      {savingEditWindow ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                        {t("editWindow.save")}
                      </span>
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-3">
                <span className="text-base font-medium">
                  {t("abandonedRuns.label")}
                </span>
                <p className="text-sm text-muted-foreground">
                  {t("abandonedRuns.description")}
                </p>
                <Select
                  value={abandonedMode}
                  onValueChange={(value) =>
                    setAbandonedMode(value as "inherit" | "disable" | "custom")
                  }
                  disabled={projectLoading || updateProject.isPending}
                >
                  <SelectTrigger
                    className="max-w-xs"
                    data-testid="abandoned-runs-mode-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      {systemAbandonedMinutes !== null
                        ? t("abandonedRuns.modeInheritMinutes", {
                            minutes: systemAbandonedMinutes,
                          })
                        : t("abandonedRuns.modeInheritOff")}
                    </SelectItem>
                    <SelectItem value="disable">
                      {t("abandonedRuns.modeDisable")}
                    </SelectItem>
                    <SelectItem value="custom">
                      {t("abandonedRuns.modeCustom")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                {abandonedMode === "custom" && (
                  <div className="flex items-center gap-2 text-sm">
                    <Label
                      htmlFor="abandoned-runs-minutes"
                      className="font-normal"
                    >
                      {t("abandonedRuns.minutesBefore")}
                    </Label>
                    <Input
                      id="abandoned-runs-minutes"
                      data-testid="abandoned-runs-minutes-input"
                      type="number"
                      min={ABANDONED_RUN_MIN_IDLE_MINUTES}
                      placeholder="1440"
                      value={abandonedMinutes}
                      onChange={(event) =>
                        setAbandonedMinutes(event.target.value)
                      }
                      className="w-24"
                      aria-label={t("abandonedRuns.minutesAriaLabel")}
                    />
                    <span>
                      {t("abandonedRuns.minutesUnit", {
                        minutes: Number(abandonedMinutes) || 0,
                      })}
                    </span>
                  </div>
                )}
                {abandonedMode !== "disable" && (
                  <div className="space-y-1">
                    <Label
                      htmlFor="abandoned-runs-state-select"
                      className="font-normal"
                    >
                      {t("abandonedRuns.targetStateLabel")}
                    </Label>
                    <Select
                      value={abandonedStateId}
                      onValueChange={setAbandonedStateId}
                      disabled={projectLoading || updateProject.isPending}
                    >
                      <SelectTrigger
                        id="abandoned-runs-state-select"
                        className="max-w-xs"
                        data-testid="abandoned-runs-state-select"
                        aria-label={t("abandonedRuns.targetStateAria")}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(runWorkflows ?? []).map((workflow) => (
                          <SelectItem
                            key={workflow.id}
                            value={String(workflow.id)}
                          >
                            <span className="flex items-center gap-1">
                              <WorkflowStateDisplay
                                state={{
                                  name: workflow.name,
                                  icon: {
                                    name: (workflow.icon?.name ??
                                      "") as IconName,
                                  },
                                  color: { value: workflow.color?.value ?? "" },
                                }}
                                size="sm"
                              />
                              {workflow.id === automaticFallbackStateId && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="secondary">
                                      <Star className="h-3 w-3 fill-current text-primary-background" />
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {tCommon("defaultOption")}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button
                  type="button"
                  onClick={handleSaveAbandonedRuns}
                  disabled={projectLoading || updateProject.isPending}
                  data-testid="abandoned-runs-save"
                  aria-label={t("abandonedRuns.save")}
                  className="group gap-0 transition-all duration-200 hover:gap-2"
                >
                  {savingAbandoned ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
                    {t("abandonedRuns.save")}
                  </span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </main>
  );
}
