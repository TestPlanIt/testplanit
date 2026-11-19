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
import { useTranslations } from "next-intl";

interface CaseChangedDialogProps {
  open: boolean;
  /** Throw the user's edits away and show the case as it is now. */
  onReload: () => void;
  /** Save the user's edits over the newer version. */
  onOverwrite: () => void;
  /** Go back to editing with nothing saved. */
  onCancel: () => void;
}

/** Whether a case was saved by someone else since the editor loaded it. */
export function hasCaseChangedSinceLoad(
  loadedVersion: number | null,
  currentVersion: number | null | undefined
): boolean {
  if (loadedVersion == null || currentVersion == null) return false;
  return currentVersion !== loadedVersion;
}

/**
 * Asked at save time when the case was saved by someone else while the user
 * was editing it.
 */
export function CaseChangedDialog({
  open,
  onReload,
  onOverwrite,
  onCancel,
}: CaseChangedDialogProps) {
  const t = useTranslations("repository.caseChanged");

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent data-testid="case-changed-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="case-changed-cancel">
            {t("keepEditing")}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="outline"
            data-testid="case-changed-reload"
            onClick={onReload}
          >
            {t("reload")}
          </Button>
          <AlertDialogAction
            data-testid="case-changed-overwrite"
            onClick={onOverwrite}
          >
            {t("overwrite")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default CaseChangedDialog;
