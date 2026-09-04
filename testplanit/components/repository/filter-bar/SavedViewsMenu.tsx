"use client";

import {
  Bookmark,
  BookmarkPlus,
  Loader2,
  Pencil,
  SlidersHorizontal,
  Trash,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  useSavedRepositoryViews,
  type SavedRepositoryView,
} from "~/hooks/useSavedRepositoryViews";
import type { FilterDimensionRegistry } from "~/lib/repository/filterDimensions";
import type { FilterPredicate } from "~/lib/schemas/repositoryFilterPredicates";
import {
  hasSavableRepositoryViewState,
  SAVED_REPOSITORY_VIEW_DESCRIPTION_MAX_LENGTH,
  SAVED_REPOSITORY_VIEW_NAME_MAX_LENGTH,
  type SavedRepositoryViewCriteria,
} from "~/lib/schemas/savedRepositoryView";

import { SaveViewDialog } from "./SaveViewDialog";

export interface SavedViewsMenuProps {
  projectId: number;
  /** The active mode's registry — the validator persisted predicates parse against. */
  registry: FilterDimensionRegistry;
  /** Live predicates, persisted as-is when the user saves. */
  predicates: FilterPredicate[];
  /** Live grouping axis (`?view=`); null means "the surface's default". */
  axis: string | null;
  /** Applies a view — routed to the FilterBar's own predicate setter. */
  onApply: (criteria: SavedRepositoryViewCriteria) => void;
  /** Dynamic-field ids that still exist, so a stale grouping axis degrades. */
  knownDynamicAxisFieldIds?: ReadonlySet<number>;
}

/**
 * A view describes filters and grouping only. The criteria contract carries a
 * `search` field, but the sole search box lives in the case-selection dialog
 * as a stand-in for Advanced Search, which cannot be opened from inside it —
 * surface-local text that no other surface could reproduce.
 */
const VIEW_SEARCH_TEXT = "";

interface SavedViewTarget {
  id: string;
  title: string;
  description: string;
}

/**
 * The saved-views control on the repository FilterBar: "Save view" first, then
 * this user's views for the project with apply / rename / delete. Modeled on
 * components/search/SavedSearchesMenu.tsx so the two features feel like one
 * idea.
 *
 * Saved views complement the URL, they do not replace it: applying one writes
 * through the FilterBar's own predicate setter (see `onApply`), so the address
 * bar updates and the applied view stays shareable by link. A view whose
 * dimensions no longer exist (deleted custom field, retired grouping) applies
 * its surviving parts and says what it skipped rather than failing.
 *
 * The menu works on every surface that mounts the FilterBar, including the
 * case-selection dialog. Saving needs no URL — it writes the live predicates
 * and axis to a ShareLink row — so memory-only filter state saves and applies
 * exactly like URL-backed state does.
 *
 * Deliberately NOT in ActionOverflow: the kebab collapse remounts its children
 * and breaks the filter-bar testids.
 */
