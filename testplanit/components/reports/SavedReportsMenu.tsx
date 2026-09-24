"use client";

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
import { Textarea } from "@/components/ui/textarea";
import {
  Bookmark,
  ChartNoAxesColumn,
  Loader2,
  Pencil,
  Snowflake,
  Trash,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  SAVED_REPORT_DESCRIPTION_MAX_LENGTH,
  SAVED_REPORT_NAME_MAX_LENGTH,
  savedReportHref,
  useSavedReports,
  type SavedReport,
} from "~/hooks/useSavedReports";

interface SavedReportsMenuProps {
  /** The page's project; null on the cross-project reports page. */
  projectId: number | null;
}

/**
 * The current user's saved reports for this page: open, rename, delete.
 * Saving happens from the report's own header (SaveReportButton).
 */
export function SavedReportsMenu({ projectId }: SavedReportsMenuProps) {
  const t = useTranslations("reports.savedReports");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<SavedReport | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SavedReport | null>(null);

  const { reports, isLoading, renameReport, deleteReport, isMutating } =
    useSavedReports({ projectId, enabled: open || renameTarget !== null });

  const handleOpenReport = (report: SavedReport) => {
    setOpen(false);
    const href = savedReportHref(report);
    if (report.frozen) {
      // The frozen viewer is a standalone page; keep the reports page open.
      window.open(href, "_blank", "noopener,noreferrer");
    } else {
      // A full load: ReportBuilder hydrates its state from the URL on mount.
      window.location.assign(href);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    try {
      await renameReport({
        id: renameTarget.id,
        name: renameName,
        description: renameDescription,
      });
      toast.success(t("renamed"));
      setRenameTarget(null);
    } catch (error) {
      console.error("Error renaming saved report:", error);
      toast.error(t("renameFailed"));
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteReport(deleteTarget.id);
      toast.success(t("deleted"));
      setDeleteTarget(null);
    } catch (error) {
      console.error("Error deleting saved report:", error);
      toast.error(t("deleteFailed"));
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" data-testid="saved-reports-trigger">
            <Bookmark className="h-4 w-4" />
            {t("title")}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-1"
          align="end"
          data-testid="saved-reports-menu"
        >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tCommon("loading")}
            </div>
          ) : reports.length === 0 ? (
            <div className="px-2 py-3 text-center">
              <p
                className="text-xs text-muted-foreground"
                data-testid="saved-reports-empty"
              >
                {t("empty")}
              </p>
              <p className="text-xs text-muted-foreground">{t("emptyHint")}</p>
            </div>
          ) : (
            <ul
              className="max-h-72 overflow-y-auto"
              data-testid="saved-reports-list"
            >
              {reports.map((report) => (
                <li key={report.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenReport(report)}
                    title={report.description ?? undefined}
                    aria-label={t("open", { name: report.title })}
                    className="group/item flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground"
                    data-testid="saved-report-item"
                  >
                    {report.frozen ? (
                      <Snowflake
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/item:text-accent-foreground"
                        aria-label={t("frozenBadge")}
                      />
                    ) : (
                      <ChartNoAxesColumn className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/item:text-accent-foreground" />
                    )}
                    <span className="truncate">{report.title}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    aria-label={t("rename")}
                    onClick={() => {
                      setRenameName(report.title);
                      setRenameDescription(report.description ?? "");
                      setRenameTarget(report);
                      setOpen(false);
                    }}
                    data-testid="saved-report-rename"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    aria-label={tCommon("actions.delete")}
                    onClick={() => {
                      setDeleteTarget(report);
                      setOpen(false);
                    }}
                    data-testid="saved-report-delete"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRenameTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("renameTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="saved-report-rename-name">
                {tCommon("name")}
              </Label>
              <Input
                id="saved-report-rename-name"
                value={renameName}
                onChange={(event) => setRenameName(event.target.value)}
                maxLength={SAVED_REPORT_NAME_MAX_LENGTH}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleRename();
                  }
                }}
                data-testid="saved-report-rename-input"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="saved-report-rename-description">
                {tCommon("fields.description")}
              </Label>
              <Textarea
                id="saved-report-rename-description"
                value={renameDescription}
                onChange={(event) => setRenameDescription(event.target.value)}
                maxLength={SAVED_REPORT_DESCRIPTION_MAX_LENGTH}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={isMutating}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              onClick={() => void handleRename()}
              disabled={isMutating || !renameName.trim()}
              data-testid="saved-report-rename-submit"
            >
              {isMutating && <Loader2 className="h-4 w-4 animate-spin" />}
              {tCommon("actions.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirm", { name: deleteTarget?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isMutating}>
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isMutating}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="saved-report-delete-confirm"
            >
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
