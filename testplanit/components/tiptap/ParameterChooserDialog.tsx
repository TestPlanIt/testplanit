"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

const useParameterTranslations = useTranslations as (
  ns: string
) => (key: string, params?: Record<string, unknown>) => string;

export interface ParameterChooserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parameters: ParameterChipMeta[];
  onPick: (parameter: ParameterChipMeta) => void;
  onOpenSheet?: () => void;
}

export function ParameterChooserDialog({
  open,
  onOpenChange,
  parameters,
  onPick,
  onOpenSheet,
}: ParameterChooserDialogProps) {
  const t = useParameterTranslations("parameters");
  const tCommon = useTranslations("common");
  const [query, setQuery] = useState("");

  const filtered = parameters.filter((p) =>
    p.name.toLowerCase().startsWith(query.toLowerCase())
  );

  const isEmpty = parameters.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="parameter-chooser-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("chooserTitle")}</DialogTitle>
          <DialogDescription>{t("chooserDescription")}</DialogDescription>
        </DialogHeader>

        {isEmpty ? (
          <div className="space-y-3" data-testid="parameter-chooser-empty">
            <p className="text-sm text-muted-foreground">{t("chooserEmpty")}</p>
            {onOpenSheet && (
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  onOpenChange(false);
                  onOpenSheet();
                }}
              >
                {t("chooserConfigureLink")}
              </Button>
            )}
          </div>
        ) : (
          <>
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("chooserSearchPlaceholder")}
              data-testid="parameter-chooser-search-input"
            />
            <div className="max-h-64 overflow-auto">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="w-full text-start px-2 py-1.5 text-sm rounded-sm flex items-center gap-2 hover:bg-accent"
                  onClick={() => onPick(p)}
                  data-testid={`parameter-chooser-item-${p.name}`}
                >
                  <span className="font-mono">{`@${p.name}`}</span>
                  <Badge variant="secondary">{p.type}</Badge>
                  {p.defaultValue !== null && (
                    <span className="text-xs text-muted-foreground">
                      {`= ${p.defaultValue}`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {tCommon("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