export function SavedViewsMenu({
  projectId,
  registry,
  predicates,
  axis,
  onApply,
  knownDynamicAxisFieldIds,
}: SavedViewsMenuProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedViewTarget | null>(
    null
  );
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SavedViewTarget | null>(
    null
  );

  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const {
    views,
    unreadableCount,
    isLoading,
    saveView,
    renameView,
    deleteView,
    isSaving,
    isMutating,
  } = useSavedRepositoryViews({
    projectId,
    registry,
    knownDynamicAxisFieldIds,
    enabled: open,
  });

  // The popover (and the dialogs it opens) unmount the button that had focus.
  // Send it back to the trigger once React commits, so a keyboard user is not
  // dropped on <body>.
  const returnFocusToTrigger = useCallback(() => {
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const savableState = hasSavableRepositoryViewState({
    predicates,
    axis,
    search: VIEW_SEARCH_TEXT,
  });
  const saveDisabledReason = !savableState
    ? t("repository.savedViews.nothingToSave")
    : null;

  const handleApply = useCallback(
    (view: SavedRepositoryView) => {
      onApply(view.criteria);
      setOpen(false);
      returnFocusToTrigger();

      const degraded: string[] = [];
      if (view.droppedPredicateCount > 0) {
        degraded.push(
          t("repository.savedViews.droppedFilters", {
            count: view.droppedPredicateCount,
          })
        );
      }
      if (view.axisDropped) {
        degraded.push(t("repository.savedViews.droppedGrouping"));
      }

      const applied = t("repository.savedViews.applied", { name: view.title });
      if (degraded.length > 0) {
        toast.warning(applied, { description: degraded.join(" ") });
      } else {
        toast.success(applied);
      }
    },
    [onApply, returnFocusToTrigger, t]
  );

  const handleSave = useCallback(
    async ({ name, description }: { name: string; description: string }) => {
      await saveView({
        name,
        description,
        criteria: { predicates, axis, search: VIEW_SEARCH_TEXT },
      });
      toast.success(t("repository.savedViews.saved"), {
        description: t("repository.savedViews.savedDescription", { name }),
      });
      returnFocusToTrigger();
    },
    [saveView, predicates, axis, t, returnFocusToTrigger]
  );

  const openRename = useCallback((view: SavedRepositoryView) => {
    setRenameName(view.title);
    setRenameDescription(view.description ?? "");
    setRenameTarget({
      id: view.id,
      title: view.title,
      description: view.description ?? "",
    });
    setOpen(false);
  }, []);

  const handleRename = useCallback(async () => {
    if (!renameTarget) return;
    const trimmed = renameName.trim();
    if (!trimmed) return;

    try {
      await renameView({
        id: renameTarget.id,
        name: trimmed,
        description: renameDescription.trim(),
      });
      toast.success(t("repository.savedViews.renamed"));
      setRenameTarget(null);
      returnFocusToTrigger();
    } catch (error) {
      console.error("Error renaming repository view:", error);
      toast.error(t("repository.savedViews.renameFailed"));
    }
  }, [
    renameTarget,
    renameName,
    renameDescription,
    renameView,
    t,
    returnFocusToTrigger,
  ]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;

    try {
      await deleteView(deleteTarget.id);
      toast.success(t("repository.savedViews.deleted"));
      setDeleteTarget(null);
      returnFocusToTrigger();
    } catch (error) {
      console.error("Error deleting repository view:", error);
      toast.error(t("repository.savedViews.deleteFailed"));
    }
  }, [deleteTarget, deleteView, t, returnFocusToTrigger]);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            aria-label={t("repository.savedViews.title")}
            title={t("repository.savedViews.title")}
            data-testid="saved-views-trigger"
          >
            <Bookmark className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-1"
          align="start"
          data-testid="saved-views-menu"
        >
          <button
            type="button"
            disabled={saveDisabledReason !== null}
            onClick={() => {
              setOpen(false);
              setSaveDialogOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            data-testid="save-view-button"
          >
            <BookmarkPlus className="h-4 w-4 shrink-0" />
            {t("repository.savedViews.save")}
          </button>
          {saveDisabledReason && (
            <p
              className="px-2 pb-1 text-xs text-muted-foreground"
              data-testid="save-view-disabled-hint"
            >
              {saveDisabledReason}
            </p>
          )}

          <Separator className="my-1" />

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : views.length === 0 ? (
            <div className="px-2 py-3 text-center">
              <p
                className="text-xs text-muted-foreground"
                data-testid="saved-views-empty"
              >
                {t("repository.savedViews.empty")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("repository.savedViews.emptyHint")}
              </p>
            </div>
          ) : (
            <ul
              className="max-h-72 overflow-y-auto"
              data-testid="saved-views-list"
            >
              {views.map((view) => (
                <li key={view.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleApply(view)}
                    title={view.description ?? undefined}
                    aria-label={t("repository.savedViews.apply", {
                      name: view.title,
                    })}
                    className="group/item flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground"
                    data-testid="saved-view-item"
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/item:text-accent-foreground" />
                    <span className="truncate">{view.title}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={t("repository.savedViews.rename")}
                    onClick={() => openRename(view)}
                    data-testid="saved-view-rename"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    aria-label={t("repository.savedViews.delete")}
                    onClick={() => {
                      setDeleteTarget({
                        id: view.id,
                        title: view.title,
                        description: view.description ?? "",
                      });
                      setOpen(false);
                    }}
                    data-testid="saved-view-delete"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {unreadableCount > 0 && (
            <p
              className="px-2 py-1 text-xs text-muted-foreground italic"
              data-testid="saved-views-unreadable"
            >
              {t("repository.savedViews.unreadable", {
                count: unreadableCount,
              })}
            </p>
          )}
        </PopoverContent>
      </Popover>

      <SaveViewDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        isSaving={isSaving}
        onSave={handleSave}
      />

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRenameTarget(null);
            returnFocusToTrigger();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("repository.savedViews.renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="saved-view-rename-name">{t("common.name")}</Label>
              <Input
                id="saved-view-rename-name"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                maxLength={SAVED_REPOSITORY_VIEW_NAME_MAX_LENGTH}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleRename();
                  }
                }}
                data-testid="saved-view-rename-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="saved-view-rename-description">
                {t("search.savedSearches.descriptionLabel")}
              </Label>
              <Textarea
                id="saved-view-rename-description"
                value={renameDescription}
                onChange={(event) => setRenameDescription(event.target.value)}
                placeholder={t("repository.savedViews.descriptionPlaceholder")}
                maxLength={SAVED_REPOSITORY_VIEW_DESCRIPTION_MAX_LENGTH}
                rows={2}
                data-testid="saved-view-rename-description-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={isMutating}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleRename}
              disabled={isMutating || !renameName.trim()}
              data-testid="saved-view-rename-submit"
            >
              {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("common.actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeleteTarget(null);
            returnFocusToTrigger();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("repository.savedViews.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("repository.savedViews.deleteConfirm", {
                name: deleteTarget?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="saved-view-delete-confirm"
            >
              {t("repository.savedViews.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
