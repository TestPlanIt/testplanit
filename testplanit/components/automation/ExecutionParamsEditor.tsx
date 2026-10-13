"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  configurationInputKeys,
  MULTISELECT_SEPARATOR,
} from "~/lib/execution/params";
import {
  EXECUTION_PARAM_TYPES,
  type ExecutionParam,
  type ExecutionParamType,
} from "~/lib/execution/types";
import { StaticValuesMultiSelect } from "./StaticValuesMultiSelect";

/**
 * One parameter while it is being edited. Each kind keeps its own default so
 * switching the type back and forth loses nothing.
 */
export interface ExecutionParamRow {
  name: string;
  label: string;
  type: ExecutionParamType;
  values: string[];
  defaultSelect: string;
  defaultMulti: string[];
  defaultText: string;
  /** Configuration kind: more than one may be chosen. */
  multiple: boolean;
  /** Configuration kind: default ids, as strings for the pickers. */
  defaultConfigurations: string[];
}

export function paramsToRows(params: ExecutionParam[]): ExecutionParamRow[] {
  return params.map((param) => ({
    name: param.name,
    label: param.label,
    type: param.type,
    values:
      param.type === "select" || param.type === "multiselect"
        ? [...param.values]
        : [],
    defaultSelect: param.type === "select" ? param.default : "",
    defaultMulti: param.type === "multiselect" ? [...param.default] : [],
    defaultText: param.type === "text" ? (param.default ?? "") : "",
    multiple: param.type === "configuration" ? param.multiple : false,
    defaultConfigurations:
      param.type === "configuration" ? param.default.map(String) : [],
  }));
}

/** Rows without a name are skipped, like blank static-input rows. */
export function rowsToParams(rows: ExecutionParamRow[]): ExecutionParam[] {
  const out: ExecutionParam[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const label = row.label.trim() || name;
    if (row.type === "select") {
      out.push({
        name,
        label,
        type: "select",
        values: row.values,
        default: row.defaultSelect,
      });
    } else if (row.type === "multiselect") {
      out.push({
        name,
        label,
        type: "multiselect",
        values: row.values,
        default: row.defaultMulti,
      });
    } else if (row.type === "configuration") {
      const ids = row.defaultConfigurations
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);
      out.push({
        name,
        label,
        type: "configuration",
        multiple: row.multiple,
        default: row.multiple ? ids : ids.slice(0, 1),
      });
    } else {
      const text = row.defaultText;
      out.push({
        name,
        label,
        type: "text",
        ...(text ? { default: text } : {}),
      });
    }
  }
  return out;
}

function emptyRow(): ExecutionParamRow {
  return {
    name: "",
    label: "",
    type: "select",
    values: [],
    defaultSelect: "",
    defaultMulti: [],
    defaultText: "",
    multiple: false,
    defaultConfigurations: [],
  };
}

/** Radix Select cannot represent "nothing chosen" as an item value. */
const NO_DEFAULT = "__none__";

/**
 * The configurations assigned to a project, as the pickers need them.
 * Fetched only while a row of the configuration kind exists.
 */
export function useProjectConfigurationOptions(
  projectId: number,
  enabled: boolean
) {
  const { data, isLoading } = useClientQueries(
    schema
  ).configurations.useFindMany(
    {
      where: {
        isDeleted: false,
        isEnabled: true,
        projects: { some: { projectId } },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    },
    { enabled: enabled && projectId > 0 }
  );
  return useMemo(() => {
    const rows = data ?? [];
    const labels: Record<string, string> = {};
    for (const row of rows) labels[String(row.id)] = row.name;
    return { values: Object.keys(labels), labels, isLoading };
  }, [data, isLoading]);
}

interface ValuesInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  testIdPrefix: string;
}

/**
 * Tag list for a choice parameter's values: Enter (or a comma) adds the
 * typed value, Backspace on an empty field removes the last one.
 */
