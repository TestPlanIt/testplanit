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
import { FilePlay, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "~/lib/navigation";
import type { ExecutionTargetChoice } from "~/app/actions/execution-targets";
import { useProjectConfigurationOptions } from "@/components/automation/ExecutionParamsEditor";
import { StaticValuesMultiSelect } from "@/components/automation/StaticValuesMultiSelect";
import {
  paramValuesFromInputs,
  serializeParamValues,
  type ParamValues,
} from "~/lib/execution/params";

/** Radix Select cannot represent "nothing chosen" as an item value. */
const NO_CONFIGURATION = "__none__";

export interface ExecuteRequest {
  targetId: number;
  ref?: string;
  /** The target's parameters as chosen; absent when it declares none. */
  inputs?: Record<string, string>;
}

/**
 * What a host's `submit` resolves with: an error message to show, null on
 * success, or the run an ad-hoc request created so the success toast can
 * offer to open it.
 */
export type ExecuteSubmitResult =
  string | null | { createdRun: { projectId: number; runId: number } };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose configurations a configuration parameter offers. */
  projectId: number;
  targets: ExecutionTargetChoice[];
  /** Automated cases the request will cover (count-first summary). */
  caseCount: number;
  /** The request names a chosen subset rather than every automated case in the run. */
  subset?: boolean;
  /** Selected rows the subset leaves out: not automated cases of this run. */
  skippedCount?: number;
  /** Run the results will attach to; shown in the note. Null for ad-hoc (a run is created). */
  runId: number | null;
  title?: string;
  description?: string;
  /**
   * Performs the request; resolve with an error message to show, null on
   * success, or the created run for the success toast to offer to open.
   */
  submit: (req: ExecuteRequest) => Promise<ExecuteSubmitResult>;
  onDispatched?: () => void;
  /** Pre-select a target (retry). */
  initialTargetId?: number | null;
  initialRef?: string | null;
  /** A retry's previous choices, seeded into the target's parameters. */
  initialInputs?: Record<string, string> | null;
}

