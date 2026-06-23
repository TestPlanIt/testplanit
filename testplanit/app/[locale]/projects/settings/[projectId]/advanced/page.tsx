"use client";

import { ProjectIcon } from "@/components/ProjectIcon";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { WarningAlert } from "@/components/ui/warning-alert";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";

export default function AdvancedPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { data: session, status } = useSession();
  const t = useTranslations("projects.settings.advanced");

  const { data: project, isLoading: projectLoading } = useClientQueries(schema).projects.useFindUnique(
    {
      where: { id: projectId },
      // `name` + `iconUrl` are needed for the shared project-settings header
      // (matches the quickscript / ai-models sibling pages).
      select: {
        id: true,
        name: true,
        iconUrl: true,
        reviewWorkflowEnabled: true,
        requireResultFlipJustification: true,
        editResultsDurationSeconds: true,
        requireIssueOnFailure: true,
        excludeNotStartedFromRuns: true,
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
  const { data: editWindowConfig } = useClientQueries(schema).appConfig.useFindUnique(
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

  // Edit-window override controls. The persisted value is seconds (null =
  // inherit system, 0 = disable for this project, N = custom window).
  const [editWindowMode, setEditWindowMode] = useState<
    "inherit" | "disable" | "custom"
  >("inherit");
  const [customMinutes, setCustomMinutes] = useState("");

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
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { editResultsDurationSeconds: nextSeconds },
      });
      toast.success(t("editWindow.savedToast"));
    } catch {
      toast.error(t("editWindow.saveError"));
    }
  };

  return (
    <main data-testid="advanced-settings-page">
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-xl md:text-2xl pb-2 pt-1">
            <CardTitle>
              <span>{t("title")}</span>
            </CardTitle>
          </div>
          <CardDescription className="uppercase">
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project?.iconUrl} />
              {project?.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
                          {t("editWindow.modeInherit")}
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
                        <Label htmlFor="edit-window-minutes">
                          {t("editWindow.minutesLabel")}
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
                          className="max-w-xs"
                        />
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
                      size="sm"
                      onClick={handleSaveEditWindow}
                      disabled={projectLoading || updateProject.isPending}
                      data-testid="edit-window-save"
                    >
                      {t("editWindow.save")}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </main>
  );
}
