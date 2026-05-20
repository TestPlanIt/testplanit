"use client";

import { useTranslations } from "next-intl";

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

export interface OverrideUnsavedAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDiscard: () => void;
}

/**
 * UI-SPEC Surface C.5 — nested AlertDialog shown when the user attempts to
 * close the OverrideValuesDialog while the form is dirty. Confirm path
 * discards the in-memory edits; cancel keeps the dialog open so the user
 * can save or continue editing.
 */
export function OverrideUnsavedAlertDialog({
  open,
  onOpenChange,
  onDiscard,
}: OverrideUnsavedAlertDialogProps) {
  const t = useTranslations("parameters");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="override-unsaved-alert">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("overrideUnsavedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("overrideUnsavedDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="override-unsaved-keep">
            {t("overrideUnsavedKeep")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onDiscard();
              onOpenChange(false);
            }}
            data-testid="override-unsaved-discard"
          >
            {t("overrideUnsavedDiscard")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default OverrideUnsavedAlertDialog;
