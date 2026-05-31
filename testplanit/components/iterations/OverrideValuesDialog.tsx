"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  buildIterationOverrideSchema,
  type OverrideParameterSchemaEntry,
} from "~/lib/schemas/iterationOverrideSchema";

import { OverrideUnsavedAlertDialog } from "./OverrideUnsavedAlertDialog";

export interface OverrideValuesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: number;
  caseId: number;
  iterationId: number;
  rowIndex: number;
  /** Snapshot's `parametersJson` parsed into the override schema shape. */
  parametersSchema: OverrideParameterSchemaEntry[];
  /** The immutable snapshot row at this rowIndex. */
  snapshotRow: Record<string, unknown>;
  /** The iteration's current `valuesJson` (which may already deviate). */
  currentValues: Record<string, unknown>;
  /** Whether this viewer can see sensitive plaintext. */
  viewerCanReadSensitive: boolean;
}

function valueToFormString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function coerceForSubmit(
  values: Record<string, unknown>,
  schema: OverrideParameterSchemaEntry[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const byName = new Map(schema.map((p) => [p.name, p]));
  for (const [k, v] of Object.entries(values)) {
    const p = byName.get(k);
    if (!p) {
      out[k] = v;
      continue;
    }
    if (v === "" || v == null) {
      out[k] = null;
      continue;
    }
    if (p.type === "INTEGER") {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? Math.trunc(n) : v;
    } else if (p.type === "BOOLEAN") {
      out[k] = v === true || v === "true";
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * UI-SPEC Surface C — Override Values Dialog.
 *
 * Reads schema + snapshot row from the wrapping IterationAwareTestRunCaseDetails
 * and lets the user PATCH the iteration's `valuesJson`. The snapshot is never
 * mutated by this dialog — the server-side route also enforces snapshot
 * immutability (PARAM-07).
 */
export function OverrideValuesDialog({
  open,
  onOpenChange,
  runId,
  caseId,
  iterationId,
  rowIndex,
  parametersSchema,
  snapshotRow,
  currentValues,
  viewerCanReadSensitive,
}: OverrideValuesDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  const orderedSchema = useMemo(
    () =>
      [...parametersSchema].sort((a, b) => {
        // Stable order: rely on materializer-assigned order field when
        // present; otherwise preserve input array order.
        const ai = (a as { order?: number }).order ?? 0;
        const bi = (b as { order?: number }).order ?? 0;
        return ai - bi;
      }),
    [parametersSchema]
  );

  const zodSchema = useMemo(
    () => buildIterationOverrideSchema(orderedSchema),
    [orderedSchema]
  );

  const defaultValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const p of orderedSchema) {
      const cur = currentValues[p.name];
      const snap = snapshotRow[p.name];
      const value = cur !== undefined ? cur : snap;
      if (p.type === "BOOLEAN") {
        out[p.name] = value === true || value === "true";
      } else {
        out[p.name] = valueToFormString(value);
      }
    }
    return out;
  }, [orderedSchema, currentValues, snapshotRow]);

  const form = useForm<Record<string, unknown>>({
    resolver: standardSchemaResolver(zodSchema as any),
    defaultValues,
    mode: "onChange",
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultValues);
      setRevealed({});
    }
  }, [open, defaultValues, form]);

  const handleDialogOpenChange = (next: boolean) => {
    if (!next && form.formState.isDirty) {
      setUnsavedOpen(true);
      return;
    }
    onOpenChange(next);
  };

  const onSubmit = async (raw: Record<string, unknown>) => {
    setSubmitting(true);
    try {
      const coerced = coerceForSubmit(raw, orderedSchema);
      const res = await fetch(
        `/api/repository/test-runs/${runId}/cases/${caseId}/iterations/${iterationId}/values`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ values: coerced }),
        }
      );
      if (!res.ok) {
        let message: string | undefined;
        try {
          const errBody = await res.json();
          message = errBody?.error;
        } catch {
          message = undefined;
        }
        toast.error(t("overrideError"), { description: message });
        return;
      }
      toast.success(t("overrideSavedToast"));
      await queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestRunCaseIteration"],
      });
      onOpenChange(false);
    } catch {
      toast.error(t("overrideError"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetRow = (name: string) => {
    const p = orderedSchema.find((pp) => pp.name === name);
    if (!p) return;
    const snap = snapshotRow[name];
    if (p.type === "BOOLEAN") {
      form.setValue(name, snap === true || snap === "true", {
        shouldDirty: true,
        shouldValidate: true,
      });
    } else {
      form.setValue(name, valueToFormString(snap), {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void form.handleSubmit(onSubmit)();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="sm:max-w-lg p-6"
          data-testid="override-values-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {t("overrideDialogTitle", { n: String(rowIndex + 1) })}
            </DialogTitle>
            <DialogDescription>
              {t("overrideDialogDescription")}
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit(onSubmit)}
            onKeyDown={onKeyDown}
            className="flex flex-col gap-4"
          >
            <TooltipProvider>
              {orderedSchema.map((p) => {
                const sensitive = p.sensitive === true;
                const canSee = !sensitive || viewerCanReadSensitive;
                const fieldId = `override-field-${p.name}`;
                const snap = snapshotRow[p.name];
                const cur = form.watch(p.name);
                const changed =
                  p.type === "BOOLEAN"
                    ? Boolean(cur) !== (snap === true || snap === "true")
                    : valueToFormString(cur) !== valueToFormString(snap);
                const isRevealed = revealed[p.name] === true;
                const errMsg = form.formState.errors[p.name]?.message as
                  | string
                  | undefined;

                return (
                  <div key={p.name} className="flex flex-col gap-1">
                    <div className="flex items-baseline justify-between">
                      <label
                        htmlFor={fieldId}
                        className="text-xs font-medium font-mono"
                      >
                        {`@${p.name}`}
                        {sensitive && (
                          <span className="text-muted-foreground ml-1 font-sans">
                            {`(${t("formSensitive").toLowerCase()})`}
                          </span>
                        )}
                      </label>
                      {changed && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => handleResetRow(p.name)}
                          data-testid={`override-reset-${p.name}`}
                        >
                          {t("overrideResetRow")}
                        </Button>
                      )}
                    </div>

                    {sensitive && !canSee ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Input
                            id={fieldId}
                            value="[REDACTED]"
                            disabled
                            data-testid={`override-field-${p.name}-redacted`}
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("datasetSensitiveDeniedTooltip")}
                        </TooltipContent>
                      </Tooltip>
                    ) : p.type === "BOOLEAN" ? (
                      <Controller
                        control={form.control}
                        name={p.name}
                        render={({ field }) => (
                          <Switch
                            id={fieldId}
                            checked={Boolean(field.value)}
                            onCheckedChange={field.onChange}
                            data-testid={`override-field-${p.name}`}
                          />
                        )}
                      />
                    ) : p.type === "SELECT" ? (
                      <Controller
                        control={form.control}
                        name={p.name}
                        render={({ field }) => (
                          <Select
                            value={
                              field.value == null ? "" : String(field.value)
                            }
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger
                              id={fieldId}
                              data-testid={`override-field-${p.name}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {(p.allowedValues ?? []).map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                  {opt}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    ) : (
                      <div className="flex items-center gap-1">
                        <Input
                          id={fieldId}
                          type={
                            sensitive && !isRevealed
                              ? "password"
                              : p.type === "INTEGER"
                                ? "number"
                                : "text"
                          }
                          inputMode={
                            p.type === "INTEGER" ? "numeric" : undefined
                          }
                          {...form.register(p.name)}
                          data-testid={`override-field-${p.name}`}
                        />
                        {sensitive && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setRevealed((r) => ({
                                ...r,
                                [p.name]: !r[p.name],
                              }))
                            }
                            aria-label={
                              isRevealed
                                ? t("overrideHideAria")
                                : t("overrideRevealAria")
                            }
                            data-testid={`override-field-${p.name}-toggle`}
                          >
                            {isRevealed ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    )}
                    {errMsg && (
                      <p
                        className="text-xs text-destructive"
                        data-testid={`override-field-${p.name}-error`}
                      >
                        {errMsg}
                      </p>
                    )}
                  </div>
                );
              })}
            </TooltipProvider>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleDialogOpenChange(false)}
                data-testid="override-values-cancel"
              >
                {tCommon("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  !form.formState.isDirty ||
                  !form.formState.isValid
                }
                data-testid="override-values-save"
              >
                {t("overrideSave")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <OverrideUnsavedAlertDialog
        open={unsavedOpen}
        onOpenChange={setUnsavedOpen}
        onDiscard={() => {
          form.reset(defaultValues);
          onOpenChange(false);
        }}
      />
    </>
  );
}

export default OverrideValuesDialog;
