"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { parameterCreateSchema } from "~/lib/schemas/parameterSchema";

export interface ParameterAddFormProps {
  caseId: number;
  projectId: number;
  /** Current parameter count — new parameter is appended at this order. */
  existingCount?: number;
}

type FormValues = {
  name: string;
  type: "STRING" | "INTEGER" | "BOOLEAN" | "SELECT";
  defaultValue: string;
  required: boolean;
  sensitive: boolean;
  selectSource: "inline" | "lookup";
  allowedValuesText: string;
  lookupDataSetId: number | null;
};

const DEFAULTS: FormValues = {
  name: "",
  type: "STRING",
  defaultValue: "",
  required: false,
  sensitive: false,
  selectSource: "inline",
  allowedValuesText: "",
  lookupDataSetId: null,
};

function buildPayload(
  values: FormValues,
  caseId: number,
  nextOrder: number
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    testCaseId: caseId,
    name: values.name,
    type: values.type,
    order: nextOrder,
    required: values.required,
    sensitive: values.sensitive,
  };

  if (values.defaultValue !== "") {
    payload.defaultValue = values.defaultValue;
  }

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

export function ParameterAddForm({ caseId, existingCount = 0 }: ParameterAddFormProps) {
  const t = useTranslations("parameters");
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    defaultValues: DEFAULTS,
    mode: "onSubmit",
    // Resolve via the Phase 1 Zod schema after re-shaping the form values
    // into the shape parameterCreateSchema expects.
    resolver: async (values) => {
      const payload = buildPayload(values as FormValues, caseId, existingCount);
      const result = parameterCreateSchema.safeParse(payload);
      if (result.success) {
        return { values: values, errors: {} };
      }
      const errors: Record<string, { message: string; type: string }> = {};
      for (const issue of result.error.issues) {
        const key = (issue.path[0] as string) ?? "name";
        // Map server-side schema field names back to form field names.
        const formField =
          key === "allowedValuesJson"
            ? "allowedValuesText"
            : key === "lookupDataSetId"
              ? "lookupDataSetId"
              : key;
        if (!errors[formField]) {
          errors[formField] = { message: issue.message, type: "validate" };
        }
      }
      return { values: {}, errors: errors as never };
    },
  });

  const type = form.watch("type");
  const selectSource = form.watch("selectSource");

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const body = buildPayload(values, caseId, existingCount);
      const res = await fetch(
        `/api/repository/cases/${caseId}/parameters`,
        {
          method: "POST",
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
        toast.error(t("addError"), { description: message });
        return;
      }
      const result = await res.json();
      toast.success(t("addSuccess", { name: values.name }));
      const version = result?.parameter?.testCase?.currentVersion;
      if (typeof version === "number") {
        toast.message(t("toastVersionBumped", { version: String(version) }));
      }
      form.reset(DEFAULTS);
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "TestCaseParameter"],
      });
      void queryClient.invalidateQueries({
        queryKey: ["zenstack", "RepositoryCases"],
      });
    } catch {
      toast.error(t("addError"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-3"
      data-testid="parameter-add-form"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium" htmlFor="parameter-form-name">
            {t("formName")}
          </label>
          <Input
            id="parameter-form-name"
            data-testid="parameter-form-name"
            placeholder="e.g. username"
            {...form.register("name", { required: true })}
          />
        </div>

        <div>
          <label className="text-xs font-medium" htmlFor="parameter-form-type">
            {t("formType")}
          </label>
          <Controller
            control={form.control}
            name="type"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={(v) => field.onChange(v as FormValues["type"])}
              >
                <SelectTrigger
                  id="parameter-form-type"
                  data-testid="parameter-form-type"
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
            htmlFor="parameter-form-default"
          >
            {t("formDefault")}
          </label>
          <Input
            id="parameter-form-default"
            data-testid="parameter-form-default"
            type={type === "INTEGER" ? "number" : "text"}
            {...form.register("defaultValue")}
          />
        </div>

        <div className="flex items-end gap-6 pb-2">
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="required"
              render={({ field }) => (
                <Checkbox
                  id="parameter-form-required"
                  data-testid="parameter-form-required"
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(Boolean(v))}
                />
              )}
            />
            <label
              htmlFor="parameter-form-required"
              className="text-xs font-medium"
              title={t("formRequiredHelp")}
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
                  id="parameter-form-sensitive"
                  data-testid="parameter-form-sensitive"
                  checked={field.value}
                  onCheckedChange={(v) => field.onChange(Boolean(v))}
                />
              )}
            />
            <label
            htmlFor="parameter-form-sensitive"
            className="text-xs font-medium"
            title={t("formSensitiveHelp")}
          >
            {t("formSensitive")}
          </label>
        </div>
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
                    id="select-source-inline"
                    data-testid="parameter-form-select-source-inline"
                  />
                  <label
                    htmlFor="select-source-inline"
                    className="text-xs font-medium"
                  >
                    {t("selectSourceInline")}
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem
                    value="lookup"
                    id="select-source-lookup"
                    data-testid="parameter-form-select-source-lookup"
                  />
                  <label
                    htmlFor="select-source-lookup"
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
                htmlFor="parameter-form-allowed-values"
              >
                {t("selectAllowedValuesLabel")}
              </label>
              <Textarea
                id="parameter-form-allowed-values"
                data-testid="parameter-form-allowed-values"
                rows={3}
                {...form.register("allowedValuesText")}
              />
            </div>
          ) : (
            <div>
              <label
                className="text-xs font-medium"
                htmlFor="parameter-form-lookup-dataset"
              >
                {t("selectLookupDataSetLabel")}
              </label>
              <Controller
                control={form.control}
                name="lookupDataSetId"
                render={({ field }) => (
                  <Input
                    id="parameter-form-lookup-dataset"
                    data-testid="parameter-form-lookup-dataset"
                    type="number"
                    value={field.value ?? ""}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === "" ? null : Number(e.target.value)
                      )
                    }
                  />
                )}
              />
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="default"
          size="sm"
          disabled={submitting}
          data-testid="parameter-form-submit"
        >
          {t("formAdd")}
        </Button>
      </div>
    </form>
  );
}
