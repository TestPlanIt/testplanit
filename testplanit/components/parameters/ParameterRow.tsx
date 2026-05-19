"use client";

import { ParameterDeleteDialog } from "@/components/parameters/ParameterDeleteDialog";
import { ParameterEditDialog } from "@/components/parameters/ParameterEditDialog";
import { ParameterRenameDialog } from "@/components/parameters/ParameterRenameDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TestCaseParameter } from "@prisma/client";
import { GripVertical, Lock, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

export interface ParameterRowProps {
  parameter: TestCaseParameter;
  caseId: number;
  projectId: number;
}

function typeChipLabel(parameter: TestCaseParameter): string {
  if (parameter.type !== "SELECT") return parameter.type;
  if (parameter.lookupDataSetId != null) {
    return `SELECT (lookup: ${parameter.lookupDataSetId})`;
  }
  return "SELECT (inline)";
}

function defaultValueDisplay(parameter: TestCaseParameter): string {
  if (parameter.defaultValue == null) return "";
  if (typeof parameter.defaultValue === "string") return parameter.defaultValue;
  return JSON.stringify(parameter.defaultValue);
}

export function ParameterRow({ parameter, caseId }: ParameterRowProps) {
  const t = useTranslations("parameters");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: parameter.id });

  const [editOpen, setEditOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(parameter.name);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const commitNameChange = () => {
    if (draftName === parameter.name) {
      setRenaming(false);
      return;
    }
    if (!draftName.trim()) {
      toast.error(t("addError"));
      setDraftName(parameter.name);
      setRenaming(false);
      return;
    }
    setRenameOpen(true);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        className="border rounded-md bg-card p-1 flex items-center gap-3"
        data-testid={`parameter-row-${parameter.id}`}
      >
        <div
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground"
          data-testid="parameter-row-drag-handle"
          aria-label="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {renaming ? (
          <Input
            autoFocus
            className="h-8 w-40 text-sm font-mono"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitNameChange}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitNameChange();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setDraftName(parameter.name);
                setRenaming(false);
              }
            }}
            data-testid="parameter-row-name-input"
          />
        ) : (
          <button
            type="button"
            className="text-sm font-mono hover:underline cursor-pointer"
            onClick={() => {
              setDraftName(parameter.name);
              setRenaming(true);
            }}
            title={t("renameAria")}
            data-testid="parameter-row-name"
          >
            {"@"}
            {parameter.name}
          </button>
        )}

        <Badge variant="secondary">{typeChipLabel(parameter)}</Badge>

        {defaultValueDisplay(parameter) && (
          <span className="text-xs text-muted-foreground">
            {defaultValueDisplay(parameter)}
          </span>
        )}

        {parameter.required && (
          <Badge variant="outline">{t("formRequired")}</Badge>
        )}

        {parameter.sensitive && (
          <Badge
            variant="outline"
            className="flex items-center gap-1"
            title={t("formSensitiveHelp")}
          >
            <Lock className="w-3 h-3" />
            {t("formSensitive")}
          </Badge>
        )}

        <div className="flex-1" />

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("editAria")}
          title={t("editAria")}
          onClick={() => setEditOpen(true)}
          data-testid="parameter-row-edit-button"
        >
          <Pencil className="w-4 h-4" />
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("deleteAria")}
          title={t("deleteAria")}
          className="text-destructive"
          onClick={() => setDeleteOpen(true)}
          data-testid="parameter-row-delete-button"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>

      <ParameterEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        caseId={caseId}
        parameter={parameter}
      />

      <ParameterDeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        caseId={caseId}
        paramId={parameter.id}
        paramName={parameter.name}
        currentCaseVersion={1}
      />

      <ParameterRenameDialog
        open={renameOpen}
        onOpenChange={(open) => {
          setRenameOpen(open);
          if (!open) setRenaming(false);
        }}
        caseId={caseId}
        paramId={parameter.id}
        oldName={parameter.name}
        newName={draftName}
        currentCaseVersion={1}
        onComplete={() => setRenaming(false)}
      />
    </>
  );
}
