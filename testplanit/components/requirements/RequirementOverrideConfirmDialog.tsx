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

export type RequirementOverrideAction = "promote" | "exclude" | "reset";

interface RequirementOverrideConfirmDialogProps {
  action: RequirementOverrideAction;
  /** The issue's display key (tracker key, or name), named in the copy. */
  issueLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending?: boolean;
}

// Explicit per-action keys (not a template literal) so next-intl's typed
// message keys still check each one.
const COPY = {
  promote: {
    title: "promoteTitle",
    description: "promoteDescription",
    confirm: "promoteConfirm",
  },
  exclude: {
    title: "excludeTitle",
    description: "excludeDescription",
    confirm: "excludeConfirm",
  },
  reset: {
    title: "resetTitle",
    description: "resetDescription",
    confirm: "resetConfirm",
  },
} as const;

/**
 * The one confirmation step in front of every issue <-> requirement
 * conversion (Brad, 2026-09-01): promotion from the Issues page and the
 * Create Requirement dialog, exclusion from the Synced badge, and the
 * reset back to the configured classification. Shared so the three
 * surfaces describe the same consequences in the same words.
 */
export function RequirementOverrideConfirmDialog({
  action,
  issueLabel,
  open,
  onOpenChange,
  onConfirm,
  isPending = false,
}: RequirementOverrideConfirmDialogProps) {
  const t = useTranslations("requirements.override");
  const tCommon = useTranslations("common");
  const copy = COPY[action];

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="requirement-override-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t(copy.title)}</AlertDialogTitle>
          <AlertDialogDescription>
            {t(copy.description, { issue: issueLabel })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="requirement-override-cancel">
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={onConfirm}
            data-testid="requirement-override-confirm"
          >
            {t(copy.confirm)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
