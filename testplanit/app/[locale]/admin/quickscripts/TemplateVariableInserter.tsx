"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { CaseFields } from "@prisma/client";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { useFindManyCaseFields } from "~/lib/hooks";

const CASE_VARIABLES = [
  { label: "name", value: "{{name}}", type: "Text" },
  { label: "id", value: "{{id}}", type: "Integer" },
  { label: "folder", value: "{{folder}}", type: "Text" },
  { label: "state", value: "{{state}}", type: "Text" },
  { label: "estimate", value: "{{estimate}}", type: "Integer" },
  { label: "automated", value: "{{automated}}", type: "Checkbox" },
  { label: "tags", value: "{{tags}}", type: "Text" },
  { label: "createdBy", value: "{{createdBy}}", type: "Text" },
  { label: "createdAt", value: "{{createdAt}}", type: "Date" },
];

const STEP_VARIABLES = [
  {
    label: "stepsBlock",
    value: "{{#steps}}\n{{order}}. {{step}} — {{expectedResult}}\n{{/steps}}",
    type: "Block",
    isBlock: true,
  },
  { label: "order", value: "{{order}}", type: "Integer" },
  { label: "step", value: "{{step}}", type: "Text" },
  { label: "expectedResult", value: "{{expectedResult}}", type: "Text" },
];

interface TemplateVariableInserterProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInsert: (newValue: string) => void;
  currentValue: string;
}

export function TemplateVariableInserter({
  textareaRef,
  onInsert,
  currentValue,
}: TemplateVariableInserterProps) {
  const t = useTranslations("admin.exportTemplates.variableInserter");
  const [selectKey, setSelectKey] = useState(0);

  const cursorPosRef = useRef(0);

  // Save cursor position on every textarea interaction so we have it
  // when the Select steals focus
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const save = () => {
      cursorPosRef.current = textarea.selectionStart;
    };
    textarea.addEventListener("keyup", save);
    textarea.addEventListener("mouseup", save);
    textarea.addEventListener("blur", save);
    return () => {
      textarea.removeEventListener("keyup", save);
      textarea.removeEventListener("mouseup", save);
      textarea.removeEventListener("blur", save);
    };
  }, [textareaRef]);

  const { data: caseFieldsData } = useFindManyCaseFields({
    where: { isEnabled: true, isDeleted: false },
    select: {
      displayName: true,
      systemName: true,
      type: { select: { type: true } },
    },
    orderBy: { displayName: "asc" },
  });
  const caseFields = caseFieldsData as
    | Array<
        Pick<CaseFields, "displayName" | "systemName"> & {
          type: { type: string };
        }
      >
    | undefined;

  const handleSelect = useCallback(
    (variable: string) => {
      const textarea = textareaRef.current;
      const cursorPos = cursorPosRef.current;
      const before = currentValue.slice(0, cursorPos);
      const after = currentValue.slice(cursorPos);
      const newValue = before + variable + after;
      onInsert(newValue);

      // Reset select and restore cursor after React re-render
      setSelectKey((k) => k + 1);
      if (textarea) {
        const newCursorPos = cursorPos + variable.length;
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
      }
    },
    [textareaRef, currentValue, onInsert]
  );

  return (
    <Select key={selectKey} onValueChange={handleSelect}>
      <SelectTrigger className="w-48" data-testid="template-variable-inserter">
        <SelectValue placeholder={t("placeholder")} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t("groups.caseFields")}</SelectLabel>
          {CASE_VARIABLES.map((v) => (
            <SelectItem key={v.value} value={v.value} className="pl-6">
              {v.label}
              <Badge variant="outline" className="ml-4 text-xs text-current opacity-60">
                {v.type}
              </Badge>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>{t("groups.steps")}</SelectLabel>
          {STEP_VARIABLES.map((v) => (
            <SelectItem key={v.value} value={v.value} className="pl-6">
              {v.isBlock ? t("stepsBlock") : v.label}
              <Badge variant="outline" className="ml-4 text-xs text-current opacity-60">
                {v.type}
              </Badge>
            </SelectItem>
          ))}
        </SelectGroup>
        {caseFields && caseFields.length > 0 && (
          <SelectGroup>
            <SelectLabel>{t("groups.customFields")}</SelectLabel>
            {caseFields.map((field) => (
              <SelectItem
                key={field.systemName}
                value={`{{fields.${field.systemName}}}`}
                className="pl-6"
              >
                {field.displayName}
                <Badge variant="outline" className="ml-4 text-xs text-current opacity-60">
                  {field.type.type}
                </Badge>
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
