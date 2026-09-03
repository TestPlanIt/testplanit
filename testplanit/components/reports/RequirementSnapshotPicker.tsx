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
import { format } from "date-fns";
import { Camera, Check, ChevronDown, Loader2, Trash2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  useRequirementSnapshotList,
  type RequirementSnapshotOption,
} from "~/hooks/useRequirementSnapshotList";
import { isSnapshotExecutionScoped } from "~/utils/requirementExecutionScope";
import { cn } from "~/utils";
import { getDateFnsLocale } from "~/utils/locales";
import { deleteRequirementSnapshot } from "./requirementSnapshotActions";
import {
  RequirementSnapshotSaveDialog,
  type SavedRequirementSnapshot,
} from "./RequirementSnapshotSaveDialog";

/** The value `null` renders as: the live matrix, or nothing chosen yet. */
export type RequirementSnapshotPickerNullMode = "live" | "none";

const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm hover:bg-accent hover:text-accent-foreground";

/**
 * One Snapshot menu for the requirement reports — the same shape as
 * unified search's saved-searches menu: "Save snapshot" first, then the
 * choices (the live matrix where the report allows it, and every saved
 * snapshot with a per-row delete). The trigger shows the current choice;
 * the two-line record under it carries the selected snapshot's full
 * details. Three uses: the gaps/traceability reports' "Live matrix |
 * snapshot" switch, and the coverage-changes report's baseline (a
 * snapshot is required) and comparison selectors. Capture needs
 * Reporting add/edit and delete needs Reporting delete — the ladders the
 * routes enforce — so a denied write is a toast, never a silent no-op.
 */
export function RequirementSnapshotPicker({
  projectId,
  value,
  onValueChange,
  label,
  nullMode = "live",
  canManage = false,
  canDelete = canManage,
  requirementIds,
  testIdPrefix = "requirement-snapshot",
}: {
  projectId: number;
  value: number | null;
  onValueChange: (next: number | null) => void;
  label: string;
  nullMode?: RequirementSnapshotPickerNullMode;
  /** Shows the capture action (Reporting add/edit). */
  canManage?: boolean;
  /** Shows the per-row delete action (Reporting delete); defaults to `canManage`. */
  canDelete?: boolean;
  /** The report's current scope, forwarded to the capture. */
  requirementIds?: number[];
  testIdPrefix?: string;
}) {
  const t = useTranslations("reports.ui.requirementCoverage");
  const tCommon = useTranslations("common");
  const tScope = useTranslations("requirements.scope");
  const locale = useLocale();
  const dateFnsLocale = getDateFnsLocale(locale);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<RequirementSnapshotOption | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const { options, isLoading } = useRequirementSnapshotList(projectId);
  const selected = options.find((option) => option.id === value) ?? null;

  const formatCaptured = (capturedAt: Date | string) =>
    format(new Date(capturedAt), "PPp", { locale: dateFnsLocale });

  const choose = (next: number | null) => {
    onValueChange(next);
    setOpen(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      await deleteRequirementSnapshot(projectId, deleteTarget.id, queryClient);
      toast.success(t("snapshotDeleted"));
      if (deleteTarget.id === value) onValueChange(null);
    } catch (error) {
      console.error("Requirement traceability snapshot delete failed:", error);
      toast.error(t("snapshotDeleteFailed"));
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  // A freshly captured snapshot is selected only once the refetched list
  // actually contains it, so the trigger and the record below never point
  // at an id the list cannot describe.
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(null);
  useEffect(() => {
    if (pendingSelectId === null) return;
    if (options.some((option) => option.id === pendingSelectId)) {
      onValueChange(pendingSelectId);
      setPendingSelectId(null);
    }
  }, [options, pendingSelectId, onValueChange]);

  const handleSaved = (snapshot: SavedRequirementSnapshot) => {
    setPendingSelectId(snapshot.id);
  };

  const triggerLabel = selected
    ? selected.name
    : value === null && nullMode === "live"
      ? t("snapshotLive")
      : t("snapshotPlaceholder");

  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between font-normal"
            aria-label={label}
            data-testid={`${testIdPrefix}-trigger`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Camera className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{triggerLabel}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 p-1"
          align="start"
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

          {nullMode === "live" ? (
            <button
              type="button"
              onClick={() => choose(null)}
              aria-current={value === null ? "true" : undefined}
              className={ROW_CLASS}
              data-testid={`${testIdPrefix}-live`}
            >
              <span className="min-w-0 flex-1 truncate">
                {t("snapshotLive")}
              </span>
              {value === null ? <Check className="h-4 w-4 shrink-0" /> : null}
            </button>
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
                    onClick={() => choose(option.id)}
                    aria-current={option.id === value ? "true" : undefined}
                    className={cn(ROW_CLASS, "flex-1")}
                    data-testid={`${testIdPrefix}-option-${option.id}`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate">{option.name}</span>
                        {isSnapshotExecutionScoped(option) && (
                          <Badge
                            variant="outline"
                            className="shrink-0 px-1 py-0 text-[10px] font-normal"
                            title={tScope("snapshotScoped")}
                            data-testid={`${testIdPrefix}-scoped-${option.id}`}
                          >
                            {tScope("scopedBadge")}
                          </Badge>
                        )}
                      </span>
                      {/* One visible line that wraps whatever no longer
                          fits onto a hidden second line, so a part
                          collapses exactly when it stops fitting — last
                          part first: the uncovered count, then the
                          requirement count. The date is first and never
                          wraps; if even it is too long it ellipsizes. */}
                      <span className="flex max-h-4 min-w-0 flex-wrap gap-x-1 overflow-hidden text-xs leading-4 text-muted-foreground">
                        <span
                          className="min-w-0 truncate"
                          data-testid={`${testIdPrefix}-meta-date`}
                        >
                          {formatCaptured(option.capturedAt)}
                        </span>
                        <span
                          className="shrink-0 whitespace-nowrap"
                          data-testid={`${testIdPrefix}-meta-requirements`}
                        >
                          {"· "}
                          {t("snapshotRequirementsCount", {
                            count: option.requirementCount,
                          })}
                        </span>
                        <span
                          className="shrink-0 whitespace-nowrap"
                          data-testid={`${testIdPrefix}-meta-uncovered`}
                        >
                          {"· "}
                          {t("snapshotUncoveredCount", {
                            count: option.uncoveredCount.toLocaleString(locale),
                          })}
                        </span>
                      </span>
                    </span>
                    {option.id === value ? (
                      <Check className="h-4 w-4 shrink-0" />
                    ) : null}
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
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      {selected ? (
        <div
          className="text-xs text-muted-foreground"
          data-testid={`${testIdPrefix}-captured`}
        >
          {/* The full record for the selected snapshot, on two lines —
              nothing the menu had to collapse is lost here. */}
          <p>
            {t("snapshotCapturedBy", {
              date: formatCaptured(selected.capturedAt),
              user: selected.capturedBy?.name ?? "—",
            })}
          </p>
          <p data-testid={`${testIdPrefix}-captured-counts`}>
            {t("snapshotRequirementsCount", {
              count: selected.requirementCount,
            })}
            {" · "}
            {t("snapshotUncoveredCount", {
              count: selected.uncoveredCount.toLocaleString(locale),
            })}
          </p>
        </div>
      ) : null}

      {canManage ? (
        <RequirementSnapshotSaveDialog
          projectId={projectId}
          open={saveOpen}
          onOpenChange={setSaveOpen}
          requirementIds={requirementIds}
          onSaved={handleSaved}
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
    </div>
  );
}
