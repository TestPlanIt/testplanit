"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Editor } from "@tiptap/core";
import { Braces } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";
import { ParameterChooserDialog } from "./ParameterChooserDialog";

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
  onOpenSheet,
}: InsertParameterToolbarButtonProps) {
  const t = useParameterTranslations("parameters");
  const [open, setOpen] = useState(false);

  const handlePick = (p: ParameterChipMeta) => {
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
    setOpen(false);
  };

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="p-2"
              onClick={() => setOpen(true)}
              data-testid="tiptap-insert-parameter-button"
            >
              <Braces className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("toolbarInsertParameter")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <ParameterChooserDialog
        open={open}
        onOpenChange={setOpen}
        parameters={parameters}
        onPick={handlePick}
        onOpenSheet={onOpenSheet}
      />
    </>
  );
}
