"use client";

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
import { Textarea } from "@/components/ui/textarea";
import { Asterisk } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type {
  IssueFormElement,
  IssueFormValues,
} from "~/lib/integrations/issueTemplates";
import { MultiChoiceField } from "./multi-choice-field";

/** Select item standing for "nothing chosen"; Radix refuses an empty value. */
const NONE_VALUE = "__none__";

function RequiredMark() {
  return (
    <sup>
      <Asterisk className="h-3 w-3 text-destructive" />
    </sup>
  );
}

function selection(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/**
 * A dropdown that takes several answers. The option list keeps its identity
 * between renders; the picker reloads its choices whenever it changes.
 */
function MultiDropdown({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string | string[] | undefined;
  onChange: (value: string[]) => void;
}) {
  const choices = useMemo(
    () => options.map((option) => ({ id: option, name: option })),
    [options]
  );
  const chosen = useMemo(() => selection(value), [value]);
  return (
    <MultiChoiceField
      name={label}
      options={choices}
      value={chosen}
      onChange={onChange}
    />
  );
}

interface IssueTemplateFormProps {
  form: IssueFormElement[];
  values: IssueFormValues;
  onChange: (id: string, value: string | string[]) => void;
  /** Ids of the fields a required answer is missing from. */
  missing: string[];
  disabled?: boolean;
}

/** The fields of a tracker's issue form, in the order the form lists them. */
export function IssueTemplateForm({
  form,
  values,
  onChange,
  missing,
  disabled,
}: IssueTemplateFormProps) {
  const t = useTranslations();

  return (
    <div className="space-y-4" data-testid="issue-template-form">
      {form.map((element, index) => {
        if (element.kind === "markdown") {
          return (
            <p
              key={`markdown-${index}`}
              className="text-sm whitespace-pre-wrap text-muted-foreground"
            >
              {element.text}
            </p>
          );
        }

        const inputId = `template-field-${element.id}`;
        const required =
          element.kind === "checkboxes" ? false : element.required;
        const value = values[element.id];

        return (
          <div key={element.id} className="space-y-2" data-testid={inputId}>
            <Label htmlFor={inputId} className="flex items-center">
              {element.label}
              {required && <RequiredMark />}
            </Label>
            {element.description && (
              <p className="text-xs text-muted-foreground">
                {element.description}
              </p>
            )}

            {element.kind === "input" && (
              <Input
                id={inputId}
                value={typeof value === "string" ? value : ""}
                placeholder={element.placeholder}
                disabled={disabled}
                onChange={(event) => onChange(element.id, event.target.value)}
              />
            )}

            {element.kind === "textarea" && (
              <Textarea
                id={inputId}
                rows={4}
                value={typeof value === "string" ? value : ""}
                placeholder={element.placeholder}
                disabled={disabled}
                onChange={(event) => onChange(element.id, event.target.value)}
              />
            )}

            {element.kind === "dropdown" && element.multiple && (
              <MultiDropdown
                label={element.label}
                options={element.options}
                value={value}
                onChange={(next) => onChange(element.id, next)}
              />
            )}

            {element.kind === "dropdown" && !element.multiple && (
              <Select
                disabled={disabled}
                value={typeof value === "string" && value ? value : ""}
                onValueChange={(next) =>
                  onChange(element.id, next === NONE_VALUE ? "" : next)
                }
              >
                <SelectTrigger id={inputId}>
                  <SelectValue placeholder={element.label} />
                </SelectTrigger>
                <SelectContent>
                  {!element.required && (
                    <SelectItem value={NONE_VALUE}>
                      {t("common.access.none")}
                    </SelectItem>
                  )}
                  {element.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {element.kind === "checkboxes" &&
              element.options.map((option, optionIndex) => {
                const optionId = `${inputId}-${optionIndex}`;
                const ticked = selection(value);
                return (
                  <div key={option.label} className="flex items-center gap-2">
                    <Checkbox
                      id={optionId}
                      disabled={disabled}
                      checked={ticked.includes(option.label)}
                      onCheckedChange={(checked) =>
                        onChange(
                          element.id,
                          checked === true
                            ? [...ticked, option.label]
                            : ticked.filter((label) => label !== option.label)
                        )
                      }
                    />
                    <Label
                      htmlFor={optionId}
                      className="flex items-center font-normal"
                    >
                      {option.label}
                      {option.required && <RequiredMark />}
                    </Label>
                  </div>
                );
              })}

            {missing.includes(element.id) && (
              <p className="text-xs text-destructive">
                {t("common.errors.fieldRequired")}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
