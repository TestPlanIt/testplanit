"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { saveWebhookAction } from "~/app/actions/webhook-actions";
import {
  availableActionsFor,
  readCreateRunOptions,
  triggersFor,
  type WebhookActionSource,
} from "~/lib/webhooks/actions/schemas";
import type {
  WebhookActionTrigger,
  WebhookActionType,
} from "~/zenstack/models";
import {
  WebhookAutoExecuteFields,
  autoExecuteDraftFrom,
  autoExecuteFromDraft,
  type AutoExecuteDraft,
} from "./webhook-auto-execute-fields";
import { useWebhookActionLabels } from "./webhook-action-labels";
import {
  WebhookActionTrackerFilter,
  trackerFilterDraftFrom,
  trackerFilterFromDraft,
  type TrackerFilterDraft,
} from "./webhook-action-tracker-filter";
import {
  WebhookActionDraftFields,
  draftCasesDraftFrom,
  draftCasesOptionsFromDraft,
  type DraftCasesDraft,
} from "./webhook-action-draft-fields";
import { Switch } from "@/components/ui/switch";

export interface WebhookActionRow {
  id: string;
  order: number;
  isEnabled: boolean;
  trigger: WebhookActionTrigger;
  action: WebhookActionType;
  filter: unknown;
  options: unknown;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: number;
  webhookConfigId: string;
  source: WebhookActionSource;
  /** The rule being edited; absent when adding. */
  rule: WebhookActionRow | null;
  /** The branch the webhook's pushes compare against, for the push label. */
  baseBranch: string | null;
  /** Tracker webhooks: the project's issue integration, for the filter pickers. */
  integration?: { id: number; provider: string } | null;
  onSaved: () => Promise<unknown> | void;
}

/** Add or edit one rule: when this event arrives, do this. */
export function WebhookActionDialog(props: Props) {
  // Remount per open so each opening starts from the saved rule.
  if (!props.open) return null;
  return <WebhookActionDialogBody {...props} />;
}