function ValuesInput({
  values,
  onChange,
  disabled,
  testIdPrefix,
}: ValuesInputProps) {
  const t = useTranslations("automation.settings");
  const tCommon = useTranslations("common");
  const [draft, setDraft] = useState("");

  const commit = () => {
    const value = draft.trim();
    setDraft("");
    if (!value || values.includes(value)) return;
    onChange([...values, value]);
  };

  return (
    <div className="space-y-1.5">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {values.map((value) => (
            <Badge
              key={value}
              variant="secondary"
              className="gap-1 font-mono"
              data-testid={`${testIdPrefix}-value`}
            >
              {value}
              {!disabled && (
                <button
                  type="button"
                  className="rounded-sm hover:text-destructive"
                  onClick={() => onChange(values.filter((v) => v !== value))}
                  aria-label={tCommon("actions.remove")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === MULTISELECT_SEPARATOR) {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && values.length > 0) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={t("parameterValuesPlaceholder")}
        aria-label={t("parameterValues")}
        disabled={disabled}
        className="font-mono text-sm"
        data-testid={`${testIdPrefix}-values-input`}
      />
    </div>
  );
}

interface ExecutionParamsEditorProps {
  projectId: number;
  rows: ExecutionParamRow[];
  onChange: (rows: ExecutionParamRow[]) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}

/**
 * Repeatable rows declaring what the dispatcher may choose at execute time.
 * A sibling of StaticInputsEditor: static inputs are fixed per target, these
 * are filled in per execution.
 */
export function ExecutionParamsEditor({
  projectId,
  rows,
  onChange,
  disabled,
  testIdPrefix = "automation-target-param",
}: ExecutionParamsEditorProps) {
  const t = useTranslations("automation.settings");
  const tCommon = useTranslations("common");
  const tParameters = useTranslations("parameters");
  const configurations = useProjectConfigurationOptions(
    projectId,
    rows.some((row) => row.type === "configuration")
  );

  const update = (index: number, patch: Partial<ExecutionParamRow>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const setValues = (index: number, row: ExecutionParamRow, values: string[]) =>
    update(index, {
      values,
      // A default that is no longer offered is dropped; a single-choice
      // parameter always needs one, so it falls back to the first value.
      defaultSelect: values.includes(row.defaultSelect)
        ? row.defaultSelect
        : (values[0] ?? ""),
      defaultMulti: row.defaultMulti.filter((v) => values.includes(v)),
    });

  return (
    <div className="space-y-3" data-testid={`${testIdPrefix}s`}>
      {rows.map((row, index) => {
        const prefix = `${testIdPrefix}-${index}`;
        return (
          <div
            key={index}
            className="space-y-2 rounded-md border p-3"
            data-testid={prefix}
          >
            <div className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor={`${prefix}-name`}>{tCommon("name")}</Label>
                  <Input
                    id={`${prefix}-name`}
                    value={row.name}
                    onChange={(e) => update(index, { name: e.target.value })}
                    placeholder={t("parameterNamePlaceholder")}
                    disabled={disabled}
                    className="font-mono text-sm"
                    data-testid={`${prefix}-name`}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${prefix}-label`}>
                    {tCommon("fields.options.label")}
                  </Label>
                  <Input
                    id={`${prefix}-label`}
                    value={row.label}
                    onChange={(e) => update(index, { label: e.target.value })}
                    placeholder={t("parameterLabelPlaceholder")}
                    disabled={disabled}
                    data-testid={`${prefix}-label`}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tCommon("fields.type")}</Label>
                  <Select
                    value={row.type}
                    onValueChange={(v) =>
                      update(index, { type: v as ExecutionParamType })
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger data-testid={`${prefix}-type`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXECUTION_PARAM_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {t(`parameterTypes.${type}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                aria-label={tCommon("actions.remove")}
                className="mt-6"
                data-testid={`${prefix}-remove`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {row.type === "configuration" ? (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{tCommon("fields.default")}</Label>
                    {row.multiple ? (
                      <StaticValuesMultiSelect
                        values={configurations.values}
                        labels={configurations.labels}
                        selected={row.defaultConfigurations.filter((id) =>
                          configurations.values.includes(id)
                        )}
                        onChange={(selected) =>
                          update(index, { defaultConfigurations: selected })
                        }
                        placeholder={t("parameterDefaultNone")}
                        ariaLabel={tCommon("fields.default")}
                        disabled={
                          disabled || configurations.values.length === 0
                        }
                        testId={`${prefix}-default`}
                      />
                    ) : (
                      <Select
                        value={
                          row.defaultConfigurations[0] &&
                          configurations.values.includes(
                            row.defaultConfigurations[0]
                          )
                            ? row.defaultConfigurations[0]
                            : NO_DEFAULT
                        }
                        onValueChange={(v) =>
                          update(index, {
                            defaultConfigurations: v === NO_DEFAULT ? [] : [v],
                          })
                        }
                        disabled={
                          disabled || configurations.values.length === 0
                        }
                      >
                        <SelectTrigger data-testid={`${prefix}-default`}>
                          <SelectValue
                            placeholder={t("parameterDefaultNone")}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_DEFAULT}>
                            {t("parameterDefaultNone")}
                          </SelectItem>
                          {configurations.values.map((id) => (
                            <SelectItem key={id} value={id}>
                              {configurations.labels[id]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <label className="flex items-center gap-2 pt-6 text-sm">
                    <Checkbox
                      checked={row.multiple}
                      disabled={disabled}
                      onCheckedChange={(v) =>
                        update(index, {
                          multiple: v === true,
                          defaultConfigurations:
                            v === true
                              ? row.defaultConfigurations
                              : row.defaultConfigurations.slice(0, 1),
                        })
                      }
                      data-testid={`${prefix}-multiple`}
                    />
                    <span>{t("parameterConfigurationMultiple")}</span>
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {!configurations.isLoading &&
                  configurations.values.length === 0
                    ? t("parameterConfigurationNone")
                    : t("parameterConfigurationHelp", {
                        ...configurationInputKeys(row.name.trim() || "NAME"),
                      })}
                </p>
              </div>
            ) : row.type === "text" ? (
              <div className="space-y-1">
                <Label htmlFor={`${prefix}-default`}>
                  {tCommon("fields.default")}
                </Label>
                <Input
                  id={`${prefix}-default`}
                  value={row.defaultText}
                  onChange={(e) =>
                    update(index, { defaultText: e.target.value })
                  }
                  placeholder={t("parameterDefaultPlaceholder")}
                  disabled={disabled}
                  className="font-mono text-sm"
                  data-testid={`${prefix}-default`}
                />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t("parameterValues")}</Label>
                  <ValuesInput
                    values={row.values}
                    onChange={(values) => setValues(index, row, values)}
                    disabled={disabled}
                    testIdPrefix={prefix}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tCommon("fields.default")}</Label>
                  {row.type === "select" ? (
                    <Select
                      value={row.defaultSelect}
                      onValueChange={(v) => update(index, { defaultSelect: v })}
                      disabled={disabled || row.values.length === 0}
                    >
                      <SelectTrigger data-testid={`${prefix}-default`}>
                        <SelectValue placeholder={t("parameterDefaultNone")} />
                      </SelectTrigger>
                      <SelectContent>
                        {row.values.map((value) => (
                          <SelectItem key={value} value={value}>
                            <span className="font-mono text-sm">{value}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <StaticValuesMultiSelect
                      values={row.values}
                      selected={row.defaultMulti}
                      onChange={(selected) =>
                        update(index, { defaultMulti: selected })
                      }
                      placeholder={t("parameterDefaultNone")}
                      ariaLabel={tCommon("fields.default")}
                      disabled={disabled || row.values.length === 0}
                      testId={`${prefix}-default`}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...rows, emptyRow()])}
        data-testid={`${testIdPrefix}-add`}
      >
        <Plus className="h-4 w-4" />
        <span>{tParameters("formAdd")}</span>
      </Button>
    </div>
  );
}
