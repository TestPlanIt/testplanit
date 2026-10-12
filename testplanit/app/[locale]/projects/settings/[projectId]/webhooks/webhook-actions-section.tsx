"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useExecutionTargetChoices } from "@/components/runs/ExecuteAutomationButton";
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
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ArrowRight,
  GripVertical,
  Plus,
  SquarePen,
  Trash,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  deleteWebhookAction,
  reorderWebhookActions,
  setWebhookActionEnabled,
} from "~/app/actions/webhook-actions";
import { Link } from "~/lib/navigation";
import { dateFnsLocaleFor } from "~/lib/utils/dateFnsLocale";
import {
  readCreateRunOptions,
  readWebhookActionFilter,
  type WebhookActionSource,
} from "~/lib/webhooks/actions/schemas";
import { schema } from "~/zenstack/schema";
import {
  WebhookActionDialog,
  type WebhookActionRow,
} from "./webhook-action-dialog";
import { useWebhookActionLabels } from "./webhook-action-labels";

interface Props {
  projectId: number;
  webhookConfigId: string;
  source: WebhookActionSource;
  baseBranch: string | null;
  /** Tracker webhooks: the project's issue integration, for the filter pickers. */
  integration?: { id: number; provider: string } | null;
}

/** One rule row that can be dragged by its handle; the row's own controls stay clickable. */
function SortableRuleRow({
  id,
  handleLabel,
  children,
}: {
  id: string;
  handleLabel: string;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-start gap-3 bg-background px-3 py-2 ${
        isDragging ? "relative z-10 shadow-md" : ""
      }`}
      data-testid={`webhook-action-row-${id}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="mt-0.5 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        aria-label={handleLabel}
        data-testid={`webhook-action-drag-${id}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {children}
    </li>
  );
}

interface LogRow {
  webhookActionId: string | null;
  outcome: string;
  testRunId: number | null;
  createdAt: Date | string;
}

/**
 * The rules on one inbound webhook, in the order they run: when an event
 * arrives, each enabled rule whose trigger matches performs its action.
 * Each row shows what the rule last did.
 */
export function WebhookActionsSection({
  projectId,
  webhookConfigId,
  source,
  baseBranch,
  integration = null,
}: Props) {
  const t = useTranslations("projects.settings.webhooks.actions");
  const tActions = useTranslations("common.actions");
  const tCommon = useTranslations("common");
  const tImpact = useTranslations("runs.impact.affected");
  const tWebhooks = useTranslations("projects.settings.webhooks");
  const tLabels = useTranslations("common.labels");
  const tExecute = useTranslations("automation.execute");
  const tCodeRepos = useTranslations("projects.settings.webhooks.codeRepos");
  const tRequirements = useTranslations(
    "projects.settings.integrations.integration.requirementsConfig"
  );
  const tDuplicates = useTranslations("repository.duplicates");
  const tMapping = useTranslations("admin.imports.testmo.mapping");
  const locale = useLocale();
  const labels = useWebhookActionLabels(baseBranch);

  const queries = useClientQueries(schema);
  const { data: rulesData, refetch } = queries.webhookAction.useFindMany({
    where: { webhookConfigId },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      order: true,
      isEnabled: true,
      trigger: true,
      action: true,
      filter: true,
      options: true,
    },
  });
  const { data: logsData } = queries.webhookActionLog.useFindMany({
    where: { webhookConfigId, webhookActionId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      webhookActionId: true,
      outcome: true,
      testRunId: true,
      createdAt: true,
    },
  });
  const { data: targets } = useExecutionTargetChoices(projectId, true);

  const savedRules = (rulesData ?? []) as WebhookActionRow[];
  // The dropped order shows at once; the saved order takes over after refetch.
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const rules = pendingOrder
    ? (pendingOrder
        .map((id) => savedRules.find((rule) => rule.id === id))
        .filter(Boolean) as WebhookActionRow[])
    : savedRules;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const lastLog = new Map<string, LogRow>();
  for (const log of (logsData ?? []) as LogRow[]) {
    if (log.webhookActionId && !lastLog.has(log.webhookActionId)) {
      lastLog.set(log.webhookActionId, log);
    }
  }

  const [dialogRule, setDialogRule] = useState<WebhookActionRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteRule, setDeleteRule] = useState<WebhookActionRow | null>(null);

  function openDialog(rule: WebhookActionRow | null) {
    setDialogRule(rule);
    setDialogOpen(true);
  }

  async function toggle(rule: WebhookActionRow, isEnabled: boolean) {
    const result = await setWebhookActionEnabled({
      projectId,
      id: rule.id,
      isEnabled,
    });
    if (!result.success) toast.error(result.error);
    await refetch();
  }

  async function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = rules.map((rule) => rule.id);
    const next = arrayMove(
      ids,
      ids.indexOf(String(active.id)),
      ids.indexOf(String(over.id))
    );
    setPendingOrder(next);
    try {
      const result = await reorderWebhookActions({
        projectId,
        webhookConfigId,
        orderedIds: next,
      });
      if (!result.success) toast.error(result.error);
      await refetch();
    } finally {
      setPendingOrder(null);
    }
  }

  async function remove() {
    if (!deleteRule) return;
    const result = await deleteWebhookAction({ projectId, id: deleteRule.id });
    setDeleteRule(null);
    if (!result.success) toast.error(result.error);
    await refetch();
  }

  function details(
    rule: WebhookActionRow
  ): { label: string; problem?: string }[] {
    const out: { label: string; problem?: string }[] = [];
    const filter = readWebhookActionFilter(rule.filter);
    if (filter.statuses?.length) {
      out.push({
        label: `${tCommon("labels.statuses")}: ${filter.statuses.join(", ")}`,
      });
    }
    if (filter.issueTypeIds?.length) {
      out.push({
        label: `${tRequirements("issueTypesLabel")}: ${filter.issueTypeIds
          .map((id) => filter.issueTypeNames?.[id] ?? id)
          .join(", ")}`,
      });
    }
    if (filter.labels?.length) {
      out.push({
        label: `${tRequirements("labelsLabel")}: ${filter.labels.join(", ")}`,
      });
    }
    if (filter.requirementsOnly) out.push({ label: t("requirementsOnly") });
    if (rule.action !== "CREATE_RUN") return out;
    const options = readCreateRunOptions(rule.options);
    if (options.includeChildIssues) {
      out.push({ label: t("includeChildIssues") });
    }
    if (options.minScore !== undefined) {
      out.push({ label: `${tImpact("minScore")}: ${options.minScore}` });
    }
    if (options.autoExecute) {
      const target = targets?.find(
        (x) => x.id === options.autoExecute!.targetId
      );
      out.push({
        label: `${tExecute("target")}: ${target?.name ?? "—"}`,
        // Only once the targets have loaded, so a slow list never flags one.
        problem:
          targets && !target?.isEnabled
            ? tCodeRepos("autoExecuteTargetMissing")
            : undefined,
      });
    }
    return out;
  }

  function outcomeLabel(outcome: string): string {
    switch (outcome) {
      case "run_created":
        return tWebhooks("events.testRunCreated");
      case "issue_imported":
        return tWebhooks("events.issueCreated");
      case "no_cases":
        return tLabels("noCases");
      case "no_workflow":
        return tMapping("noWorkflowsAvailable");
      case "error":
        return tWebhooks("filterStatusFailed");
      case "already_composed":
      case "execute_failed":
        return t(`outcome.${outcome}`);
      default:
        return outcome;
    }
  }

  function renderLastLog(rule: WebhookActionRow) {
    const log = lastLog.get(rule.id);
    return (
      <span
        className="text-xs text-muted-foreground"
        data-testid={`webhook-action-last-${rule.id}`}
      >
        {tDuplicates("lastRunLabel")}:{" "}
        {log ? (
          <>
            {formatDistanceToNow(new Date(log.createdAt), {
              addSuffix: true,
              locale: dateFnsLocaleFor(locale),
            })}
            {" · "}
            {outcomeLabel(log.outcome)}
            {log.testRunId && (
              <>
                {" · "}
                <Link
                  href={`/projects/runs/${projectId}/${log.testRunId}`}
                  className="underline"
                >
                  {tLabels("viewTestRunDetails")}
                </Link>
              </>
            )}
          </>
        ) : (
          tCommon("never")
        )}
      </span>
    );
  }

  return (
    <div
      className="space-y-3"
      data-testid={`webhook-actions-${webhookConfigId}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{tActions("actionsLabel")}</div>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => openDialog(null)}
          data-testid="webhook-action-add"
        >
          <Plus className="h-4 w-4" />
          <span>{tCommon("add")}</span>
        </Button>
      </div>

      {rules.length === 0 ? (
        <p
          className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
          data-testid="webhook-actions-empty"
        >
          {t("empty")}
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={(event) => void handleDragEnd(event)}
        >
          <SortableContext
            items={rules.map((rule) => rule.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="divide-y rounded-md border">
              {rules.map((rule) => (
                <SortableRuleRow
                  key={rule.id}
                  id={rule.id}
                  handleLabel={t("dragToReorder")}
                >
                  <Switch
                    checked={rule.isEnabled}
                    onCheckedChange={(on: boolean) => void toggle(rule, on)}
                    aria-label={tCommon("fields.enabled")}
                    className="mt-0.5"
                    data-testid={`webhook-action-enabled-${rule.id}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span>{labels.trigger(rule.trigger)}</span>
                      <ArrowRight
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="font-medium">
                        {labels.action(rule.action)}
                      </span>
                    </div>
                    {details(rule).length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {details(rule).map((detail) =>
                          detail.problem ? (
                            <Tooltip key={detail.label}>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant="destructive"
                                  tabIndex={0}
                                  data-testid={`webhook-action-problem-${rule.id}`}
                                >
                                  <AlertTriangle
                                    className="me-1 h-3 w-3"
                                    aria-hidden="true"
                                  />
                                  {detail.label}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                {detail.problem}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <Badge key={detail.label} variant="secondary">
                              {detail.label}
                            </Badge>
                          )
                        )}
                      </div>
                    )}
                    {renderLastLog(rule)}
                  </div>
                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => openDialog(rule)}
                      aria-label={tActions("edit")}
                      data-testid={`webhook-action-edit-${rule.id}`}
                    >
                      <SquarePen className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteRule(rule)}
                      aria-label={tActions("delete")}
                      data-testid={`webhook-action-delete-${rule.id}`}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </SortableRuleRow>
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <WebhookActionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projectId={projectId}
        webhookConfigId={webhookConfigId}
        source={source}
        rule={dialogRule}
        baseBranch={baseBranch}
        integration={integration}
        onSaved={refetch}
      />

      <AlertDialog
        open={deleteRule !== null}
        onOpenChange={(open) => !open && setDeleteRule(null)}
      >
        <AlertDialogContent data-testid="webhook-action-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{tActions("confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRule &&
                tCommon("dialogs.delete.description", {
                  name: `${labels.trigger(deleteRule.trigger)} → ${labels.action(deleteRule.action)}`,
                })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void remove()}
              data-testid="webhook-action-delete-confirm"
            >
              {tActions("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
