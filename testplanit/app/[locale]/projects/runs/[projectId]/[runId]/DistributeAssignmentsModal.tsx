"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DurationDisplay } from "@/components/DurationDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { MultiAsyncCombobox } from "@/components/ui/multi-async-combobox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  distributeRunCaseAssignments,
  type DistributeAssignmentsResult,
} from "~/app/actions/distributeRunCaseAssignments";
import { searchProjectMembers } from "~/app/actions/searchProjectMembers";
import {
  buildConfigurationGroupMemberLabels,
  buildConfigurationGroupWhere,
  isConfigurationGroupQueryEnabled,
} from "~/lib/configurationGroupSwitcher";
import type {
  DistributePlan,
  DistributeStrategy,
  ReassignMode,
  WeightBy,
} from "~/lib/services/distributeAssignments";

interface UserOption {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}

interface DistributeAssignmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  runId: number;
  configurationGroupId: string | null;
  onDone?: () => void;
}

type Scope = "THIS_RUN" | "ALL_CONFIGS";

export function DistributeAssignmentsModal({
  isOpen,
  onClose,
  projectId,
  runId,
  configurationGroupId,
  onDone,
}: DistributeAssignmentsModalProps) {
  const t = useTranslations();

  const errorMessage = (error: string): string => {
    switch (error) {
      case "runCompleted":
        return t("runs.distribute.errorRunCompleted");
      case "needUsers":
        return t("runs.distribute.errorNeedUsers");
      case "noAssignable":
        return t("runs.distribute.errorNoAssignable");
      default:
        return t("runs.distribute.errorGeneric");
    }
  };

  const [selectedUsers, setSelectedUsers] = useState<UserOption[]>([]);

  // MultiAsyncCombobox refetches whenever `fetchOptions` changes identity, so an
  // inline arrow would refetch on every render of this component.
  const fetchMemberOptions = useCallback(
    (query: string, page: number, pageSize: number) =>
      searchProjectMembers(projectId, query, page, pageSize),
    [projectId]
  );

  const [scope, setScope] = useState<Scope>("ALL_CONFIGS");
  const [strategy, setStrategy] =
    useState<DistributeStrategy>("SPLIT_BY_CONFIG");
  const [groupBySections, setGroupBySections] = useState(true);
  const [reassignMode, setReassignMode] =
    useState<ReassignMode>("ONLY_UNASSIGNED");
  const [weightBy, setWeightBy] = useState<WeightBy>("ESTIMATE");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [plan, setPlan] = useState<DistributePlan | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Reset state each time the modal opens.
  useEffect(() => {
    if (isOpen) {
      setSelectedUsers([]);
      setScope("ALL_CONFIGS");
      setStrategy("SPLIT_BY_CONFIG");
      setGroupBySections(true);
      setReassignMode("ONLY_UNASSIGNED");
      setWeightBy("ESTIMATE");
      setPlan(null);
      setPreviewError(null);
    }
  }, [isOpen]);

  // Sibling runs when this run is part of a group. Group membership is
  // editable, so the query is scoped to this run's project — a stale or
  // hand-written group id must not reach into another project.
  const siblingQueryScope = { configurationGroupId, projectId };

  const { data: siblingRuns } = useClientQueries(schema).testRuns.useFindMany(
    {
      where: {
        ...buildConfigurationGroupWhere(siblingQueryScope),
        // Completed runs can't be modified — exclude them so "All
        // configurations" never blocks on a finished sibling config.
        isCompleted: false,
      },
      select: {
        id: true,
        name: true,
        configuration: { select: { id: true, name: true } },
      },
      // Members may share a configuration, so break ties on id for a stable
      // column order.
      orderBy: [{ configuration: { name: "asc" } }, { id: "asc" }],
    },
    { enabled: isOpen && isConfigurationGroupQueryEnabled(siblingQueryScope) }
  );

  const hasConfigGroup =
    !!configurationGroupId && (siblingRuns?.length ?? 0) > 1;

  const runIds = useMemo(() => {
    if (hasConfigGroup && scope === "ALL_CONFIGS" && siblingRuns) {
      return siblingRuns.map((r) => r.id);
    }
    return [runId];
  }, [hasConfigGroup, scope, siblingRuns, runId]);

  // Two runs in a group may share a configuration, so the column headers fall
  // back to the run name whenever the configuration alone is ambiguous.
  const configLabelByRun = useMemo(
    () =>
      buildConfigurationGroupMemberLabels(siblingRuns ?? [], {
        noConfiguration: t("common.labels.noConfiguration"),
        withMemberName: (values) =>
          t("common.labels.configurationWithName", values),
      }),
    [siblingRuns, t]
  );

  const effectiveStrategy: DistributeStrategy = hasConfigGroup
    ? strategy
    : "KEEP_CONFIGS_TOGETHER";

  // Debounced live preview via the same server action used to commit.
  useEffect(() => {
    if (!isOpen || selectedUsers.length === 0) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    setIsPreviewLoading(true);
    const handle = setTimeout(async () => {
      const result = await distributeRunCaseAssignments({
        runIds,
        projectId,
        options: {
          userIds: selectedUsers.map((u) => u.id),
          strategy: effectiveStrategy,
          groupBySections,
          reassignMode,
          weightBy,
        },
        dryRun: true,
      });
      if (cancelled) return;
      setPlan(result.success ? result.plan : null);
      setPreviewError(result.success ? null : result.error);
      setIsPreviewLoading(false);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [
    isOpen,
    selectedUsers,
    runIds,
    projectId,
    effectiveStrategy,
    groupBySections,
    reassignMode,
    weightBy,
  ]);

  const showEffort = plan?.hasEstimates ?? false;
  const showConfigColumns = runIds.length > 1;

  // Fixed widths (px) for the two pinned columns so the Cases column's sticky
  // `left` offset lines up exactly with the Team Member column's real width.
  const MEMBER_W = 210;
  const CASES_W = 72;

  const perUserById = useMemo(() => {
    const map = new Map<
      string,
      { caseCount: number; weight: number; effort: number }
    >();
    for (const p of plan?.perUser ?? []) {
      map.set(p.userId, {
        caseCount: p.caseCount,
        weight: p.weight,
        effort: p.effort,
      });
    }
    return map;
  }, [plan]);

  const configCountFor = (userId: string, rid: number): number =>
    plan?.perUserPerConfig.find((p) => p.userId === userId && p.runId === rid)
      ?.count ?? 0;

  const handleDistribute = async () => {
    setIsSubmitting(true);
    try {
      const result: DistributeAssignmentsResult =
        await distributeRunCaseAssignments({
          runIds,
          projectId,
          options: {
            userIds: selectedUsers.map((u) => u.id),
            strategy: effectiveStrategy,
            groupBySections,
            reassignMode,
            weightBy,
          },
          dryRun: false,
        });

      if (result.success) {
        toast.success(
          t("runs.distribute.success", {
            count: result.plan.assignments.length,
            users: selectedUsers.length,
          })
        );
        onDone?.();
        onClose();
      } else {
        toast.error(errorMessage(result.error));
      }
    } catch (error) {
      console.error("Error distributing assignments:", error);
      toast.error(t("runs.distribute.errorGeneric"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={`max-h-[85vh] overflow-y-auto ${
          showConfigColumns ? "sm:max-w-[840px]" : "sm:max-w-[560px]"
        }`}
      >
        <DialogHeader>
          <DialogTitle>{t("runs.distribute.title")}</DialogTitle>
          <DialogDescription>
            {t("runs.distribute.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2 min-w-0">
          {/* Team members */}
          <div className="grid gap-2">
            <Label>{t("runs.distribute.selectUsers")}</Label>
            <MultiAsyncCombobox<UserOption>
              value={selectedUsers}
              onValueChange={setSelectedUsers}
              fetchOptions={fetchMemberOptions}
              renderOption={(user) => (
                <UserNameCell userId={user.id} hideLink />
              )}
              renderSelectedOption={(user) => <span>{user.name}</span>}
              getOptionValue={(user) => user.id}
              getOptionLabel={(user) => user.name}
              placeholder={t("runs.distribute.usersPlaceholder")}
              disabled={isSubmitting}
              className="w-full"
              pageSize={20}
              showTotal
            />
          </div>

          {/* Scope (multi-config only) */}
          {hasConfigGroup && (
            <div className="grid gap-2">
              <Label>{t("common.fields.configurations")}</Label>
              <RadioGroup
                value={scope}
                onValueChange={(v) => setScope(v as Scope)}
                className="gap-2"
                disabled={isSubmitting}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="ALL_CONFIGS"
                    id="distribute-scope-all"
                  />
                  <Label
                    htmlFor="distribute-scope-all"
                    className="font-normal cursor-pointer"
                  >
                    {t("runs.distribute.scopeAllConfigs")}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="THIS_RUN" id="distribute-scope-this" />
                  <Label
                    htmlFor="distribute-scope-this"
                    className="font-normal cursor-pointer"
                  >
                    {t("runs.distribute.scopeThisRun")}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Strategy (multi-config only) */}
          {hasConfigGroup && (
            <div className="grid gap-2">
              <Label>{t("runs.distribute.strategyLabel")}</Label>
              <RadioGroup
                value={strategy}
                onValueChange={(v) => setStrategy(v as DistributeStrategy)}
                className="gap-2"
                disabled={isSubmitting}
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem
                    value="SPLIT_BY_CONFIG"
                    id="distribute-strategy-split"
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="distribute-strategy-split"
                      className="font-normal cursor-pointer block"
                    >
                      {t("runs.distribute.strategySplitByConfig")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("runs.distribute.strategySplitByConfigHint")}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem
                    value="KEEP_CONFIGS_TOGETHER"
                    id="distribute-strategy-keep"
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="distribute-strategy-keep"
                      className="font-normal cursor-pointer block"
                    >
                      {t("runs.distribute.strategyKeepTogether")}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("runs.distribute.strategyKeepTogetherHint")}
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </div>
          )}

          {/* Grouping */}
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-1">
              <Label htmlFor="distribute-grouping">
                {t("runs.distribute.groupingLabel")}
              </Label>
              <span className="text-xs text-muted-foreground">
                {t("runs.distribute.groupingHint")}
              </span>
            </div>
            <Switch
              id="distribute-grouping"
              checked={groupBySections}
              onCheckedChange={setGroupBySections}
              disabled={isSubmitting || effectiveStrategy === "SPLIT_BY_CONFIG"}
            />
          </div>

          {/* Balancing */}
          <div className="grid gap-2">
            <Label>{t("runs.distribute.balancingLabel")}</Label>
            <RadioGroup
              value={weightBy}
              onValueChange={(v) => setWeightBy(v as WeightBy)}
              className="gap-2"
              disabled={isSubmitting}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="ESTIMATE"
                  id="distribute-weight-effort"
                />
                <Label
                  htmlFor="distribute-weight-effort"
                  className="font-normal cursor-pointer"
                >
                  {t("runs.distribute.balancingEffort")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="COUNT" id="distribute-weight-count" />
                <Label
                  htmlFor="distribute-weight-count"
                  className="font-normal cursor-pointer"
                >
                  {t("runs.distribute.balancingCount")}
                </Label>
              </div>
            </RadioGroup>
            {weightBy === "ESTIMATE" && plan?.hasEstimates === false && (
              <span className="text-xs text-muted-foreground">
                {t("runs.distribute.balancingFallbackHint")}
              </span>
            )}
          </div>

          {/* Existing assignments */}
          <div className="grid gap-2">
            <Label>{t("runs.distribute.existingLabel")}</Label>
            <RadioGroup
              value={reassignMode}
              onValueChange={(v) => setReassignMode(v as ReassignMode)}
              className="gap-2"
              disabled={isSubmitting}
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="ONLY_UNASSIGNED"
                  id="distribute-existing-unassigned"
                />
                <Label
                  htmlFor="distribute-existing-unassigned"
                  className="font-normal cursor-pointer"
                >
                  {t("runs.distribute.existingOnlyUnassigned")}
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem
                  value="REASSIGN_ALL"
                  id="distribute-existing-reassign"
                />
                <Label
                  htmlFor="distribute-existing-reassign"
                  className="font-normal cursor-pointer"
                >
                  {t("runs.distribute.existingReassignAll")}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Preview */}
          <div className="grid gap-2 min-w-0">
            <Label>{t("runs.distribute.previewTitle")}</Label>
            {selectedUsers.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                {t("runs.distribute.previewNoUsers")}
              </span>
            ) : previewError ? (
              <span className="text-sm text-destructive">
                {errorMessage(previewError)}
              </span>
            ) : (
              <div className="rounded-md border min-w-0">
                <div className="w-full overflow-x-auto">
                  {/* Header row — flex cells with explicit px widths so the two
                      pinned columns' sticky offsets stay exact (auto table layout
                      redistributes widths and breaks the offset). */}
                  <div className="flex w-max min-w-full border-b bg-muted text-xs font-medium">
                    <div
                      className="sticky left-0 z-10 shrink-0 bg-muted px-3 py-2 text-start"
                      style={{ width: MEMBER_W }}
                    >
                      {t("runs.distribute.previewUser")}
                    </div>
                    <div
                      className="sticky z-10 shrink-0 border-e bg-muted px-3 py-2 text-end"
                      style={{ width: CASES_W, left: MEMBER_W }}
                    >
                      {t("runs.distribute.previewCases")}
                    </div>
                    {showEffort && (
                      <div
                        className="shrink-0 px-3 py-2 text-end"
                        style={{ width: 210 }}
                      >
                        {t("common.fields.estimate")}
                      </div>
                    )}
                    {showConfigColumns &&
                      runIds.map((rid) => {
                        const name = configLabelByRun.get(rid) ?? `#${rid}`;
                        return (
                          <Tooltip key={rid}>
                            <TooltipTrigger asChild>
                              <div
                                className="shrink-0 truncate px-3 py-2 text-end"
                                style={{ width: 168 }}
                              >
                                {name}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>{name}</TooltipContent>
                          </Tooltip>
                        );
                      })}
                    <div className="flex-1" />
                  </div>
                  {/* Body rows */}
                  <div className={isPreviewLoading ? "opacity-50" : undefined}>
                    {selectedUsers.map((user) => {
                      const stat = perUserById.get(user.id);
                      return (
                        <div
                          key={user.id}
                          className="flex w-max min-w-full border-b text-sm last:border-b-0"
                        >
                          <div
                            className="sticky left-0 z-10 shrink-0 overflow-hidden bg-background px-3 py-2"
                            style={{ width: MEMBER_W }}
                          >
                            <UserNameCell userId={user.id} hideLink />
                          </div>
                          <div
                            className="sticky z-10 shrink-0 border-e bg-background px-3 py-2 text-end"
                            style={{ width: CASES_W, left: MEMBER_W }}
                          >
                            {stat?.caseCount ?? 0}
                          </div>
                          {showEffort && (
                            <div
                              className="shrink-0 truncate px-3 py-2 text-end"
                              style={{ width: 210 }}
                            >
                              <DurationDisplay seconds={stat?.effort ?? 0} />
                            </div>
                          )}
                          {showConfigColumns &&
                            runIds.map((rid) => (
                              <div
                                key={rid}
                                className="shrink-0 px-3 py-2 text-end text-muted-foreground"
                                style={{ width: 168 }}
                              >
                                {configCountFor(user.id, rid)}
                              </div>
                            ))}
                          <div className="flex-1" />
                        </div>
                      );
                    })}
                  </div>
                </div>
                {plan && plan.skipped.length > 0 && (
                  <div className="border-t px-3 py-2 text-xs text-muted-foreground">
                    {t("runs.distribute.previewSkipped", {
                      count: plan.skipped.length,
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex justify-between">
          <div></div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              onClick={handleDistribute}
              disabled={
                isSubmitting ||
                selectedUsers.length === 0 ||
                !plan ||
                plan.assignments.length === 0
              }
            >
              {isSubmitting
                ? t("runs.distribute.confirming")
                : t("common.actions.assign")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