export function ExecuteAutomationDialog({
  open,
  onOpenChange,
  projectId,
  targets,
  caseCount,
  subset = false,
  skippedCount = 0,
  runId,
  title,
  description,
  submit,
  onDispatched,
  initialTargetId,
  initialRef,
  initialInputs,
}: Props) {
  const t = useTranslations("automation.execute");
  const tCommon = useTranslations("common");
  const tSearch = useTranslations("search");
  const router = useRouter();

  const enabledTargets = useMemo(
    () => targets.filter((target) => target.isEnabled),
    [targets]
  );
  const [targetId, setTargetId] = useState<string>("");
  const [ref, setRef] = useState("");
  const [paramValues, setParamValues] = useState<ParamValues>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset only when the dialog opens; a targets refetch while it is open
  // must not wipe a server error the user is still reading.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubmitting(false);
    setTargetId("");
    setRef("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const preferred =
      (initialTargetId &&
        enabledTargets.find((x) => x.id === initialTargetId)) ||
      (enabledTargets.length === 1 ? enabledTargets[0] : null);
    setTargetId((current) =>
      current ? current : preferred ? String(preferred.id) : ""
    );
    setRef((current) =>
      current ? current : (initialRef ?? preferred?.defaultRef ?? "")
    );
  }, [open, enabledTargets, initialTargetId, initialRef]);

  const selected = enabledTargets.find((x) => String(x.id) === targetId);
  const selectedId = selected?.id ?? null;
  const params = useMemo(() => selected?.paramSchema ?? [], [selected]);
  const configurations = useProjectConfigurationOptions(
    projectId,
    open && params.some((param) => param.type === "configuration")
  );

  // Each target declares its own parameters: picking one starts from its
  // defaults, or from the previous execution's choices on a retry. Seeded
  // once per chosen target: a targets refetch while the dialog is open (the
  // run page polls) must not wipe what the user has picked.
  const seededFor = useRef<number | null>(null);
  useEffect(() => {
    if (!open) {
      seededFor.current = null;
      return;
    }
    if (selectedId === seededFor.current) return;
    seededFor.current = selectedId;
    setParamValues(
      paramValuesFromInputs(
        params,
        selectedId === initialTargetId ? initialInputs : null
      )
    );
  }, [open, params, selectedId, initialTargetId, initialInputs]);

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submit({
        targetId: selected.id,
        ref: ref.trim() || undefined,
        ...(params.length > 0
          ? { inputs: serializeParamValues(params, paramValues) }
          : {}),
      });
      if (typeof result === "string") {
        setError(result);
        return;
      }
      // One toast per request: when a run was created for it, the toast
      // is also the way to get there.
      const createdRun = result?.createdRun;
      toast.success(
        t("dispatched"),
        createdRun
          ? {
              action: {
                label: tCommon("labels.viewTestRunDetails"),
                onClick: () =>
                  router.push(
                    `/projects/runs/${createdRun.projectId}/${createdRun.runId}`
                  ),
              },
            }
          : undefined
      );
      onOpenChange(false);
      onDispatched?.();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="execute-automation-dialog">
        <DialogHeader>
          <DialogTitle>{title ?? t("title")}</DialogTitle>
          <DialogDescription>
            {description ?? t("description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("target")}</Label>
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger data-testid="execute-automation-target-select">
                <SelectValue placeholder={t("targetPlaceholder")} />
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
            <Label htmlFor="execute-automation-ref">{t("ref")}</Label>
            <Input
              id="execute-automation-ref"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder={selected?.defaultRef ?? ""}
              className="font-mono text-sm"
              data-testid="execute-automation-ref-input"
            />
            <p className="text-xs text-muted-foreground">{t("refHelp")}</p>
          </div>
          {params.length > 0 && (
            <div className="space-y-3" data-testid="execute-automation-params">
              {params.map((param) => {
                const id = `execute-automation-param-${param.name}`;
                const value = paramValues[param.name];
                return (
                  <div key={param.name} className="space-y-1.5">
                    <Label htmlFor={id}>{param.label}</Label>
                    {param.type === "select" ? (
                      <Select
                        value={typeof value === "string" ? value : ""}
                        onValueChange={(v) =>
                          setParamValues((current) => ({
                            ...current,
                            [param.name]: v,
                          }))
                        }
                      >
                        <SelectTrigger id={id} data-testid={id}>
                          <SelectValue
                            placeholder={tCommon("placeholders.selectOption")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {param.values.map((option) => (
                            <SelectItem key={option} value={option}>
                              <span className="font-mono text-sm">
                                {option}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : param.type === "configuration" ? (
                      param.multiple ? (
                        <StaticValuesMultiSelect
                          values={configurations.values}
                          labels={configurations.labels}
                          selected={(Array.isArray(value) ? value : []).filter(
                            (id) => configurations.values.includes(id)
                          )}
                          onChange={(next) =>
                            setParamValues((current) => ({
                              ...current,
                              [param.name]: next,
                            }))
                          }
                          placeholder={tSearch("selectOptions")}
                          ariaLabel={param.label}
                          testId={id}
                        />
                      ) : (
                        <Select
                          value={
                            typeof value === "string" &&
                            configurations.values.includes(value)
                              ? value
                              : NO_CONFIGURATION
                          }
                          onValueChange={(v) =>
                            setParamValues((current) => ({
                              ...current,
                              [param.name]: v === NO_CONFIGURATION ? "" : v,
                            }))
                          }
                        >
                          <SelectTrigger id={id} data-testid={id}>
                            <SelectValue
                              placeholder={tCommon("placeholders.selectOption")}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_CONFIGURATION}>
                              {tCommon("labels.noConfiguration")}
                            </SelectItem>
                            {configurations.values.map((option) => (
                              <SelectItem key={option} value={option}>
                                {configurations.labels[option]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    ) : param.type === "multiselect" ? (
                      <StaticValuesMultiSelect
                        values={param.values}
                        selected={Array.isArray(value) ? value : []}
                        onChange={(next) =>
                          setParamValues((current) => ({
                            ...current,
                            [param.name]: next,
                          }))
                        }
                        placeholder={tSearch("selectOptions")}
                        ariaLabel={param.label}
                        testId={id}
                      />
                    ) : (
                      <Input
                        id={id}
                        value={typeof value === "string" ? value : ""}
                        onChange={(e) =>
                          setParamValues((current) => ({
                            ...current,
                            [param.name]: e.target.value,
                          }))
                        }
                        className="font-mono text-sm"
                        data-testid={id}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p
            className="text-sm font-medium"
            data-testid="execute-automation-summary"
          >
            {t(subset ? "selectedCaseCountSummary" : "caseCountSummary", {
              count: caseCount,
            })}
          </p>
          {skippedCount > 0 && (
            <p
              className="text-xs text-muted-foreground"
              data-testid="execute-automation-skipped"
            >
              {t("skippedSelection", { count: skippedCount })}
            </p>
          )}
          {runId != null && (
            <p className="text-xs text-muted-foreground">
              {t("resultsNote", { runId })}
            </p>
          )}
          {error && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-testid="execute-automation-error"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="execute-automation-cancel"
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!selected || submitting || caseCount === 0}
            data-testid="execute-automation-submit"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlay className="h-4 w-4" />
            )}
            <span>{submitting ? t("submitting") : t("submit")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Turn the execute routes' JSON errors into a message for the dialog. */
export async function readExecuteError(
  res: Response,
  fallback: string
): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; code?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}
