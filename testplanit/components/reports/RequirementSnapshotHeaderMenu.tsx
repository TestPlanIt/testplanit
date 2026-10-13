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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Camera, ClipboardList, Loader2, Trash } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
  useRequirementSnapshotList,
  type RequirementSnapshotOption,
} from "~/hooks/useRequirementSnapshotList";
import { cn } from "~/utils";
import { getDateFnsLocale } from "~/utils/locales";
import { deleteRequirementSnapshot } from "./requirementSnapshotActions";
import { RequirementSnapshotSaveDialog } from "./RequirementSnapshotSaveDialog";
import type { RequirementExecutionScopeSelection } from "~/utils/requirementExecutionScope";

const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground";

/**
 * The Requirements page header's Snapshots menu — the saved-searches
 * shape shared with the reports' snapshot pickers: "Save snapshot"
 * first, then every saved snapshot as a row. Clicking a row opens the
 * snapshot in the Requirement Traceability report — the virtualized
 * table handles any size, which is why there is no PDF here: the report
 * (with its CSV export) IS the document. Capture needs Reporting add/edit
 * and the per-row delete needs Reporting delete, the ladders the routes
 * enforce.
 */
export function RequirementSnapshotHeaderMenu({
  projectId,
  canManage,
  canDelete,
  onOpen,
  executionScope,
  testIdPrefix = "requirements-snapshots",
}: {
  projectId: number;
  /** Shows the capture action (Reporting add/edit). */
  canManage: boolean;
  /** Shows the per-row delete action (Reporting delete). */
  canDelete: boolean;
  /** Opens the chosen snapshot in the Requirement Traceability report. */
  onOpen: (snapshotId: number) => void;
  /** The launching page's coverage execution scope, frozen onto a capture
   *  started from here (see the save dialog). */
  executionScope?: RequirementExecutionScopeSelection;
  testIdPrefix?: string;
}) {
  const t = useTranslations("reports.ui.requirementCoverage");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<RequirementSnapshotOption | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { options, isLoading } = useRequirementSnapshotList(projectId);

  const formatCaptured = (capturedAt: Date | string) =>
    format(new Date(capturedAt), "PPp", { locale: dateFnsLocale });

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteRequirementSnapshot(projectId, deleteTarget.id, queryClient);
      toast.success(t("snapshotDeleted"));
    } catch (error) {
      console.error("Requirement traceability snapshot delete failed:", error);
      toast.error(t("snapshotDeleteFailed"));
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={t("snapshotsMenu")}
                data-testid={`${testIdPrefix}-trigger`}
              >
                <Camera className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t("snapshotsMenu")}</TooltipContent>
        </Tooltip>
        <PopoverContent
          className="w-80 p-1"
          align="end"
          data-testid={`${testIdPrefix}-menu`}
        >
          {canManage ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setSaveOpen(true);
                }}
                className={cn(ROW_CLASS, "font-medium")}
                data-testid={`${testIdPrefix}-save`}
              >
                <Camera className="h-4 w-4 shrink-0" />
                {t("saveSnapshot")}
              </button>
              <Separator className="my-1" />
            </>
          ) : null}

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {tCommon("loading")}
            </div>
          ) : options.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {t("noSnapshots")}
            </p>
          ) : (
            <ul
              className="max-h-72 overflow-y-auto"
              data-testid={`${testIdPrefix}-list`}
            >
              {options.map((option) => (
                <li key={option.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    title={t("openSnapshotInReport")}
                    onClick={() => {
                      setOpen(false);
                      onOpen(option.id);
                    }}
                    className={cn(ROW_CLASS, "group/item flex-1")}
                    data-testid={`${testIdPrefix}-open-${option.id}`}
                  >
                    <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover/item:text-accent-foreground" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{option.name}</span>
                      {/* One visible line; whatever no longer fits wraps
                          onto a hidden second line — the uncovered count
                          drops first, then the requirement count, never
                          the date. */}
                      <span className="flex max-h-4 min-w-0 flex-wrap gap-x-1 overflow-hidden text-xs leading-4 text-muted-foreground">
                        <span className="min-w-0 truncate">
                          {formatCaptured(option.capturedAt)}
                        </span>
                        <span className="shrink-0 whitespace-nowrap">
                          {"· "}
                          {t("snapshotRequirementsCount", {
                            count: option.requirementCount,
                          })}
                        </span>
                        <span className="shrink-0 whitespace-nowrap">
                          {"· "}
                          {t("snapshotUncoveredCount", {
                            count: option.uncoveredCount.toLocaleString(locale),
                          })}
                        </span>
                      </span>
                    </span>
                  </button>
                  {canDelete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      aria-label={t("deleteSnapshot")}
                      onClick={() => {
                        setDeleteTarget(option);
                        setOpen(false);
                      }}
                      data-testid={`${testIdPrefix}-delete-${option.id}`}
                    >
                      <Trash className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {canManage ? (
        <RequirementSnapshotSaveDialog
          projectId={projectId}
          open={saveOpen}
          onOpenChange={setSaveOpen}
          executionScope={executionScope}
        />
      ) : null}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(next) => !next && setDeleteTarget(null)}
      >
        <AlertDialogContent data-testid={`${testIdPrefix}-delete-dialog`}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteSnapshotTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteSnapshotDescription", {
                name: deleteTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              data-testid={`${testIdPrefix}-delete-cancel`}
            >
              {tCommon("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`${testIdPrefix}-delete-confirm`}
            >
              {t("deleteSnapshot")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
