"use client";

import { SaveDraftDialog } from "@/components/caseDrafts/SaveDraftDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  NotebookPen,
  FolderOpen,
  FolderX,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import React, { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { notifyRepositoryCasesChanged } from "~/hooks/useRepositoryCasesQuery";
import {
  useSavedCaseDrafts,
  type SavedCaseDraft,
} from "~/hooks/useSavedCaseDrafts";
import { getDateFnsLocale } from "~/utils/locales";
import { schema } from "~/zenstack/schema";
import { createFormSchema } from "./AddCase";
import {
  checkDraft,
  draftToBulkCreateCase,
  groupByTemplate,
  type DraftTemplate,
} from "./draftCaseCreation";

export interface StagedCasesSheetProps {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opens the staged case in the Add Case form. */
  onOpenDraft: (draft: SavedCaseDraft) => void;
  /** Called after cases were created from the list, to refresh folder counts. */
  onCasesCreated?: () => void;
}

interface BulkCreateResult {
  results: {
    id: string;
    status: "success" | "error";
    caseId?: number;
    error?: string;
  }[];
}

/**
 * The repository page's "My Staged Cases" sheet: the author's staged cases,
 * each written in the Add Case form, with their target folder, last update,
 * and any reason they cannot be created yet. From the list a staged case is
 * opened, renamed, or deleted, and any number of valid ones are created at
 * once. The trigger lives in the page's action overflow, so it collapses
 * with the other actions.
 */
export function StagedCasesSheet({
  projectId,
  open,
  onOpenChange,
  onOpenDraft,
  onCasesCreated,
}: StagedCasesSheetProps) {
  const t = useTranslations("repository.savedDrafts");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const locale = useLocale();
  const { data: session } = useSession();
  const { drafts, isLoading, update, remove } = useSavedCaseDrafts(
    projectId,
    session?.user?.id
  );
  const [renaming, setRenaming] = useState<SavedCaseDraft | null>(null);
  const [deleting, setDeleting] = useState<SavedCaseDraft | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  /** Server errors from the last create attempt, by staged case id. */
  const [createErrors, setCreateErrors] = useState<Map<string, string>>(
    () => new Map()
  );

  // What the staged cases are checked against: the same template query Add
  // Case makes, and the project's case states.
  const { data: templates } = useClientQueries(schema).templates.useFindMany(
    {
      where: {
        isDeleted: false,
        isEnabled: true,
        projects: { some: { projectId } },
      },
      include: {
        caseFields: {
          where: { caseField: { isEnabled: true, isDeleted: false } },
          include: {
            caseField: {
              include: {
                fieldOptions: {
                  where: { fieldOption: { isEnabled: true, isDeleted: false } },
                  include: { fieldOption: true },
                },
                type: true,
              },
            },
          },
          orderBy: { order: "asc" },
        },
      },
    },
    { enabled: open }
  );
  const { data: workflows } = useClientQueries(schema).workflows.useFindMany(
    {
      where: {
        isDeleted: false,
        isEnabled: true,
        scope: "CASES",
        projects: { some: { projectId } },
      },
      select: { id: true, name: true },
    },
    { enabled: open }
  );

  const checks = useMemo(() => {
    const map = new Map<string, ReturnType<typeof checkDraft>>();
    if (!templates || !workflows) return map;
    const ctx = {
      templates: templates as unknown as DraftTemplate[],
      workflows,
      schemaFor: (template: DraftTemplate) =>
        createFormSchema(
          (template as unknown as { caseFields: unknown[] }).caseFields,
          tGlobal as (key: any) => string
        ),
      t: (key: string, values?: Record<string, string | number>) =>
        tGlobal(key as any, values as any),
    };
    for (const draft of drafts) {
      map.set(draft.id, checkDraft(draft, ctx));
    }
    return map;
  }, [drafts, templates, workflows, tGlobal]);

  const checksReady = !!templates && !!workflows;
  const creatable = useMemo(
    () => drafts.filter((d) => (checks.get(d.id)?.problems.length ?? 1) === 0),
    [drafts, checks]
  );
  const selectedCreatable = creatable.filter((d) => selected.has(d.id));

  const toggleSelected = (id: string, next: boolean) => {
    setSelected((prev) => {
      const set = new Set(prev);
      if (next) set.add(id);
      else set.delete(id);
      return set;
    });
  };
  const toggleAll = (next: boolean) => {
    setSelected(next ? new Set(creatable.map((d) => d.id)) : new Set());
  };

  const refreshCaseList = useCallback(() => {
    notifyRepositoryCasesChanged();
    onCasesCreated?.();
  }, [onCasesCreated]);

  /**
   * Create the given staged cases, one bulk-create request per template in
   * list order. Created entries are deleted; the rest keep their error.
   */
  const createDrafts = async (targets: SavedCaseDraft[]) => {
    if (!workflows || targets.length === 0) return;
    setCreating(true);
    const errors = new Map<string, string>();
    let createdCount = 0;
    try {
      const items = targets.flatMap((draft) => {
        const check = checks.get(draft.id);
        if (!check?.template || check.problems.length > 0 || !draft.folderId)
          return [];
        return [
          {
            draft,
            templateId: check.template.id,
            body: draftToBulkCreateCase(
              { ...check, template: check.template },
              { folderId: draft.folderId, payload: draft.payload },
              workflows
            ),
          },
        ];
      });
      for (const [templateId, group] of groupByTemplate(items)) {
        try {
          const res = await fetch(
            `/api/projects/${projectId}/cases/bulk-create`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                templateId,
                folderId: group[0].draft.folderId,
                cases: group.map((g) => g.body),
              }),
            }
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body?.error || `HTTP ${res.status}`);
          }
          const data = (await res.json()) as BulkCreateResult;
          for (const [index, g] of group.entries()) {
            const result = data.results[index];
            if (result?.status === "success" && result.caseId != null) {
              createdCount += 1;
              try {
                await remove(g.draft.id);
              } catch {
                errors.set(g.draft.id, t("deleteFailed"));
              }
            } else {
              errors.set(g.draft.id, result?.error || tCommon("errors.error"));
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          for (const g of group) errors.set(g.draft.id, message);
        }
      }
      if (createdCount > 0) {
        refreshCaseList();
        toast.success(t("createdToast", { count: createdCount }), {
          position: "bottom-right",
        });
      }
      if (errors.size > 0) {
        toast.error(t("failedToast", { count: errors.size }), {
          position: "bottom-right",
        });
      }
      setCreateErrors(errors);
      setSelected(new Set(errors.keys()));
    } finally {
      setCreating(false);
    }
  };

  if (!session?.user?.id) return null;

  const handleRename = async (name: string) => {
    if (!renaming) return;
    try {
      // The staged case is named after the test case, so renaming one
      // renames the other.
      await update(renaming.id, {
        name,
        payload: {
          ...renaming.payload,
          values: { ...renaming.payload.values, name },
        },
      });
      toast.success(t("renamed"), { position: "bottom-right" });
    } catch {
      toast.error(t("saveFailed"), { position: "bottom-right" });
      throw new Error("rename failed");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await remove(target.id);
      toast.success(t("deleted"), { position: "bottom-right" });
    } catch {
      toast.error(t("deleteFailed"), { position: "bottom-right" });
    }
  };

  const openDraft = (draft: SavedCaseDraft) => {
    onOpenChange(false);
    onOpenDraft(draft);
  };

  const allSelected =
    creatable.length > 0 && creatable.every((d) => selected.has(d.id));

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          className="flex w-full flex-col sm:max-w-xl"
          data-testid="staged-cases-sheet"
        >
          <SheetHeader>
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>
          {drafts.length > 0 && (
            <label className="flex items-center gap-2 px-1 text-sm">
              <Checkbox
                checked={allSelected}
                disabled={creatable.length === 0 || creating}
                onCheckedChange={(v) => toggleAll(v === true)}
                data-testid="staged-cases-select-all"
              />
              {tCommon("actions.selectAll")}
            </label>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">
                {tCommon("loading")}
              </p>
            ) : drafts.length === 0 ? (
              <p
                className="p-4 text-sm text-muted-foreground"
                data-testid="staged-cases-empty"
              >
                {t("empty")}
              </p>
            ) : (
              <ul className="divide-y">
                {drafts.map((draft) => {
                  const check = checks.get(draft.id);
                  const problems = check?.problems ?? [];
                  const serverError = createErrors.get(draft.id);
                  const canCreate = checksReady && problems.length === 0;
                  return (
                    <li
                      key={draft.id}
                      className="flex items-start gap-3 px-1 py-3"
                      data-testid={`staged-cases-item-${draft.id}`}
                    >
                      <Checkbox
                        className="mt-1"
                        checked={selected.has(draft.id)}
                        disabled={!canCreate || creating}
                        onCheckedChange={(v) =>
                          toggleSelected(draft.id, v === true)
                        }
                        aria-label={draft.name}
                        data-testid={`staged-cases-select-${draft.id}`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 whitespace-normal text-start font-normal"
                        onClick={() => openDraft(draft)}
                        data-testid={`staged-cases-open-${draft.id}`}
                      >
                        <span className="flex w-full items-center gap-2">
                          <NotebookPen className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">
                            {draft.name}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            {draft.folderMissing ? (
                              <>
                                <FolderX className="h-3.5 w-3.5 text-destructive" />
                                <span className="text-destructive">
                                  {t("folderDeleted")}
                                </span>
                              </>
                            ) : (
                              <>
                                <FolderOpen className="h-3.5 w-3.5" />
                                {draft.folderName}
                              </>
                            )}
                          </span>
                          <span>
                            {t("updated", {
                              age: formatDistanceToNow(draft.updatedAt, {
                                addSuffix: true,
                                locale: getDateFnsLocale(locale),
                              }),
                            })}
                          </span>
                          {problems.length > 0 && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="inline-flex items-center gap-1 text-destructive"
                                  data-testid={`staged-cases-problems-${draft.id}`}
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {t("problemCount", {
                                    count: problems.length,
                                  })}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent
                                side="bottom"
                                className="max-w-sm"
                              >
                                <ul className="list-disc ps-4">
                                  {problems.map((p) => (
                                    <li key={p}>{p}</li>
                                  ))}
                                </ul>
                                <p className="mt-1">{t("openToFix")}</p>
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </span>
                        {serverError && (
                          <span
                            className="text-xs text-destructive"
                            data-testid={`staged-cases-error-${draft.id}`}
                          >
                            {t("notCreated", { message: serverError })}
                          </span>
                        )}
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={tCommon("actions.actionsLabel")}
                            data-testid={`staged-cases-menu-${draft.id}`}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDraft(draft)}>
                            <div className="flex items-center gap-2">
                              <FolderOpen className="h-4 w-4" />
                              {tGlobal("projects.settings.datasets.openLink")}
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setRenaming(draft)}>
                            <div className="flex items-center gap-2">
                              <Pencil className="h-4 w-4" />
                              {tGlobal("repository.savedViews.rename")}
                            </div>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleting(draft)}
                            data-testid={`staged-cases-delete-${draft.id}`}
                          >
                            <div className="flex items-center gap-2">
                              <Trash2 className="h-4 w-4" />
                              {tCommon("actions.delete")}
                            </div>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {drafts.length > 0 && (
            <SheetFooter className="flex-row items-center justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                disabled={creating || creatable.length === 0}
                onClick={() => void createDrafts(creatable)}
                data-testid="staged-cases-create-all"
              >
                {t("createAll", { count: creatable.length })}
              </Button>
              <Button
                type="button"
                disabled={creating || selectedCreatable.length === 0}
                onClick={() => void createDrafts(selectedCreatable)}
                data-testid="staged-cases-create-selected"
              >
                {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("createSelected", { count: selectedCreatable.length })}
              </Button>
            </SheetFooter>
          )}
        </SheetContent>
      </Sheet>

      <SaveDraftDialog
        open={!!renaming}
        onOpenChange={(next) => !next && setRenaming(null)}
        defaultName={renaming?.name ?? ""}
        mode="rename"
        onSubmit={handleRename}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(next) => !next && setDeleting(null)}
      >
        <AlertDialogContent data-testid="staged-cases-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDescription", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
              data-testid="staged-cases-delete-submit"
            >
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
