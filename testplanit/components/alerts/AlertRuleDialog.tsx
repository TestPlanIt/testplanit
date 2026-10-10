"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Loader2, Server } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import {
  FolderSelect,
  transformFolders,
} from "@/components/forms/FolderSelect";
import {
  MilestoneSelect,
  transformMilestones,
} from "@/components/forms/MilestoneSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProjectIcon } from "@/components/ProjectIcon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  alertMetricsForScope,
  getAlertMetricDefinition,
  isSystemAlertMetric,
  metricUsesField,
  ALERT_RULE_LIMITS,
} from "~/lib/alerts/catalogue";
import {
  AlertBaseline,
  AlertDirection,
  AlertEvaluateOn,
  AlertMetric,
  AlertResultSource,
  AlertScopeType,
  AlertCoverageBasis,
  AlertSubjectType,
} from "~/zenstack/models";
import { schema } from "~/zenstack/schema";
import { ALL_QUEUE_NAMES } from "~/lib/queueNames";
import { useQueueDisplayName } from "@/components/admin/useQueueDisplayName";
import { AlertMetricPicker } from "./AlertMetricPicker";
import { CaseSearchSelect } from "./CaseSearchSelect";
import { TagSearchSelect } from "./TagSearchSelect";
import { NumberInput } from "@/components/ui/number-input";
import { AlertRuleSummary } from "./AlertRuleSummary";
import {
  defaultAlertRuleValues,
  formValuesToRuleData,
  ruleToFormValues,
  alertRuleFormSchema,
  valuesForMetricChange,
  type AlertRuleFormValues,
  type AlertRuleLike,
} from "./alertRuleForm";
import {
  AlertSubscribersEditor,
  type SubscriberEntry,
} from "./AlertSubscribersEditor";

export interface AlertRuleDialogRule extends AlertRuleLike {
  id: number;
  lastFiredAt?: Date | string | null;
  subscribers: Array<{ id: number; userId: string }>;
  /** Shown read-only on edit so the dialog says which project it belongs to. */
  project?: { id: number; name: string; iconUrl?: string | null };
}

interface AlertRuleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project of the rule being edited, or a preselected project on create. */
  projectId: number | null;
  /** Projects the user may create alerts in; shown as a picker on create. */
  projectOptions?: Array<{ id: number; name: string; iconUrl?: string | null }>;
  /**
   * Offer "System" beside the projects on create: a system alert watches an
   * administration-level subject (an AI budget) and belongs to no project.
   */
  allowSystem?: boolean;
  /** Null creates a new rule. */
  rule: AlertRuleDialogRule | null;
  canSubscribeOthers: boolean;
  /** Per-project answer used while the project is still being picked; null asks about a system alert. */
  canSubscribeOthersFor?: (projectId: number | null) => boolean;
  /** The visitor may change the audience but not the rule itself. */
  readOnlyRule?: boolean;
  onSaved?: () => void;
}

/** The project picker's value for a system alert. */
const SYSTEM_PROJECT_VALUE = "system";

/**
 * Create or edit an alert. The project (or System) is picked first on
 * create, then the metric decides which condition fields and scopes appear;
 * the condition is echoed back as a sentence while editing. The audience is
 * edited here as well: staged until the rule exists on create, applied
 * immediately on edit.
 */
