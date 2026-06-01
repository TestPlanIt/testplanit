"use client";
/* eslint-disable react-hooks/incompatible-library -- This file consumes a library API (TanStack Table / TanStack Virtual / react-hook-form watch) that returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it. */

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { TestCaseParameter } from "@prisma/client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

export interface ParameterEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseId: number;
  parameter: TestCaseParameter;
}

type FormValues = {
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  defaultValue: string;
  required: boolean;
  sensitive: boolean;
  selectSource: "inline" | "lookup";
  allowedValuesText: string;
  lookupDataSetId: number | null;
};

function defaultsFromParameter(p: TestCaseParameter): FormValues {
  const isInline =
    p.type === "SELECT" &&
    Array.isArray(p.allowedValuesJson) &&
    p.lookupDataSetId == null;
  const allowedLines = Array.isArray(p.allowedValuesJson)
    ? (p.allowedValuesJson as string[]).join("\n")
    : "";
  const defaultValueStr =
    p.defaultValue == null
      ? ""
      : typeof p.defaultValue === "string"
        ? p.defaultValue
        : JSON.stringify(p.defaultValue);
  return {
    type: p.type,
    defaultValue: defaultValueStr,
    required: p.required,
    sensitive: p.sensitive,
    selectSource:
      p.type === "SELECT"
        ? p.lookupDataSetId != null
          ? "lookup"
          : "inline"
        : "inline",
    allowedValuesText: isInline ? allowedLines : "",
    lookupDataSetId: p.lookupDataSetId,
  };
}

function buildPatchPayload(values: FormValues): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: values.type,
    required: values.required,
    sensitive: values.sensitive,
    defaultValue: values.defaultValue === "" ? null : values.defaultValue,
  };

  if (values.type === "SELECT") {
    if (values.selectSource === "inline") {
      const lines = values.allowedValuesText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      payload.allowedValuesJson = lines;
      payload.lookupDataSetId = null;
    } else {
      payload.allowedValuesJson = null;
      payload.lookupDataSetId = values.lookupDataSetId;
    }
  } else {
    payload.allowedValuesJson = null;
    payload.lookupDataSetId = null;
  }

  return payload;
}

export function ParameterEditDialog({
  open,
  onOpenChange,
  caseId,
  parameter,
}: ParameterEditDialogProps) {
  const t = useTranslations("parameters");
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    defaultValues: defaultsFromParameter(parameter),
    mode: "onSubmit",
  });

  useEffect(() => {
    if (open) {
      form.reset(defaultsFromParameter(parameter));
    }
  }, [open, parameter, form]);

  const type = form.watch("type");
  const selectSource = form.watch("selectSource");

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const body = buildPatchPayload(values);
      const res = await fetch(
        `/api/repository/cases/${caseId}/parameters/${parameter.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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
        toast.error(t("editError"), { description: message });
        return;
      }
      toast.success(t("editSuccess", { name: parameter.name }));
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestCaseParameter"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "RepositoryCases"],
      });
      onOpenChange(false);
    } catch {
      toast.error(t("editError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        data-testid="parameter-edit-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {t("editDialogTitle", { name: parameter.name })}
          </DialogTitle>
          <DialogDescription>{t("editDialogDescription")}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium">{t("formName")}</label>
              <Input value={parameter.name} disabled className="font-mono" />
              <p className="text-xs text-muted-foreground mt-1">
                {t("editDialogRenameHint")}
              </p>
            </div>

            <div>
              <label
                className="text-xs font-medium"
                htmlFor="parameter-edit-type"
              >
                {t("formType")}
              </label>
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) =>
                      field.onChange(v as FormValues["type"])
                    }
                  >
                    <SelectTrigger
                      id="parameter-edit-type"
                      data-testid="parameter-edit-type"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STRING">{"STRING"}</SelectItem>
                      <SelectItem value="INTEGER">{"INTEGER"}</SelectItem>
                      <SelectItem value="BOOLEAN">{"BOOLEAN"}</SelectItem>
                      <SelectItem value="SELECT">{"SELECT"}</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div>
              <label
                className="text-xs font-medium"
                htmlFor="parameter-edit-default"
              >
                {t("formDefault")}
              </label>
              <Input
                id="parameter-edit-default"
                data-testid="parameter-edit-default"
                type={type === "INTEGER" ? "number" : "text"}
                {...form.register("defaultValue")}
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name="required"
                render={({ field }) => (
                  <Checkbox
                    id="parameter-edit-required"
                    data-testid="parameter-edit-required"
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(Boolean(v))}
                  />
                )}
              />
              <label
                htmlFor="parameter-edit-required"
                className="text-xs font-medium"
              >
                {t("formRequired")}
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name="sensitive"
                render={({ field }) => (
                  <Checkbox
                    id="parameter-edit-sensitive"
                    data-testid="parameter-edit-sensitive"
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(Boolean(v))}
                  />
                )}
              />
              <label
                htmlFor="parameter-edit-sensitive"
                className="text-xs font-medium"
              >
                {t("formSensitive")}
              </label>
            </div>
          </div>

          {type === "SELECT" && (
            <div className="flex flex-col gap-2 border rounded-md p-3 bg-muted/30">
              <Controller
                control={form.control}
                name="selectSource"
                render={({ field }) => (
                  <RadioGroup
                    value={field.value}
                    onValueChange={(v) =>
                      field.onChange(v as FormValues["selectSource"])
                    }
                    className="flex gap-4"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="inline"
                        id="parameter-edit-source-inline"
                        data-testid="parameter-edit-source-inline"
                      />
                      <label
                        htmlFor="parameter-edit-source-inline"
                        className="text-xs font-medium"
                      >
                        {t("selectSourceInline")}
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value="lookup"
                        id="parameter-edit-source-lookup"
                        data-testid="parameter-edit-source-lookup"
                      />
                      <label
                        htmlFor="parameter-edit-source-lookup"
                        className="text-xs font-medium"
                      >
                        {t("selectSourceLookup")}
                      </label>
                    </div>
                  </RadioGroup>
                )}
              />

              {selectSource === "inline" ? (
                <div>
                  <label
                    className="text-xs font-medium"
                    htmlFor="parameter-edit-allowed-values"
                  >
                    {t("selectAllowedValuesLabel")}
                  </label>
                  <Textarea
                    id="parameter-edit-allowed-values"
                    data-testid="parameter-edit-allowed-values"
                    rows={3}
                    {...form.register("allowedValuesText")}
                  />
                </div>
              ) : (
                <div>
                  <label
                    className="text-xs font-medium"
                    htmlFor="parameter-edit-lookup-dataset"
                  >
                    {t("selectLookupDataSetLabel")}
                  </label>
                  <Controller
                    control={form.control}
                    name="lookupDataSetId"
                    render={({ field }) => (
                      <Input
                        id="parameter-edit-lookup-dataset"
                        data-testid="parameter-edit-lookup-dataset"
                        type="number"
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ""
                              ? null
                              : Number(e.target.value)
                          )
                        }
                      />
                    )}
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="parameter-edit-cancel"
            >
              {t("editDialogCancel")}
            </Button>
            <Button
              type="submit"
              disabled={submitting}
              data-testid="parameter-edit-submit"
            >
              {t("editDialogSave")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
