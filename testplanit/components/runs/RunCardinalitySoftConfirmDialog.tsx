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
import { useTranslations } from "next-intl";

import type { PreflightResult } from "~/lib/types/iterationCardinality";

export interface RunCardinalitySoftConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: PreflightResult | null;
  configCount: number;
  /** Called when the user confirms; the parent then proceeds to submit. */
  onConfirm: () => void;
}

/**
 * Surface E.3 — Soft-confirmation dialog for the 1001..5000 cardinality band.
 *
 * Shown when the user clicks Submit while the chip reads `softConfirm`.
 * On confirm, closes itself and invokes `onConfirm()` so the modal can
 * proceed with the existing create-run + fan-out flow.
 */
export function RunCardinalitySoftConfirmDialog({
  open,
  onOpenChange,
  result,
  configCount,
  onConfirm,
}: RunCardinalitySoftConfirmDialogProps) {
  const t = useTranslations("parameters");
  const tCommon = useTranslations("common");

  if (!result) return null;
  const cases = result.perCase.length;
  const configs = Math.max(1, configCount);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="run-cardinality-soft-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("softConfirmTitle", { n: result.total })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("softConfirmDescription", {
              n: result.total,
              cases,
              configs,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel data-testid="soft-confirm-cancel-button">
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
              onOpenChange(false);
            }}
            data-testid="soft-confirm-confirm-button"
          >
            {t("softConfirmGo")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