export function AlertRuleDialog({
  open,
  onOpenChange,
  projectId: projectIdProp,
  projectOptions,
  allowSystem = false,
  rule,
  canSubscribeOthers: canSubscribeOthersProp,
  canSubscribeOthersFor,
  readOnlyRule = false,
  onSaved,
}: AlertRuleDialogProps) {
  const t = useTranslations("alerts");
  const tForm = useTranslations("alerts.form");
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");
  const queueLabel = useQueueDisplayName();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const isEdit = rule != null;
  // On edit the project is fixed: show it as the only, disabled choice.
  const projectChoices = isEdit
    ? rule.project
      ? [rule.project]
      : undefined
    : projectOptions;
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    projectIdProp
  );
  const [selectedSystem, setSelectedSystem] = useState(false);
  // A rule without a project is a system alert.
  const isSystem = rule
    ? (rule as { projectId?: number | null }).projectId == null
    : selectedSystem;
  const projectId: number | null = isSystem
    ? null
    : rule
      ? ((rule as { projectId?: number | null }).projectId ??
        projectIdProp ??
        null)
      : selectedProjectId;
  const hasProject = projectId != null;
  // Everything below the project row waits for a project or System.
  const hasTarget = isSystem || hasProject;
  const canSubscribeOthers =
    hasTarget && canSubscribeOthersFor
      ? canSubscribeOthersFor(projectId)
      : canSubscribeOthersProp;

  const form = useForm<AlertRuleFormValues>({
    resolver: standardSchemaResolver(alertRuleFormSchema),
    mode: "onBlur",
    defaultValues: rule ? ruleToFormValues(rule) : defaultAlertRuleValues(),
  });
  const { control, reset, handleSubmit, setValue, getValues, formState } = form;

  const metric = useWatch({ control, name: "metric" });
  const scopeType = useWatch({ control, name: "scopeType" });
  const watched = useWatch({ control });
  const definition = getAlertMetricDefinition(metric);
  const uses = (field: Parameters<typeof metricUsesField>[1]) =>
    metricUsesField(metric, field);

  // Staged audience on create; the live subscriber list on edit.
  const [stagedSubscribers, setStagedSubscribers] = useState<SubscriberEntry[]>(
    []
  );
  const [saving, setSaving] = useState(false);
  const [subscriberBusy, setSubscriberBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    reset(rule ? ruleToFormValues(rule) : defaultAlertRuleValues());
    setSelectedProjectId(projectIdProp);
    setSelectedSystem(false);
    setStagedSubscribers(
      rule
        ? []
        : currentUserId
          ? [{ userId: currentUserId, name: session?.user?.name ?? undefined }]
          : []
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rule?.id]);

  const client = useClientQueries(schema);
  const createRule = client.alertRule.useCreate();
  const updateRule = client.alertRule.useUpdate();
  const createSubscriber = client.alertSubscriber.useCreate();
  const deleteSubscriber = client.alertSubscriber.useDeleteMany();

  // Scope pickers' data, loaded only for the scope in use.
  const { data: folders } = client.repositoryFolders.useFindMany(
    {
      where: { projectId: projectId ?? -1, isDeleted: false },
      orderBy: { order: "asc" },
      select: { id: true, name: true, parentId: true },
    },
    { enabled: open && hasProject && scopeType === AlertScopeType.FOLDER }
  );
  const { data: milestones } = client.milestones.useFindMany(
    {
      where: {
        projectId: projectId ?? -1,
        isDeleted: false,
        isCompleted: false,
      },
      orderBy: { startedAt: "asc" },
      include: { milestoneType: { include: { icon: true } } },
    },
    { enabled: open && hasProject && scopeType === AlertScopeType.MILESTONE }
  );
  const { data: webhooks } = client.webhookConfig.useFindMany(
    {
      where: {
        projectId: projectId ?? -1,
        direction: "OUTBOUND",
        isActive: true,
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, url: true },
    },
    { enabled: open && hasProject && scopeType === AlertScopeType.WEBHOOK }
  );
  const { data: llmIntegrations } = client.llmIntegration.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    },
    { enabled: open && scopeType === AlertScopeType.LLM_INTEGRATION }
  );
  const { data: codeRepositories } =
    client.projectCodeRepositoryConfig.useFindMany(
      {
        where: {
          repository: { isDeleted: false },
          project: { isDeleted: false },
        },
        select: {
          id: true,
          purpose: true,
          repository: { select: { name: true } },
          project: { select: { name: true } },
        },
      },
      { enabled: open && scopeType === AlertScopeType.CODE_REPOSITORY }
    );
  const { data: integrations } = client.integration.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    },
    { enabled: open && scopeType === AlertScopeType.INTEGRATION }
  );
  const scopeId = useWatch({ control, name: "scopeId" });
  const { data: scopedTag } = client.tags.useFindUnique(
    {
      where: { id: scopeId ? Number(scopeId) : -1 },
      select: { id: true, name: true },
    },
    { enabled: open && scopeType === AlertScopeType.TAG && !!scopeId }
  );
  const { data: scopedCase } = client.repositoryCases.useFindUnique(
    {
      where: { id: scopeId ? Number(scopeId) : -1 },
      select: { id: true, name: true, automated: true },
    },
    { enabled: open && scopeType === AlertScopeType.CASE && !!scopeId }
  );

  const liveSubscribers: SubscriberEntry[] = useMemo(
    () => (rule ? rule.subscribers.map((s) => ({ userId: s.userId })) : []),
    [rule]
  );
  const subscribers = isEdit ? liveSubscribers : stagedSubscribers;

  const handleAddSubscriber = async (member: { id: string; name: string }) => {
    if (!isEdit) {
      setStagedSubscribers((list) =>
        list.some((s) => s.userId === member.id)
          ? list
          : [...list, { userId: member.id, name: member.name }]
      );
      return;
    }
    setSubscriberBusy(true);
    try {
      await createSubscriber.mutateAsync({
        data: {
          rule: { connect: { id: rule.id } },
          user: { connect: { id: member.id } },
          ...(currentUserId && currentUserId !== member.id
            ? { addedBy: { connect: { id: currentUserId } } }
            : {}),
        },
      });
      toast.success(t("toasts.subscriberAdded", { name: member.name }));
      onSaved?.();
    } catch {
      toast.error(t("toasts.subscriptionError"));
    } finally {
      setSubscriberBusy(false);
    }
  };

  const handleRemoveSubscriber = async (userId: string) => {
    if (!isEdit) {
      setStagedSubscribers((list) => list.filter((s) => s.userId !== userId));
      return;
    }
    setSubscriberBusy(true);
    try {
      await deleteSubscriber.mutateAsync({
        where: { ruleId: rule.id, userId },
      });
      onSaved?.();
    } catch {
      toast.error(t("toasts.subscriptionError"));
    } finally {
      setSubscriberBusy(false);
    }
  };

  const onSubmit = async (values: AlertRuleFormValues) => {
    setSaving(true);
    try {
      const data = formValuesToRuleData(values);
      if (isEdit) {
        // The metric is fixed once created (the evaluator keys history on it).
        const { metric: _metric, ...updatable } = data;
        await updateRule.mutateAsync({
          where: { id: rule.id },
          data: updatable,
        });
        toast.success(t("toasts.updated"));
      } else {
        if (!currentUserId || (!isSystem && projectId == null)) return;
        const created = await createRule.mutateAsync({
          data: {
            ...data,
            // A system alert has no project, and no project webhooks.
            emitWebhook: isSystem ? false : data.emitWebhook,
            ...(isSystem || projectId == null
              ? {}
              : { project: { connect: { id: projectId } } }),
            createdBy: { connect: { id: currentUserId } },
          },
        });
        if (created?.id) {
          for (const subscriber of stagedSubscribers) {
            try {
              await createSubscriber.mutateAsync({
                data: {
                  rule: { connect: { id: created.id } },
                  user: { connect: { id: subscriber.userId } },
                  ...(subscriber.userId !== currentUserId
                    ? { addedBy: { connect: { id: currentUserId } } }
                    : {}),
                },
              });
            } catch {
              toast.error(t("toasts.subscriptionError"));
            }
          }
        }
        toast.success(t("toasts.created"));
      }
      onSaved?.();
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to save alert rule", error);
      toast.error(t("toasts.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const validationMessage = (code: string | undefined) => {
    if (!code) return null;
    const limits =
      definition?.valueKind === "percent"
        ? ALERT_RULE_LIMITS.percent
        : ALERT_RULE_LIMITS.count;
    const params: Record<string, number> = {
      min: limits.min,
      max: limits.max,
    };
    switch (code) {
      case "windowRange":
        return tForm(
          "validation.windowRange",
          ALERT_RULE_LIMITS.baselineWindow
        );
      case "minSamplesRange":
        return tForm(
          "validation.minSamplesRange",
          ALERT_RULE_LIMITS.minSamples
        );
      case "cooldownRange":
        return tForm(
          "validation.cooldownRange",
          ALERT_RULE_LIMITS.cooldownMinutes
        );
      case "daysRange":
        return tForm("validation.daysRange", ALERT_RULE_LIMITS.secondaryValue);
      case "percentRange":
      case "countRange":
        return tForm(`validation.${code}`, params);
      case "scopeRequired":
      case "runNameRequired":
      case "minSamplesWindow":
      case "windowBelowMinSamples":
      case "nameRequired":
        return tForm(`validation.${code}`);
      default:
        return code;
    }
  };

  const fallbackCode: Partial<Record<keyof AlertRuleFormValues, string>> = {
    name: "nameRequired",
    thresholdValue:
      definition?.valueKind === "percent" ? "percentRange" : "countRange",
    baselineWindow: "windowRange",
    minSamples: "minSamplesRange",
    secondaryValue: "daysRange",
    cooldownMinutes: "cooldownRange",
    scopeId: "scopeRequired",
    scopeText: "runNameRequired",
  };
  const knownCodes = new Set([
    "nameRequired",
    "scopeRequired",
    "runNameRequired",
    "percentRange",
    "countRange",
    "windowRange",
    "minSamplesRange",
    "minSamplesWindow",
    "windowBelowMinSamples",
    "cooldownRange",
    "daysRange",
  ]);

  const FieldError = ({ name }: { name: keyof AlertRuleFormValues }) => {
    const error = formState.errors[name];
    if (!error) return null;
    const message =
      typeof error.message === "string" ? error.message : undefined;
    const code =
      message && knownCodes.has(message)
        ? message
        : (fallbackCode[name] ?? message ?? "");
    return (
      <p
        className="text-sm font-medium text-destructive"
        role="alert"
        data-testid={`alert-rule-error-${name}`}
      >
        {validationMessage(code)}
      </p>
    );
  };

  const scopeOptions = definition?.scopes ?? [AlertScopeType.PROJECT];
  const scopeLabel = (type: AlertScopeType) => {
    switch (definition?.subjectType) {
      case AlertSubjectType.RUN:
        return t(`scopeTypeRuns.${type}` as never);
      case AlertSubjectType.MILESTONE:
        return t(`scopeTypeMilestones.${type}` as never);
      case AlertSubjectType.SESSION:
        return t(`scopeTypeSessions.${type}` as never);
      case AlertSubjectType.WEBHOOK:
        return t(`scopeTypeWebhooks.${type}` as never);
      case AlertSubjectType.LLM_INTEGRATION:
        return t(`scopeTypeLlm.${type}` as never);
      case AlertSubjectType.CODE_REPOSITORY:
        return t(`scopeTypeCodeRepositories.${type}` as never);
      case AlertSubjectType.INTEGRATION:
        return t(`scopeTypeIntegrations.${type}` as never);
      case AlertSubjectType.QUEUE:
        return t(`scopeTypeQueues.${type}` as never);
      case AlertSubjectType.SYSTEM:
        return t(`scopeTypeSystem.${type}` as never);
      default:
        return t(`scopeType.${type}` as never);
    }
  };

  // Picking System (or leaving it) swaps to that side's metrics; the
  // metric then resets the condition and scope to its own defaults.
  const handleTargetChange = (value: string) => {
    const nextSystem = value === SYSTEM_PROJECT_VALUE;
    setSelectedSystem(nextSystem);
    setSelectedProjectId(nextSystem ? null : Number(value));
    const current = getValues();
    if (isSystemAlertMetric(current.metric) !== nextSystem) {
      const nextMetric = nextSystem
        ? (alertMetricsForScope(true)[0] ?? current.metric)
        : AlertMetric.RESULT_DURATION_DEVIATION;
      reset(valuesForMetricChange(current, nextMetric));
    } else {
      setValue("scopeType", AlertScopeType.PROJECT);
      setValue("scopeId", "");
      setValue("scopeText", "");
    }
  };
  const showTargetPicker = isEdit ? isSystem || !!projectChoices : true;
  const offerSystem = isEdit ? isSystem : allowSystem;
  // Per-metric wording for the shared numeric fields, with the generic label
  // as the fallback.
  const fieldLabel = (
    group: "windowLabels" | "minSamplesLabels" | "secondaryLabels",
    fallback: string
  ) =>
    tForm.has(`${group}.${metric}` as never)
      ? tForm(`${group}.${metric}` as never)
      : tForm(fallback as never);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[640px] lg:max-w-[880px] max-h-[90vh] overflow-y-auto"
        data-testid="alert-rule-dialog"
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? t("editRule") : t("addRule")}</DialogTitle>
          <DialogDescription>{tForm("dialogDescription")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <fieldset
              disabled={readOnlyRule}
              className="space-y-5 disabled:opacity-70"
              data-testid="alert-rule-fields"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                {showTargetPicker && (
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="alert-rule-project">
                      {tForm("project")}
                    </Label>
                    <Select
                      value={
                        isSystem
                          ? SYSTEM_PROJECT_VALUE
                          : projectId != null
                            ? String(projectId)
                            : ""
                      }
                      disabled={isEdit}
                      onValueChange={handleTargetChange}
                    >
                      <SelectTrigger
                        id="alert-rule-project"
                        data-testid="alert-rule-project"
                      >
                        <SelectValue
                          placeholder={tForm("projectPlaceholder")}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {offerSystem && (
                          <SelectItem
                            value={SYSTEM_PROJECT_VALUE}
                            data-testid="alert-project-system"
                          >
                            <span className="inline-flex items-center gap-2">
                              <Server className="h-4 w-4 text-muted-foreground" />
                              {tForm("systemScope")}
                            </span>
                          </SelectItem>
                        )}
                        {(projectChoices ?? []).map((project) => (
                          <SelectItem
                            key={project.id}
                            value={String(project.id)}
                            data-testid={`alert-project-${project.id}`}
                          >
                            <span className="inline-flex items-center gap-2">
                              <ProjectIcon iconUrl={project.iconUrl} />
                              {project.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!isEdit && (
                      <p className="text-xs text-muted-foreground">
                        {isSystem
                          ? tForm("systemScopeHelp")
                          : tForm("projectHelp")}
                      </p>
                    )}
                  </div>
                )}
                <FormField
                  control={control}
                  name="isEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0 md:mt-8">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="alert-rule-enabled"
                        />
                      </FormControl>
                      <FormLabel className="font-medium">
                        {tForm("enabled")}
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tForm("name")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={tForm("namePlaceholder")}
                          data-testid="alert-rule-name"
                        />
                      </FormControl>
                      <FieldError name="name" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={control}
                  name="metric"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{tForm("metric")}</FormLabel>
                      <FormControl>
                        <AlertMetricPicker
                          value={field.value}
                          disabled={isEdit}
                          system={isSystem}
                          onChange={(next) =>
                            reset(valuesForMetricChange(getValues(), next))
                          }
                        />
                      </FormControl>
                      <FormDescription>
                        {isEdit
                          ? tForm("metricLocked")
                          : t(`metrics.${metric}.description` as never)}
                      </FormDescription>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm("description")}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ""}
                        rows={2}
                        placeholder={tForm("descriptionPlaceholder")}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              {/* Condition */}
              <fieldset className="space-y-3 rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">
                  {tForm("condition")}
                </legend>
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="alert-rule-live-summary"
                >
                  <AlertRuleSummary
                    rule={{
                      metric,
                      thresholdValue: Number(watched.thresholdValue ?? 0),
                      secondaryValue: Number(watched.secondaryValue ?? 0),
                      direction: watched.direction ?? AlertDirection.EITHER,
                      baselineType:
                        watched.baselineType ?? AlertBaseline.MEDIAN,
                      baselineWindow: Number(watched.baselineWindow ?? 0),
                      minSamples: Number(watched.minSamples ?? 0),
                      resultSource:
                        watched.resultSource ?? AlertResultSource.BOTH,
                      evaluateOn:
                        watched.evaluateOn ?? AlertEvaluateOn.RUN_COMPLETION,
                    }}
                  />
                </p>
                <div className="grid gap-4 md:grid-cols-3">
                  {uses("thresholdValue") && (
                    <FormField
                      control={control}
                      name="thresholdValue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {tForm(`thresholdLabels.${metric}` as never)}
                          </FormLabel>
                          <FormControl>
                            <NumberInput
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={field.value}
                              onChange={field.onChange}
                              step={
                                definition?.valueKind === "percent"
                                  ? "0.1"
                                  : "1"
                              }
                              min={
                                definition?.valueKind === "percent"
                                  ? ALERT_RULE_LIMITS.percent.min
                                  : ALERT_RULE_LIMITS.count.min
                              }
                              max={
                                definition?.valueKind === "percent"
                                  ? ALERT_RULE_LIMITS.percent.max
                                  : ALERT_RULE_LIMITS.count.max
                              }
                              data-testid="alert-rule-threshold"
                            />
                          </FormControl>
                          <FieldError name="thresholdValue" />
                        </FormItem>
                      )}
                    />
                  )}
                  {uses("direction") && (
                    <FormField
                      control={control}
                      name="direction"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tForm("direction")}</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="alert-rule-direction">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.values(AlertDirection).map((value) => (
                                <SelectItem key={value} value={value}>
                                  {t(`direction.${value}` as never)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  )}
                  {uses("baselineType") && (
                    <FormField
                      control={control}
                      name="baselineType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tForm("baselineType")}</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="alert-rule-baseline">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.values(AlertBaseline).map((value) => (
                                <SelectItem key={value} value={value}>
                                  {t(`baseline.${value}` as never)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  )}
                  {uses("baselineWindow") && (
                    <FormField
                      control={control}
                      name="baselineWindow"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {fieldLabel("windowLabels", "baselineWindow")}
                          </FormLabel>
                          <FormControl>
                            <NumberInput
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={field.value}
                              onChange={field.onChange}
                              step="1"
                              min={ALERT_RULE_LIMITS.baselineWindow.min}
                              max={ALERT_RULE_LIMITS.baselineWindow.max}
                              data-testid="alert-rule-window"
                            />
                          </FormControl>
                          <FieldError name="baselineWindow" />
                        </FormItem>
                      )}
                    />
                  )}
                  {uses("minSamples") && (
                    <FormField
                      control={control}
                      name="minSamples"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {fieldLabel("minSamplesLabels", "minSamples")}
                          </FormLabel>
                          <FormControl>
                            <NumberInput
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={field.value}
                              onChange={field.onChange}
                              step="1"
                              min={ALERT_RULE_LIMITS.minSamples.min}
                              max={ALERT_RULE_LIMITS.minSamples.max}
                              data-testid="alert-rule-min-samples"
                            />
                          </FormControl>
                          <FieldError name="minSamples" />
                        </FormItem>
                      )}
                    />
                  )}
                  {uses("secondaryValue") && (
                    <FormField
                      control={control}
                      name="secondaryValue"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            {fieldLabel("secondaryLabels", "daysRemaining")}
                          </FormLabel>
                          <FormControl>
                            <NumberInput
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              value={field.value}
                              onChange={field.onChange}
                              step="1"
                              min={ALERT_RULE_LIMITS.secondaryValue.min}
                              max={ALERT_RULE_LIMITS.secondaryValue.max}
                              data-testid="alert-rule-days"
                            />
                          </FormControl>
                          <FieldError name="secondaryValue" />
                        </FormItem>
                      )}
                    />
                  )}
                  {uses("coverageBasis") && (
                    <FormField
                      control={control}
                      name="coverageBasis"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tForm("coverageBasis")}</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="alert-rule-coverage-basis">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.values(AlertCoverageBasis).map(
                                (value) => (
                                  <SelectItem key={value} value={value}>
                                    {tForm(
                                      `coverageBasisOptions.${value}` as never
                                    )}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  )}
                  {uses("resultSource") && (
                    <FormField
                      control={control}
                      name="resultSource"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tForm("resultSource")}</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="alert-rule-source">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.values(AlertResultSource).map((value) => (
                                <SelectItem key={value} value={value}>
                                  {t(`resultSource.${value}` as never)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  )}
                  {uses("evaluateOn") && (
                    <FormField
                      control={control}
                      name="evaluateOn"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tForm("evaluateOn")}</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="alert-rule-evaluate-on">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {Object.values(AlertEvaluateOn).map((value) => (
                                <SelectItem key={value} value={value}>
                                  {t(`evaluateOn.${value}` as never)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </fieldset>

              {/* Scope */}
              <fieldset
                className="space-y-3 rounded-md border p-4"
                disabled={!hasTarget}
              >
                <legend className="px-1 text-sm font-medium">
                  {tForm("scope")}
                </legend>
                {!hasTarget && (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="alert-rule-scope-needs-project"
                  >
                    {tForm("needsProject")}
                  </p>
                )}
                {hasTarget && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={control}
                      name="scopeType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{tForm("scopeType")}</FormLabel>
                          <Select
                            value={field.value}
                            onValueChange={(value) => {
                              field.onChange(value);
                              setValue("scopeId", "");
                              setValue("scopeText", "");
                            }}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="alert-rule-scope-type">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {scopeOptions.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {scopeLabel(type)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                    {scopeType === AlertScopeType.FOLDER && (
                      <FormField
                        control={control}
                        name="scopeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tForm("scopeFolder")}</FormLabel>
                            <FormControl>
                              <FolderSelect
                                value={field.value || null}
                                onChange={(value) =>
                                  field.onChange(value ? String(value) : "")
                                }
                                folders={transformFolders(folders ?? [])}
                                isLoading={!folders}
                                placeholder={tForm("scopePickFolder")}
                                ariaLabel={tForm("scopeFolder")}
                              />
                            </FormControl>
                            <FieldError name="scopeId" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.TAG && (
                      <FormField
                        control={control}
                        name="scopeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tForm("scopeTag")}</FormLabel>
                            <FormControl>
                              <TagSearchSelect
                                value={
                                  field.value && scopedTag ? scopedTag : null
                                }
                                onChange={(option) =>
                                  field.onChange(
                                    option ? String(option.id) : ""
                                  )
                                }
                                placeholder={tForm("scopePickTag")}
                              />
                            </FormControl>
                            <FieldError name="scopeId" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.CASE && (
                      <FormField
                        control={control}
                        name="scopeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tForm("scopeCase")}</FormLabel>
                            <FormControl>
                              <CaseSearchSelect
                                projectId={projectId ?? -1}
                                value={
                                  field.value && scopedCase ? scopedCase : null
                                }
                                onChange={(option) =>
                                  field.onChange(
                                    option ? String(option.id) : ""
                                  )
                                }
                                placeholder={tForm("scopeCaseSearch")}
                              />
                            </FormControl>
                            <FieldError name="scopeId" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.MILESTONE && (
                      <FormField
                        control={control}
                        name="scopeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tForm("scopeMilestone")}</FormLabel>
                            <FormControl>
                              <MilestoneSelect
                                value={field.value || null}
                                onChange={(value) =>
                                  field.onChange(value ? String(value) : "")
                                }
                                milestones={transformMilestones(
                                  milestones ?? []
                                )}
                                isLoading={!milestones}
                                placeholder={tForm("scopePickMilestone")}
                              />
                            </FormControl>
                            <FieldError name="scopeId" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.WEBHOOK && (
                      <FormField
                        control={control}
                        name="scopeText"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tForm("scopeWebhook")}</FormLabel>
                            <Select
                              value={field.value || ""}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="alert-rule-scope-webhook">
                                  <SelectValue
                                    placeholder={tForm("scopePickWebhook")}
                                  />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {(webhooks ?? []).map((config) => (
                                  <SelectItem key={config.id} value={config.id}>
                                    {config.name || config.url || config.id}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldError name="scopeText" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.LLM_INTEGRATION && (
                      <FormField
                        control={control}
                        name="scopeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {tForm("scopeLlmIntegration")}
                            </FormLabel>
                            <Select
                              value={field.value || ""}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="alert-rule-scope-llm-integration">
                                  <SelectValue
                                    placeholder={tForm(
                                      "scopePickLlmIntegration"
                                    )}
                                  />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {(llmIntegrations ?? []).map((integration) => (
                                  <SelectItem
                                    key={integration.id}
                                    value={String(integration.id)}
                                  >
                                    {integration.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldError name="scopeId" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.CODE_REPOSITORY && (
                      <FormField
                        control={control}
                        name="scopeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              {tForm("scopeCodeRepository")}
                            </FormLabel>
                            <Select
                              value={field.value || ""}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="alert-rule-scope-code-repository">
                                  <SelectValue
                                    placeholder={tForm(
                                      "scopePickCodeRepository"
                                    )}
                                  />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {(codeRepositories ?? []).map((config) => (
                                  <SelectItem
                                    key={config.id}
                                    value={String(config.id)}
                                  >
                                    {`${config.repository?.name ?? config.id} · ${config.project?.name ?? ""} (${config.purpose})`}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldError name="scopeId" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.INTEGRATION && (
                      <FormField
                        control={control}
                        name="scopeId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tForm("scopeIntegration")}</FormLabel>
                            <Select
                              value={field.value || ""}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="alert-rule-scope-integration">
                                  <SelectValue
                                    placeholder={tForm("scopePickIntegration")}
                                  />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {(integrations ?? []).map((integration) => (
                                  <SelectItem
                                    key={integration.id}
                                    value={String(integration.id)}
                                  >
                                    {integration.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldError name="scopeId" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.QUEUE && (
                      <FormField
                        control={control}
                        name="scopeText"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tForm("scopeQueue")}</FormLabel>
                            <Select
                              value={field.value || ""}
                              onValueChange={field.onChange}
                            >
                              <FormControl>
                                <SelectTrigger data-testid="alert-rule-scope-queue">
                                  <SelectValue
                                    placeholder={tForm("scopePickQueue")}
                                  />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {ALL_QUEUE_NAMES.map((name) => (
                                  <SelectItem key={name} value={name}>
                                    {queueLabel(name)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FieldError name="scopeText" />
                          </FormItem>
                        )}
                      />
                    )}
                    {scopeType === AlertScopeType.RUN_NAME && (
                      <FormField
                        control={control}
                        name="scopeText"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{tForm("scopeRunName")}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value ?? ""}
                                placeholder={tForm("scopeRunNamePlaceholder")}
                                data-testid="alert-rule-scope-text"
                              />
                            </FormControl>
                            <FieldError name="scopeText" />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>
                )}
              </fieldset>

              {/* Delivery */}
              <fieldset className="space-y-3 rounded-md border p-4">
                <legend className="px-1 text-sm font-medium">
                  {tForm("delivery")}
                </legend>
                <div className="space-y-4">
                  <FormField
                    control={control}
                    name="cooldownMinutes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1">
                          {tForm("cooldown")}
                          <HelpPopover
                            helpKey={`## ${tForm("cooldown")}\n${tForm("cooldownHelp")}`}
                          />
                        </FormLabel>
                        <FormControl>
                          <NumberInput
                            name={field.name}
                            ref={field.ref}
                            onBlur={field.onBlur}
                            value={field.value}
                            onChange={field.onChange}
                            step="1"
                            min={ALERT_RULE_LIMITS.cooldownMinutes.min}
                            max={ALERT_RULE_LIMITS.cooldownMinutes.max}
                            data-testid="alert-rule-cooldown"
                            className="md:w-64"
                          />
                        </FormControl>
                        <FieldError name="cooldownMinutes" />
                      </FormItem>
                    )}
                  />
                  {/* Outbound webhooks are a project's; a system alert has none. */}
                  {!isSystem && (
                    <FormField
                      control={control}
                      name="emitWebhook"
                      render={({ field }) => (
                        <FormItem className="flex items-center gap-2 space-y-0">
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="alert-rule-webhook"
                            />
                          </FormControl>
                          <FormLabel className="flex items-center gap-1 font-medium">
                            {tForm("emitWebhook")}
                            <HelpPopover
                              helpKey={`## ${tForm("emitWebhook")}\n${tForm("emitWebhookHelp")}`}
                            />
                          </FormLabel>
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              </fieldset>
            </fieldset>

            {/* Audience */}
            <fieldset
              className="space-y-3 rounded-md border p-4"
              disabled={!hasTarget}
            >
              <legend className="px-1 text-sm font-medium">
                {tForm("audience")}
              </legend>
              <p className="text-sm text-muted-foreground">
                {isSystem ? tForm("audienceHelpSystem") : tForm("audienceHelp")}
              </p>
              {!hasTarget ? (
                <p className="text-sm text-muted-foreground">
                  {tForm("needsProject")}
                </p>
              ) : (
                <AlertSubscribersEditor
                  projectId={isSystem ? null : (projectId ?? -1)}
                  creatorId={
                    rule
                      ? ((rule as { createdById?: string }).createdById ?? null)
                      : currentUserId
                  }
                  subscribers={subscribers}
                  currentUserId={currentUserId}
                  canManageOthers={canSubscribeOthers}
                  busy={subscriberBusy || saving}
                  onAdd={handleAddSubscriber}
                  onRemove={handleRemoveSubscriber}
                />
              )}
            </fieldset>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                {tCommon("cancel")}
              </Button>
              {!readOnlyRule && (
                <Button
                  type="submit"
                  disabled={saving || !hasTarget}
                  data-testid="alert-rule-submit"
                >
                  {saving && <Loader2 className="animate-spin" />}
                  {isEdit ? tActions("save") : tActions("create")}
                </Button>
              )}
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
