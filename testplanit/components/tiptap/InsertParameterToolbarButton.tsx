"use client";

import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Editor } from "@tiptap/core";
import { Braces } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

const useParameterTranslations = useTranslations as (
  ns: string
) => (key: string, params?: Record<string, unknown>) => string;

export interface InsertParameterToolbarButtonProps {
  editor: Editor;
  parameters: ParameterChipMeta[];
  onOpenSheet?: () => void;
}

export function InsertParameterToolbarButton({
  editor,
  parameters,
  onOpenSheet: _onOpenSheet,
}: InsertParameterToolbarButtonProps) {
  const t = useParameterTranslations("parameters");

  const handlePick = useCallback(
    (p: ParameterChipMeta | null) => {
      if (!p) return;
      editor
        .chain()
        .focus()
        .insertContent({
          type: "parameterMention",
          attrs: {
            id: p.name,
            label: p.name,
            paramId: p.id,
            paramType: p.type,
          },
        })
        .insertContent(" ")
        .run();
    },
    [editor]
  );

  const fetchOptions = useCallback(
    async (query: string) => {
      const lowered = query.toLowerCase();
      const filtered = parameters.filter((p) =>
        p.name.toLowerCase().includes(lowered)
      );
      return { results: filtered, total: filtered.length };
    },
    [parameters]
  );

  return (
    <AsyncCombobox<ParameterChipMeta>
      value={null}
      onValueChange={handlePick}
      fetchOptions={fetchOptions}
      getOptionValue={(p) => p.id}
      placeholder={t("toolbarInsertParameterPlaceholder")}
      pageSize={parameters.length || 10}
      renderOption={(p) => (
        <div className="flex items-center gap-2 w-full">
          <span className="font-mono text-sm">{`@${p.name}`}</span>
          <Badge variant="secondary" className="ml-auto">
            {p.type}
          </Badge>
        </div>
      )}
      renderTrigger={() => (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="p-2"
          title={t("toolbarInsertParameter")}
          aria-label={t("toolbarInsertParameter")}
          data-testid="tiptap-insert-parameter-button"
        >
          <Braces className="w-4 h-4" />
        </Button>
      )}
    />
  );
}
