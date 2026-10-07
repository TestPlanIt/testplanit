"use client";

import { ExecutionParamFields } from "@/components/automation/ExecutionParamFields";
import { useExecutionTargetChoices } from "@/components/runs/ExecuteAutomationButton";
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
import { AlertTriangle, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { updateCodeRepositoryWebhookAutoExecute } from "~/app/actions/webhook-config";
import { normalizeInputs } from "~/lib/execution/inputs";
import {
  paramValuesFromInputs,
  serializeParamValues,
  type ParamValues,
} from "~/lib/execution/params";
import { Link } from "~/lib/navigation";

export interface AutoExecuteSettings {
  autoExecuteEnabled: boolean;
  autoExecuteTargetId: number | null;
  autoExecuteRef: string | null;
  autoExecuteInputs: unknown;
}

interface Props {
  projectId: number;
  webhookConfigId: string;
  settings: AutoExecuteSettings;
  /** Refetch the inbound list after a save. */
  onChanged: () => Promise<unknown> | void;
}

/**
 * A repository webhook's "Execute automated cases" setting: once the run an
 * analysis composes exists, request its automated execution on the chosen
 * target with the chosen ref and parameters. Unavailable until the project
 * has an enabled execution target; a saved target that was deleted or
 * disabled since stays chosen, with a warning that nothing is requested.
 */
export function RepositoryWebhookAutoExecute({
  projectId,
  webhookConfigId,
  settings,
  onChanged,
}: Props) {
  const t = useTranslations("projects.settings.webhooks.codeRepos");
  const tExecute = useTranslations("automation.execute");
  const tActions = useTranslations("common.actions");

  const { data: targets, isLoading } = useExecutionTargetChoices(
    projectId,
    true
  );
  const enabledTargets = useMemo(
    () => (targets ?? []).filter((target) => target.isEnabled),
    [targets]
  );
  const savedInputs = useMemo(
    () => normalizeInputs(settings.autoExecuteInputs),
    [settings.autoExecuteInputs]
  );

  const [enabled, setEnabled] = useState(settings.autoExecuteEnabled);
  const [targetId, setTargetId] = useState(
    settings.autoExecuteTargetId ? String(settings.autoExecuteTargetId) : ""
  );
  const [ref, setRef] = useState(settings.autoExecuteRef ?? "");
  const [paramValues, setParamValues] = useState<ParamValues>({});
  const [saving, setSaving] = useState(false);
  // Any edit shows Save; a successful save hides it again.
  const [dirty, setDirty] = useState(false);

  const selected = enabledTargets.find((x) => String(x.id) === targetId);
  const params = useMemo(() => selected?.paramSchema ?? [], [selected]);
  const savedTargetMissing =
    !isLoading &&
    settings.autoExecuteEnabled &&
    settings.autoExecuteTargetId !== null &&
    !enabledTargets.some((x) => x.id === settings.autoExecuteTargetId);
  const noTargets = !isLoading && enabledTargets.length === 0;

  // Each target declares its own parameters: the saved target starts from
  // the saved inputs, any other from its defaults. Seeded once per chosen
  // target so a targets refetch does not wipe unsaved choices.
  const seededFor = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const id = selected?.id ?? null;
    if (seededFor.current === id) return;
    seededFor.current = id;
    setParamValues(
      paramValuesFromInputs(
        params,
        id !== null && id === settings.autoExecuteTargetId ? savedInputs : null
      )
    );
  }, [selected, params, settings.autoExecuteTargetId, savedInputs]);

  const inputs =
    params.length > 0 ? serializeParamValues(params, paramValues) : {};
  const draftTargetId = selected?.id ?? null;

  function toggle(on: boolean) {
    setDirty(true);
    setEnabled(on);
    if (on && !selected && enabledTargets.length === 1) {
      const only = enabledTargets[0];
      setTargetId(String(only.id));
      if (!ref.trim()) setRef(only.defaultRef ?? "");
    }
  }

  async function save() {
    setSaving(true);
    try {
      const result = await updateCodeRepositoryWebhookAutoExecute({
        projectId,
        webhookConfigId,
        enabled,
        targetId: draftTargetId ?? settings.autoExecuteTargetId,
        ref: ref.trim() || null,
        inputs: draftTargetId !== null ? inputs : savedInputs,
      });
      if (!result.success) {
        toast.error(result.error ?? t("autoExecuteSaveError"));
        return;
      }
      setDirty(false);
      await onChanged();
    } finally {
      setSaving(false);
    }
  }

  const switchDisabled = noTargets && !enabled;

  return (
    <div className="space-y-3" data-testid="webhook-repository-auto-execute">
      <Label className="flex items-start gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={switchDisabled}
          data-testid="webhook-repository-auto-execute-switch"
        />
        <span className="space-y-0.5">
          <span className="block font-medium">{t("autoExecute")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("autoExecuteHelp")}
          </span>
        </span>
      </Label>

      {noTargets && !enabled && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="webhook-repository-auto-execute-no-targets"
        >
          {t.rich("autoExecuteNoTargets", {
            link: (chunks) => (
              <Link
                href={`/projects/settings/${projectId}/automation`}
                className="underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {enabled && savedTargetMissing && !selected && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive"
          data-testid="webhook-repository-auto-execute-target-missing"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("autoExecuteTargetMissing")}</span>
        </div>
      )}

      {enabled && !noTargets && (
        <div className="space-y-3 border-s ps-4">
          <div className="space-y-1.5">
            <Label>{tExecute("target")}</Label>
            <Select
              value={selected ? targetId : ""}
              onValueChange={(value) => {
                setDirty(true);
                setTargetId(value);
              }}
            >
              <SelectTrigger data-testid="webhook-repository-auto-execute-target">
                <SelectValue placeholder={tExecute("targetPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {enabledTargets.map((target) => (
                  <SelectItem key={target.id} value={String(target.id)}>
                    {target.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`webhook-auto-execute-ref-${webhookConfigId}`}>
              {tExecute("ref")}
            </Label>
            <Input
              id={`webhook-auto-execute-ref-${webhookConfigId}`}
              value={ref}
              onChange={(e) => {
                setDirty(true);
                setRef(e.target.value);
              }}
              placeholder={selected?.defaultRef ?? ""}
              className="font-mono text-sm"
              data-testid="webhook-repository-auto-execute-ref"
            />
            <p className="text-xs text-muted-foreground">
              {tExecute("refHelp")}
            </p>
          </div>
          {params.length > 0 && (
            <ExecutionParamFields
              projectId={projectId}
              params={params}
              values={paramValues}
              onChange={(next) => {
                setDirty(true);
                setParamValues(next);
              }}
              active={enabled}
              idPrefix={`webhook-auto-execute-param-${webhookConfigId}`}
              testId="webhook-repository-auto-execute-params"
            />
          )}
        </div>
      )}

      {dirty && (
        <Button
          type="button"
          size="sm"
          onClick={() => void save()}
          disabled={saving || (enabled && !selected)}
          data-testid="webhook-repository-auto-execute-save"
        >
          <Save className="h-4 w-4" />
          <span>{tActions("save")}</span>
        </Button>
      )}
    </div>
  );
}
