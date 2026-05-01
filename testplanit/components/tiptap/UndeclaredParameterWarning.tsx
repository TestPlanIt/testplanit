"use client";

import type { JSONContent } from "@tiptap/core";
import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

const useParameterTranslations = useTranslations as (
  ns: string
) => (key: string, params?: Record<string, unknown>) => string;

export interface UndeclaredParameterWarningProps {
  editorJson: JSONContent | null;
  declaredNames: string[];
}

function collectMentionLabels(
  doc: JSONContent | null | undefined,
  out: Set<string>
): void {
  if (!doc) return;
  if (
    doc.type === "parameterMention" &&
    typeof doc.attrs?.label === "string"
  ) {
    out.add(doc.attrs.label);
  }
  if (Array.isArray(doc.content)) {
    doc.content.forEach((child) => collectMentionLabels(child, out));
  }
}

export function UndeclaredParameterWarning({
  editorJson,
  declaredNames,
}: UndeclaredParameterWarningProps) {
  const t = useParameterTranslations("parameters");

  const undeclared = useMemo(() => {
    const all = new Set<string>();
    collectMentionLabels(editorJson, all);
    const declared = new Set(declaredNames);
    return Array.from(all).filter((name) => !declared.has(name));
  }, [editorJson, declaredNames]);

  if (undeclared.length === 0) return null;

  const names = undeclared.map((n) => `@${n}`).join(", ");

  return (
    <div
      className="flex items-center gap-2 text-xs text-warning-foreground bg-warning/10 border border-warning/20 rounded-md px-3 py-2"
      data-testid="tiptap-undeclared-parameter-warning"
      role="alert"
    >
      <AlertTriangle className="w-3 h-3 shrink-0" />
      <span>{t("editorUndeclaredWarning", { names })}</span>
    </div>
  );
}