function WebhookActionDialogBody({
  open,
  onOpenChange,
  projectId,
  webhookConfigId,
  source,
  rule,
  baseBranch,
  integration = null,
  onSaved,
}: Props) {
  const t = useTranslations("projects.settings.webhooks.actions");
  const tCodeRepos = useTranslations("projects.settings.webhooks.codeRepos");
  const tImpact = useTranslations("runs.impact.affected");
  const tCommon = useTranslations("common");
  const tActions = useTranslations("common.actions");
  const tReports = useTranslations("reports.dimensions");
  const tAuditLogs = useTranslations("admin.auditLogs");
  const labels = useWebhookActionLabels(baseBranch);

  const triggers = triggersFor(source);
  const savedRun = readCreateRunOptions(rule?.options);
  const [trigger, setTrigger] = useState<WebhookActionTrigger>(
    rule?.trigger ?? triggers[0]
  );
  const [action, setAction] = useState<WebhookActionType>(
    rule?.action ?? availableActionsFor(rule?.trigger ?? triggers[0])[0]
  );
  const [minScore, setMinScore] = useState(
    savedRun.minScore === undefined ? "" : String(savedRun.minScore)
  );
  const [autoExecute, setAutoExecute] = useState<AutoExecuteDraft>(
    autoExecuteDraftFrom(savedRun.autoExecute)
  );
  const [filter, setFilter] = useState<TrackerFilterDraft>(
    trackerFilterDraftFrom(rule?.filter)
  );
  const [includeChildIssues, setIncludeChildIssues] = useState(
    savedRun.includeChildIssues === true
  );
  const [draft, setDraft] = useState<DraftCasesDraft>(
    draftCasesDraftFrom(rule?.action === "DRAFT_CASES" ? rule.options : null)
  );
  const [saving, setSaving] = useState(false);

  const actions = availableActionsFor(trigger);
  const isRepository = source === "repository";

  function chooseTrigger(next: WebhookActionTrigger) {
    setTrigger(next);
    if (!availableActionsFor(next).includes(action)) {
      setAction(availableActionsFor(next)[0]);
    }
  }

  async function save() {
    // Start from what the rule already stores so options this dialog
    // doesn't edit survive the save.
    const options: Record<string, unknown> =
      rule &&
      rule.action === action &&
      rule.options &&
      typeof rule.options === "object"
        ? { ...(rule.options as Record<string, unknown>) }
        : {};
    if (action === "CREATE_RUN") {
      delete options.minScore;
      delete options.autoExecute;
      delete options.includeChildIssues;
      if (!isRepository && includeChildIssues) {
        options.includeChildIssues = true;
      }
      if (isRepository && minScore.trim() !== "") {
        const parsed = Number(minScore.trim());
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
          toast.error(tCodeRepos("minScoreInvalid"));
          return;
        }
        options.minScore = parsed;
      }
      const execute = autoExecuteFromDraft(autoExecute);
      if (execute) options.autoExecute = execute;
    }
    if (action === "DRAFT_CASES") {
      for (const key of Object.keys(options)) delete options[key];
      Object.assign(options, draftCasesOptionsFromDraft(draft));
    }
    setSaving(true);
    try {
      const result = await saveWebhookAction({
        projectId,
        webhookConfigId,
        id: rule?.id,
        trigger,
        action,
        filter: isRepository ? {} : trackerFilterFromDraft(filter),
        options,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      onOpenChange(false);
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  const executeIncomplete =
    action === "CREATE_RUN" &&
    autoExecute.enabled &&
    autoExecute.targetId === null;
  const statusesMissing =
    trigger === "ISSUE_STATUS_ENTERED" && filter.statuses.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-lg"
        data-testid="webhook-action-dialog"
      >
        <DialogHeader>
          <DialogTitle>{rule ? t("editTitle") : t("addTitle")}</DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{tReports("trigger")}</Label>
            <Select
              value={trigger}
              onValueChange={(next) =>
                chooseTrigger(next as WebhookActionTrigger)
              }
            >
              <SelectTrigger data-testid="webhook-action-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {triggers.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.trigger(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {labels.triggerHelp(trigger)}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>{tAuditLogs("filterAction")}</Label>
            <Select
              value={action}
              onValueChange={(next) => setAction(next as WebhookActionType)}
              disabled={actions.length === 1}
            >
              <SelectTrigger data-testid="webhook-action-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actions.map((option) => (
                  <SelectItem key={option} value={option}>
                    {labels.action(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isRepository && (
            <WebhookActionTrackerFilter
              projectId={projectId}
              integration={integration}
              value={filter}
              onChange={setFilter}
            />
          )}

          {action === "CREATE_RUN" && !isRepository && (
            <Label className="flex items-start gap-3">
              <Switch
                checked={includeChildIssues}
                onCheckedChange={setIncludeChildIssues}
                data-testid="webhook-action-include-children"
              />
              <span className="space-y-0.5">
                <span className="block font-medium">
                  {t("includeChildIssues")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("includeChildIssuesHelp")}
                </span>
              </span>
            </Label>
          )}

          {action === "DRAFT_CASES" && !isRepository && (
            <WebhookActionDraftFields
              projectId={projectId}
              value={draft}
              onChange={setDraft}
            />
          )}

          {action === "CREATE_RUN" && isRepository && (
            <div className="space-y-1">
              <Label htmlFor="webhook-action-min-score">
                {tImpact("minScore")}
              </Label>
              <Input
                id="webhook-action-min-score"
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                className="w-28"
                data-testid="webhook-action-min-score"
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                placeholder={tCommon("fields.default")}
              />
              <p className="text-xs text-muted-foreground">
                {tCodeRepos("minScoreHelp")}
              </p>
            </div>
          )}

          {action === "CREATE_RUN" && (
            <WebhookAutoExecuteFields
              projectId={projectId}
              idPrefix={`webhook-action-${rule?.id ?? "new"}-execute`}
              savedTargetId={savedRun.autoExecute?.targetId ?? null}
              value={autoExecute}
              onChange={setAutoExecute}
            />
          )}
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
            onClick={() => void save()}
            disabled={saving || executeIncomplete || statusesMissing}
            data-testid="webhook-action-save"
          >
            {tActions("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
