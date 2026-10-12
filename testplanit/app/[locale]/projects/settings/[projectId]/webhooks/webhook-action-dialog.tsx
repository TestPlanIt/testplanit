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
  ACTIONS_BY_TRIGGER,
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
    rule?.action ?? ACTIONS_BY_TRIGGER[rule?.trigger ?? triggers[0]][0]
  );
  const [minScore, setMinScore] = useState(
    savedRun.minScore === undefined ? "" : String(savedRun.minScore)
  );
  const [autoExecute, setAutoExecute] = useState<AutoExecuteDraft>(
    autoExecuteDraftFrom(savedRun.autoExecute)
  );
  const [saving, setSaving] = useState(false);

  const actions = ACTIONS_BY_TRIGGER[trigger];
  const isRepository = source === "repository";

  function chooseTrigger(next: WebhookActionTrigger) {
    setTrigger(next);
    if (!ACTIONS_BY_TRIGGER[next].includes(action)) {
      setAction(ACTIONS_BY_TRIGGER[next][0]);
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
    setSaving(true);
    try {
      const result = await saveWebhookAction({
        projectId,
        webhookConfigId,
        id: rule?.id,
        trigger,
        action,
        filter: rule?.filter ?? {},
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
    autoExecute.enabled && autoExecute.targetId === null;

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
            disabled={saving || executeIncomplete}
            data-testid="webhook-action-save"
          >
            {tActions("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
