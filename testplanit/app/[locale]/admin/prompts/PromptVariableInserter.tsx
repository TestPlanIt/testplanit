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
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PromptVariable } from "~/lib/llm/constants";

interface PromptVariableInserterProps {
  variables: PromptVariable[];
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  currentValue: string;
  onInsert: (newValue: string) => void;
}

export function PromptVariableInserter({
  variables,
  textareaRef,
  currentValue,
  onInsert,
}: PromptVariableInserterProps) {
  const t = useTranslations("admin.prompts");
  const [selectKey, setSelectKey] = useState(0);
  const cursorPosRef = useRef(0);

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

  const handleSelect = useCallback(
    (variableName: string) => {
      const insertion = `{{${variableName}}}`;
      const textarea = textareaRef.current;
      const cursorPos = cursorPosRef.current;
      const before = currentValue.slice(0, cursorPos);
      const after = currentValue.slice(cursorPos);
      onInsert(before + insertion + after);
      setSelectKey((k) => k + 1);
      if (textarea) {
        const newCursorPos = cursorPos + insertion.length;
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(newCursorPos, newCursorPos);
        }, 0);
      }
    },
    [textareaRef, currentValue, onInsert]
  );

  if (!variables.length) return null;

  return (
    <Select key={selectKey} onValueChange={handleSelect}>
      <SelectTrigger className="w-44 h-7 text-xs">
        <SelectValue placeholder={t("insertVariable")} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t("variables")}</SelectLabel>
          {variables.map((v) => (
            <SelectItem key={v.name} value={v.name} className="pl-6">
              <span className="font-mono">{v.name}</span>
              <span className="ml-3 text-muted-foreground text-xs">{v.description}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
