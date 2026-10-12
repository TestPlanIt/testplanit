"use client";

import { ExecutionParamFields } from "@/components/automation/ExecutionParamFields";
import { useExecutionTargetChoices } from "@/components/runs/ExecuteAutomationButton";
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
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  paramValuesFromInputs,
  serializeParamValues,
  type ParamValues,
} from "~/lib/execution/params";
import { Link } from "~/lib/navigation";
import type { AutoExecuteOptions } from "~/lib/webhooks/actions/schemas";

export interface AutoExecuteDraft {
  enabled: boolean;
  targetId: number | null;
  ref: string;
  inputs: Record<string, string>;
}

export function autoExecuteDraftFrom(
  saved: AutoExecuteOptions | null | undefined
): AutoExecuteDraft {
  return {
    enabled: Boolean(saved),
    targetId: saved?.targetId ?? null,
    ref: saved?.ref ?? "",
    inputs: saved?.inputs ?? {},
  };
}

/** The stored option, or null when execution is off. */
export function autoExecuteFromDraft(
  draft: AutoExecuteDraft
): AutoExecuteOptions | null {
  if (!draft.enabled || draft.targetId === null) return null;
  return {
    targetId: draft.targetId,
    ...(draft.ref.trim() ? { ref: draft.ref.trim() } : {}),
    ...(Object.keys(draft.inputs).length > 0 ? { inputs: draft.inputs } : {}),
  };
}

interface Props {
  projectId: number;
  idPrefix: string;
  /** The target the rule was saved with, to warn when it's gone. */
  savedTargetId: number | null;
  value: AutoExecuteDraft;
  onChange: (next: AutoExecuteDraft) => void;
}

/**
 * A Create test run rule's "Execute automated cases" option: once the run
 * exists, request its automated execution on the chosen target with the
 * chosen ref and parameters. Unavailable until the project has an enabled
 * execution target; a saved target that was deleted or disabled since stays
 * chosen, with a warning that nothing is requested.
 */
export function WebhookAutoExecuteFields({
  projectId,
  idPrefix,
  savedTargetId,
  value,
  onChange,
}: Props) {
  const t = useTranslations("projects.settings.webhooks.codeRepos");
  const tExecute = useTranslations("automation.execute");

  const { data: targets, isLoading } = useExecutionTargetChoices(
    projectId,
    true
  );
  const enabledTargets = useMemo(
    () => (targets ?? []).filter((target) => target.isEnabled),
    [targets]
  );
  const selected = enabledTargets.find((x) => x.id === value.targetId);
  const params = useMemo(() => selected?.paramSchema ?? [], [selected]);
  const savedTargetMissing =
    !isLoading &&
    savedTargetId !== null &&
    !enabledTargets.some((x) => x.id === savedTargetId);
  const noTargets = !isLoading && enabledTargets.length === 0;

  // Each target declares its own parameters: the saved target starts from
  // the saved inputs, any other from its defaults. Seeded once per chosen
  // target so a targets refetch does not wipe unsaved choices.
  const [paramValues, setParamValues] = useState<ParamValues>({});
  const initialInputs = useRef(value.inputs);
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const seededFor = useRef<number | null | undefined>(undefined);
  useEffect(() => {
    const id = selected?.id ?? null;
    if (seededFor.current === id) return;
    seededFor.current = id;
    const seeded = paramValuesFromInputs(
      params,
      id !== null && id === savedTargetId ? initialInputs.current : null
    );
    setParamValues(seeded);
    if (id !== null) {
      latest.current.onChange({
        ...latest.current.value,
        inputs: params.length > 0 ? serializeParamValues(params, seeded) : {},
      });
    }
  }, [selected, params, savedTargetId]);

  // A saved target that was deleted or disabled can't be saved again: drop it
  // from the draft, and with no target left to choose turn execution off.
  useEffect(() => {
    if (isLoading) return;
    const { value: current, onChange: change } = latest.current;
    if (
      current.targetId !== null &&
      !enabledTargets.some((x) => x.id === current.targetId)
    ) {
      change({
        ...current,
        targetId: null,
        inputs: {},
        enabled: enabledTargets.length > 0 ? current.enabled : false,
      });
    }
  }, [isLoading, enabledTargets]);

  function update(next: Partial<AutoExecuteDraft>) {
    onChange({ ...value, ...next });
  }

  function toggle(on: boolean) {
    if (on && !selected && enabledTargets.length === 1) {
      const only = enabledTargets[0];
      update({
        enabled: true,
        targetId: only.id,
        ref: value.ref.trim() ? value.ref : (only.defaultRef ?? ""),
      });
      return;
    }
    update({ enabled: on });
  }

  return (
    <div className="space-y-3" data-testid="webhook-action-auto-execute">
      <Label className="flex items-start gap-3">
        <Switch
          checked={value.enabled}
          onCheckedChange={toggle}
          disabled={noTargets}
          data-testid="webhook-action-auto-execute-switch"
        />
        <span className="space-y-0.5">
          <span className="block font-medium">{t("autoExecute")}</span>
          <span className="block text-xs text-muted-foreground">
            {t("autoExecuteHelp")}
          </span>
        </span>
      </Label>

      {noTargets && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="webhook-action-auto-execute-no-targets"
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

      {savedTargetMissing && !selected && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive"
          data-testid="webhook-action-auto-execute-target-missing"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("autoExecuteTargetMissing")}</span>
        </div>
      )}

      {value.enabled && !noTargets && (
        <div className="space-y-3 border-s ps-4">
          <div className="space-y-1.5">
            <Label>{tExecute("target")}</Label>
            <Select
              value={selected ? String(selected.id) : ""}
              onValueChange={(next) =>
                update({ targetId: Number(next), inputs: {} })
              }
            >
              <SelectTrigger data-testid="webhook-action-auto-execute-target">
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
            <Label htmlFor={`${idPrefix}-ref`}>{tExecute("ref")}</Label>
            <Input
              id={`${idPrefix}-ref`}
              value={value.ref}
              onChange={(e) => update({ ref: e.target.value })}
              placeholder={selected?.defaultRef ?? ""}
              className="font-mono text-sm"
              data-testid="webhook-action-auto-execute-ref"
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
                const resolved =
                  typeof next === "function" ? next(paramValues) : next;
                setParamValues(resolved);
                update({ inputs: serializeParamValues(params, resolved) });
              }}
              active={value.enabled}
              idPrefix={`${idPrefix}-param`}
              testId="webhook-action-auto-execute-params"
            />
          )}
        </div>
      )}
    </div>
  );
}
