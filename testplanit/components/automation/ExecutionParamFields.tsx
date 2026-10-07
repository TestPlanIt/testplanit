"use client";

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
import type { Dispatch, SetStateAction } from "react";
import { useProjectConfigurationOptions } from "@/components/automation/ExecutionParamsEditor";
import { StaticValuesMultiSelect } from "@/components/automation/StaticValuesMultiSelect";
import type { ParamValues } from "~/lib/execution/params";
import type { ExecutionParam } from "~/lib/execution/types";

/** Radix Select cannot represent "nothing chosen" as an item value. */
const NO_CONFIGURATION = "__none__";

interface Props {
  /** Whose configurations a configuration parameter offers. */
  projectId: number;
  params: ExecutionParam[];
  values: ParamValues;
  onChange: Dispatch<SetStateAction<ParamValues>>;
  /** Load the project's configurations only while the fields are shown. */
  active: boolean;
  /** Prefix of each field's id and test id; the parameter name follows. */
  idPrefix: string;
  testId?: string;
  disabled?: boolean;
}

/**
 * One field per parameter an execution target declares: a select, a
 * multi-select, a project configuration (single or multiple) or free text.
 * Shared by the Execute dialog and a repository webhook's auto-execute
 * settings, which both serialize the values with `serializeParamValues`.
 */
export function ExecutionParamFields({
  projectId,
  params,
  values,
  onChange,
  active,
  idPrefix,
  testId,
  disabled = false,
}: Props) {
  const tCommon = useTranslations("common");
  const tSearch = useTranslations("search");
  const configurations = useProjectConfigurationOptions(
    projectId,
    active && params.some((param) => param.type === "configuration")
  );
  const set = (name: string, value: string | string[]) =>
    onChange((current) => ({ ...current, [name]: value }));

  return (
    <div className="space-y-3" data-testid={testId}>
      {params.map((param) => {
        const id = `${idPrefix}-${param.name}`;
        const value = values[param.name];
        return (
          <div key={param.name} className="space-y-1.5">
            <Label htmlFor={id}>{param.label}</Label>
            {param.type === "select" ? (
              <Select
                value={typeof value === "string" ? value : ""}
                onValueChange={(v) => set(param.name, v)}
                disabled={disabled}
              >
                <SelectTrigger id={id} data-testid={id}>
                  <SelectValue
                    placeholder={tCommon("placeholders.selectOption")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {param.values.map((option) => (
                    <SelectItem key={option} value={option}>
                      <span className="font-mono text-sm">{option}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : param.type === "configuration" ? (
              param.multiple ? (
                <StaticValuesMultiSelect
                  values={configurations.values}
                  labels={configurations.labels}
                  selected={(Array.isArray(value) ? value : []).filter((v) =>
                    configurations.values.includes(v)
                  )}
                  onChange={(next) => set(param.name, next)}
                  placeholder={tSearch("selectOptions")}
                  ariaLabel={param.label}
                  disabled={disabled}
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
                    set(param.name, v === NO_CONFIGURATION ? "" : v)
                  }
                  disabled={disabled}
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
                onChange={(next) => set(param.name, next)}
                placeholder={tSearch("selectOptions")}
                ariaLabel={param.label}
                disabled={disabled}
                testId={id}
              />
            ) : (
              <Input
                id={id}
                value={typeof value === "string" ? value : ""}
                onChange={(e) => set(param.name, e.target.value)}
                className="font-mono text-sm"
                data-testid={id}
                disabled={disabled}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
