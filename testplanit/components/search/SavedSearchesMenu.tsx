"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
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
  Bookmark,
  BookmarkPlus,
  Loader2,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  parseSavedSearchConfig,
  type SavedSearchCriteria,
} from "~/lib/schemas/savedSearch";

import { SaveSearchDialog } from "./SaveSearchDialog";

interface SavedSearchesMenuProps {
  /** The live Unified Search state, captured if the user chooses Save search. */
  criteria: SavedSearchCriteria;
  /** Whether there is anything worth saving (a query or an active filter). */
  canSave: boolean;
  onLoad: (criteria: SavedSearchCriteria) => void;
}

interface SavedSearchTarget {
  id: string;
  title: string;
  description: string;
}

/**
 * Single menu for saved searches: "Save search" is the first option, followed
 * by the user's own saved searches (ShareLinks of entityType SEARCH). Loading
 * one applies the persisted criteria and re-runs the search against the latest
 * data.
 */
export function SavedSearchesMenu({
  criteria,
  canSave,
  onLoad,
}: SavedSearchesMenuProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SavedSearchTarget | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SavedSearchTarget | null>(
    null
  );

  const {
    data: savedSearches,
    isLoading,
    refetch,
  } = useClientQueries(schema).shareLink.useFindMany(
    {
      where: { entityType: "SEARCH", isDeleted: false, isRevoked: false },
      orderBy: { updatedAt: "desc" },
    },
    { enabled: open }
  );

  const { mutateAsync: updateShareLink, isPending: isMutating } =
    useClientQueries(schema).shareLink.useUpdate();

  const handleLoad = (saved: {
    id: string;
    entityConfig: unknown;
    title: string | null;
  }) => {
    const loaded = parseSavedSearchConfig(saved.entityConfig);
    if (!loaded) {
      toast.error(t("search.savedSearches.loadFailed"));
      return;
    }
    onLoad(loaded);
    setOpen(false);
    toast.success(
      t("search.savedSearches.loaded", { name: saved.title ?? "" })
    );
  };

  const openEdit = (target: SavedSearchTarget) => {
    setEditName(target.title);
    setEditDescription(target.description);
    setEditTarget(target);
    setOpen(false);
  };

  const handleEdit = async () => {
    if (!editTarget) return;
    const trimmed = editName.trim();
    if (!trimmed) return;

    try {
      await updateShareLink({
        where: { id: editTarget.id },
        data: { title: trimmed, description: editDescription.trim() || null },
      });
      toast.success(t("search.savedSearches.edited"));
      void refetch();
      setEditTarget(null);
    } catch {
      toast.error(t("search.savedSearches.editFailed"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;

    try {
      await updateShareLink({
        where: { id: deleteTarget.id },
        data: { isDeleted: true },
      });
      toast.success(t("search.savedSearches.deleted"));
      void refetch();
      setDeleteTarget(null);
    } catch {
      toast.error(t("search.savedSearches.deleteFailed"));
    }
  };

  const items = savedSearches ?? [];

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("search.savedSearches.title")}
            title={t("search.savedSearches.title")}
            data-testid="saved-searches-trigger"
          >
            <Bookmark className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-1" align="end">
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              setOpen(false);
              setSaveDialogOpen(true);
            }}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            data-testid="save-search-button"
          >
            <BookmarkPlus className="h-4 w-4 shrink-0" />
            {t("search.savedSearches.save")}
          </button>

          <Separator className="my-1" />

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t("search.savedSearches.empty")}
            </p>
          ) : (
            <ul
              className="max-h-72 overflow-y-auto"
              data-testid="saved-searches-list"
            >
              {items.map((saved) => (
                <li key={saved.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleLoad(saved)}
                    title={saved.description ?? undefined}
                    className="group/item flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground"
                    data-testid="saved-search-item"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/item:text-accent-foreground" />
                    <span className="truncate">{saved.title}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={t("search.savedSearches.edit")}
                    onClick={() =>
                      openEdit({
                        id: saved.id,
                        title: saved.title ?? "",
                        description: saved.description ?? "",
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    aria-label={t("search.savedSearches.delete")}
                    onClick={() => {
                      setDeleteTarget({
                        id: saved.id,
                        title: saved.title ?? "",
                        description: saved.description ?? "",
                      });
                      setOpen(false);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <SaveSearchDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        criteria={criteria}
      />

      <Dialog
        open={editTarget !== null}
        onOpenChange={(next) => !next && setEditTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("search.savedSearches.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="saved-search-edit-name">
                {t("search.savedSearches.nameLabel")}
              </Label>
              <Input
                id="saved-search-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={120}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleEdit();
                  }
                }}
                data-testid="saved-search-edit-name-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="saved-search-edit-description">
                {t("search.savedSearches.descriptionLabel")}
              </Label>
              <Textarea
                id="saved-search-edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t("search.savedSearches.descriptionPlaceholder")}
                maxLength={500}
                rows={2}
                data-testid="saved-search-edit-description-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditTarget(null)}
              disabled={isMutating}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleEdit}
              disabled={isMutating || !editName.trim()}
            >
              {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("search.savedSearches.saveAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("search.savedSearches.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("search.savedSearches.deleteConfirm", {
                name: deleteTarget?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("search.savedSearches.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
