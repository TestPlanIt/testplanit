"use client";

import { Loading } from "@/components/Loading";
import {
  ActionButtonContent,
  collapsibleActionClass,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PageCardHeader,
  ProjectHeaderInfo,
} from "@/components/ui/page-card-header";
import { Switch } from "@/components/ui/switch";
import { PageTitle } from "@/components/ui/typography";
import { DbNull } from "@zenstackhq/orm";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Gauge, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_PRIORITY_NAME_LENGTH,
  optionPositionWeight,
} from "~/lib/schemas/riskPriorityWeights";
import {
  DEFAULT_RISK_WEIGHTS,
  MAX_RISK_WEIGHT,
  RISK_COMPONENT_KEYS,
  resolveRiskWeights,
  type RiskWeights,
} from "~/lib/schemas/riskWeights";
import { ApplicationArea } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

type BackfillStatus = {
  state: "none" | "waiting" | "active" | "completed" | "failed" | string;
  processed?: number;
};

const POLL_INTERVAL_MS = 3000;

function weightsEqual(a: RiskWeights, b: RiskWeights): boolean {
  return RISK_COMPONENT_KEYS.every((key) => a[key] === b[key]);
}

export default function RiskSettingsPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const {
    session,
    isLoading: isAuthLoading,
    isAuthenticated,
  } = useRequireAuth();
  const t = useTranslations("risk.settings");
  const tCommon = useTranslations("common");
  const router = useRouter();

  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        riskScoringEnabled: true,
        riskWeights: true,
        riskCriticalityFieldId: true,
      },
    },
    { enabled: isAuthenticated }
  );
  const updateProject = useClientQueries(schema).projects.useUpdate();
  const { isProjectAdmin, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Settings);

  useEffect(() => {
    if (projectLoading || permissionsLoading || !session?.user) return;
    if (!project || !isProjectAdmin) notFound();
  }, [project, projectLoading, permissionsLoading, isProjectAdmin, session]);

  const savedWeights = resolveRiskWeights(project?.riskWeights);
  const [weightsDraft, setWeightsDraft] = useState<Record<
    string,
    string
  > | null>(null);
  const draftFor = (key: (typeof RISK_COMPONENT_KEYS)[number]): string =>
    weightsDraft?.[key] ?? String(savedWeights[key]);

  const [backfill, setBackfill] = useState<BackfillStatus>({ state: "none" });
  const [starting, setStarting] = useState(false);
  const backfillRunning =
    backfill.state === "waiting" ||
    backfill.state === "active" ||
    backfill.state === "delayed";

  const pollBackfill = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/risk/backfill`);
      if (!res.ok) return;
      const next = (await res.json()) as BackfillStatus;
      setBackfill((prev) => {
        if (
          prev.state !== "none" &&
          prev.state !== "completed" &&
          prev.state !== "failed"
        ) {
          if (next.state === "completed") toast.success(t("backfillDone"));
          if (next.state === "failed") toast.error(t("backfillFailed"));
        }
        return next;
      });
    } catch {
      // Status is informational; a failed poll just tries again.
    }
  }, [projectId, t]);

  useEffect(() => {
    if (!isProjectAdmin) return;
    void pollBackfill();
  }, [isProjectAdmin, pollBackfill]);

  useEffect(() => {
    if (!backfillRunning) return;
    const timer = setInterval(() => void pollBackfill(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [backfillRunning, pollBackfill]);

  const startBackfill = useCallback(
    async (options: { silent?: boolean } = {}) => {
      setStarting(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/risk/backfill`, {
          method: "POST",
        });
        if (res.status === 409) {
          // A run started under the old weights finishes under them for the
          // cases it already passed; the user must know the rescore did not
          // restart.
          if (options.silent) toast.warning(t("backfillAlreadyRunning"));
          setBackfill({ state: "active" });
          return;
        }
        if (!res.ok) {
          // Errors always surface — a silent start must not silently fail.
          const body = await res.json().catch(() => ({}));
          toast.error(
            res.status === 503
              ? t("backfillQueueUnavailable")
              : (body.error ?? tCommon("errors.error"))
          );
          return;
        }
        if (!options.silent) toast.success(t("backfillStarted"));
        setBackfill({ state: "waiting", processed: 0 });
      } catch {
        toast.error(tCommon("errors.error"));
      } finally {
        setStarting(false);
      }
    },
    [projectId, t, tCommon]
  );

  const toggleEnabled = async (value: boolean) => {
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { riskScoringEnabled: value },
      });
      toast.success(value ? t("enabledToast") : t("disabledToast"));
    } catch (error) {
      console.error("Failed to update risk settings:", error);
      toast.error(tCommon("errors.error"));
    }
  };

  const saveWeights = async () => {
    if (weightsDraft === null) return;
    const next: Partial<RiskWeights> = {};
    for (const key of RISK_COMPONENT_KEYS) {
      // Number("") is 0, so a cleared input must be rejected explicitly or
      // it silently zeroes the component.
      const text = draftFor(key).trim();
      const parsed = Number(text);
      if (
        text === "" ||
        !Number.isFinite(parsed) ||
        parsed < 0 ||
        parsed > MAX_RISK_WEIGHT
      ) {
        toast.error(t("weightsInvalid", { max: MAX_RISK_WEIGHT }));
        return;
      }
      next[key] = parsed;
    }
    const resolved = next as RiskWeights;
    try {
      // Weights identical to the system defaults are stored as null, so the
      // project follows future default changes instead of pinning a copy.
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: {
          riskWeights: weightsEqual(resolved, DEFAULT_RISK_WEIGHTS)
            ? DbNull
            : resolved,
        },
      });
      setWeightsDraft(null);
      toast.success(t("weightsSaved"));
      // A weight change invalidates every stored score; rescore right away
      // rather than waiting for the nightly sweep.
      void startBackfill({ silent: true });
    } catch (error) {
      console.error("Failed to update risk settings:", error);
      toast.error(tCommon("errors.error"));
    }
  };

  const resetWeights = async () => {
    // Already on defaults: only a local draft needs clearing — no write, no
    // full-project rescore.
    if (project?.riskWeights == null) {
      setWeightsDraft(null);
      return;
    }
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { riskWeights: DbNull },
      });
      setWeightsDraft(null);
      toast.success(t("weightsReset"));
      void startBackfill({ silent: true });
    } catch (error) {
      console.error("Failed to update risk settings:", error);
      toast.error(tCommon("errors.error"));
    }
  };

  // ── Criticality field ──────────────────────────────────────────────────
  const { data: templates } = useClientQueries(schema).templates.useFindMany(
    {
      where: { isDeleted: false, projects: { some: { projectId } } },
      select: {
        caseFields: {
          where: { caseField: { isDeleted: false, isEnabled: true } },
          select: {
            caseField: {
              select: {
                id: true,
                displayName: true,
                type: { select: { type: true } },
              },
            },
          },
        },
      },
    },
    { enabled: isAuthenticated }
  );
  const dropdownFields = useMemo(() => {
    const fields = new Map<number, string>();
    for (const template of templates ?? []) {
      for (const assignment of template.caseFields) {
        const field = assignment.caseField;
        if (field.type.type === "Dropdown") {
          fields.set(field.id, field.displayName);
        }
      }
    }
    return [...fields.entries()]
      .map(([id, displayName]) => ({ id, displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [templates]);

  const criticalityFieldId = project?.riskCriticalityFieldId ?? null;
  const { data: criticalityOptions } = useClientQueries(
    schema
  ).caseFieldAssignment.useFindMany(
    {
      where: {
        caseFieldId: criticalityFieldId ?? -1,
        fieldOption: { isDeleted: false },
      },
      select: {
        fieldOption: { select: { id: true, name: true, order: true } },
      },
    },
    { enabled: isAuthenticated && criticalityFieldId != null }
  );
  const orderedOptions = useMemo(() => {
    const options = (criticalityOptions ?? [])
      .map((assignment) => assignment.fieldOption)
      .sort((a, b) => a.order - b.order || a.id - b.id);
    return options.map((option, position) => ({
      name: option.name,
      weight: optionPositionWeight(position, options.length),
    }));
  }, [criticalityOptions]);

  const saveCriticalityField = async (value: string) => {
    const fieldId = value === "none" ? null : Number(value);
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: { riskCriticalityFieldId: fieldId },
      });
      toast.success(
        fieldId == null
          ? t("criticalityFieldCleared")
          : t("criticalityFieldSaved")
      );
      void startBackfill({ silent: true });
    } catch (error) {
      console.error("Failed to update risk settings:", error);
      toast.error(tCommon("errors.error"));
    }
  };

  // ── Priority weights ───────────────────────────────────────────────────
  type PriorityRow = { value: string; count: number; weight: number | null };
  const [priorityRows, setPriorityRows] = useState<PriorityRow[] | null>(null);
  const [priorityDraft, setPriorityDraft] = useState<Record<
    string,
    string
  > | null>(null);

  const loadPriorities = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/risk/priorities`);
      if (!res.ok) return;
      const body = (await res.json()) as { priorities: PriorityRow[] };
      setPriorityRows(body.priorities);
    } catch {
      // Informational; the card shows its empty state.
    }
  }, [projectId]);

  useEffect(() => {
    if (!isProjectAdmin) return;
    void loadPriorities();
  }, [isProjectAdmin, loadPriorities]);

  const priorityDraftFor = (row: PriorityRow): string =>
    priorityDraft?.[row.value] ??
    (row.weight == null ? "" : String(row.weight));
  const priorityDirty =
    priorityDraft !== null &&
    (priorityRows ?? []).some(
      (row) =>
        priorityDraftFor(row) !== (row.weight == null ? "" : String(row.weight))
    );

  const savePriorityWeights = async () => {
    if (priorityRows === null) return;
    const mapping: Record<string, number> = {};
    for (const row of priorityRows) {
      const text = priorityDraftFor(row).trim();
      if (text === "") continue;
      const parsed = Number(text);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        toast.error(t("priorityWeightsInvalid"));
        return;
      }
      if (row.value.length > MAX_PRIORITY_NAME_LENGTH) continue;
      mapping[row.value] = parsed;
    }
    try {
      await updateProject.mutateAsync({
        where: { id: projectId },
        data: {
          riskPriorityWeights:
            Object.keys(mapping).length > 0 ? mapping : DbNull,
        },
      });
      setPriorityDraft(null);
      setPriorityRows((rows) =>
        (rows ?? []).map((row) => ({
          ...row,
          weight: mapping[row.value] ?? null,
        }))
      );
      toast.success(t("priorityWeightsSaved"));
      void startBackfill({ silent: true });
    } catch (error) {
      console.error("Failed to update risk settings:", error);
      toast.error(tCommon("errors.error"));
    }
  };

  if (isAuthLoading || projectLoading || permissionsLoading) return <Loading />;
  if (!project) {
    return (
      <Card className="flex h-full w-full min-w-[400px] flex-col">
        <CardContent className="flex h-full flex-col items-center justify-center">
          <PageTitle className="mb-2">
            {tCommon("errors.projectNotFound")}
          </PageTitle>
          <p className="text-muted-foreground">
            {tCommon("errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const weightsDirty =
    weightsDraft !== null &&
    RISK_COMPONENT_KEYS.some(
      (key) => draftFor(key) !== String(savedWeights[key])
    );
  const usingDefaults = project.riskWeights == null;

  return (
    <main>
      <Card>
        <PageCardHeader
          className="w-full"
          title={tCommon("pageTitles.riskScoring")}
          helpKey="projectRiskSettings"
          description={<ProjectHeaderInfo project={project} />}
          actions={
            <Button
              variant="outline"
              className={collapsibleActionClass()}
              onClick={() => router.push(`/projects/repository/${projectId}`)}
              data-testid="risk-open-repository-button"
            >
              <ActionButtonContent icon={Gauge} label={t("openRepository")} />
            </Button>
          }
        />
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">{t("description")}</p>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-center gap-3">
                <Switch
                  id="risk-enabled-toggle"
                  checked={project.riskScoringEnabled}
                  onCheckedChange={(value) => void toggleEnabled(value)}
                  disabled={updateProject.isPending}
                  data-testid="risk-enabled-toggle"
                />
                <Label htmlFor="risk-enabled-toggle">{t("enableLabel")}</Label>
                <HelpPopover helpKey="projectRiskSettings" />
              </div>
              <p className="text-sm text-muted-foreground">
                {t("enableDescription")}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1">
                <p className="text-sm font-medium">{t("weightsTitle")}</p>
                <p className="text-sm text-muted-foreground">
                  {t("weightsDescription")}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {RISK_COMPONENT_KEYS.map((key) => (
                  <div key={key} className="flex items-center gap-2">
                    <Input
                      id={`risk-weight-${key}`}
                      type="number"
                      min={0}
                      max={MAX_RISK_WEIGHT}
                      className="h-8 w-20"
                      value={draftFor(key)}
                      onChange={(event) =>
                        setWeightsDraft((prev) => ({
                          ...(prev ?? {}),
                          [key]: event.target.value,
                        }))
                      }
                      disabled={
                        updateProject.isPending || !project.riskScoringEnabled
                      }
                      aria-label={t(`components.${key}`)}
                      data-testid={`risk-weight-${key}`}
                    />
                    <Label
                      htmlFor={`risk-weight-${key}`}
                      className="font-normal"
                    >
                      {t(`components.${key}`)}
                    </Label>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => void saveWeights()}
                  disabled={
                    !weightsDirty ||
                    updateProject.isPending ||
                    !project.riskScoringEnabled
                  }
                  data-testid="risk-weights-save"
                >
                  {tCommon("actions.save")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void resetWeights()}
                  disabled={
                    (usingDefaults && weightsDraft === null) ||
                    updateProject.isPending ||
                    !project.riskScoringEnabled
                  }
                  data-testid="risk-weights-reset"
                >
                  <Undo2 className="h-4 w-4" />
                  {t("resetDefaults")}
                </Button>
                {usingDefaults && (
                  <span className="text-sm text-muted-foreground">
                    {t("usingDefaults")}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("criticalityFieldTitle")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("criticalityFieldDescription")}
                </p>
              </div>
              <Select
                value={
                  criticalityFieldId == null
                    ? "none"
                    : String(criticalityFieldId)
                }
                onValueChange={(value) => void saveCriticalityField(value)}
                disabled={
                  updateProject.isPending || !project.riskScoringEnabled
                }
              >
                <SelectTrigger
                  className="w-64"
                  data-testid="risk-criticality-field"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {t("criticalityFieldNone")}
                  </SelectItem>
                  {dropdownFields.map((field) => (
                    <SelectItem key={field.id} value={String(field.id)}>
                      {field.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {criticalityFieldId != null && orderedOptions.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("criticalityFieldOptions")}{" "}
                  {orderedOptions
                    .map((option) => `${option.name} ${option.weight}`)
                    .join(" · ")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {t("priorityWeightsTitle")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("priorityWeightsDescription")}
                </p>
              </div>
              {priorityRows !== null && priorityRows.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("priorityWeightsEmpty")}
                </p>
              )}
              {(priorityRows ?? []).length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(priorityRows ?? []).map((row) => (
                    <div key={row.value} className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        className="h-8 w-20"
                        value={priorityDraftFor(row)}
                        placeholder="50"
                        onChange={(event) =>
                          setPriorityDraft((prev) => ({
                            ...(prev ?? {}),
                            [row.value]: event.target.value,
                          }))
                        }
                        disabled={
                          updateProject.isPending || !project.riskScoringEnabled
                        }
                        aria-label={row.value}
                        data-testid={`risk-priority-${row.value}`}
                      />
                      <Label className="font-normal">
                        {row.value}{" "}
                        <span className="text-muted-foreground">
                          {row.count > 0
                            ? t("priorityWeightsCount", { count: row.count })
                            : t("priorityWeightsUnused")}
                        </span>
                      </Label>
                    </div>
                  ))}
                </div>
              )}
              {(priorityRows ?? []).length > 0 && (
                <Button
                  onClick={() => void savePriorityWeights()}
                  disabled={
                    !priorityDirty ||
                    updateProject.isPending ||
                    !project.riskScoringEnabled
                  }
                  data-testid="risk-priority-weights-save"
                >
                  {tCommon("actions.save")}
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium">{t("backfillLabel")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("backfillDescription")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => void startBackfill()}
                  disabled={
                    starting || backfillRunning || !project.riskScoringEnabled
                  }
                  data-testid="risk-backfill-button"
                >
                  {starting || backfillRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {t("backfillLabel")}
                </Button>
              </div>
              {backfillRunning && (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="risk-backfill-status"
                >
                  {t("backfillRunning", { processed: backfill.processed ?? 0 })}
                </p>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </main>
  );
}
