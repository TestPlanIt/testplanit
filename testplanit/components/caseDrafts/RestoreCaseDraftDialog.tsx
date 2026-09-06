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
import { formatDistanceToNow } from "date-fns";
import { History } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React from "react";
import type { CaseDraftPayload } from "~/lib/services/caseDraft";
import { getDateFnsLocale } from "~/utils/locales";

interface RestoreCaseDraftDialogProps {
  draft: CaseDraftPayload | null;
  /** "case" is an edit in progress; "folder" is a new case never saved. */
  scopeKind: "case" | "folder";
  /** The draft was written against an older version of the case. */
  isStale?: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}

/**
 * Offered when an editor opens on a case that already has an unsaved draft.
 * Deliberately an AlertDialog with no dismiss-by-outside-click path: both
 * answers destroy something (the draft, or the saved content the user is
 * looking at), so the choice has to be explicit.
 */
export function RestoreCaseDraftDialog({
  draft,
  scopeKind,
  isStale = false,
  onRestore,
  onDiscard,
}: RestoreCaseDraftDialogProps) {
  // Flat keys: next-intl does not resolve a fourth nesting level, so this is
  // `repository.draft.restoreTitle`, not `repository.draft.restore.title`.
  const t = useTranslations("repository.draft");
  const locale = useLocale();
  const isNewCase = scopeKind === "folder";

  const age = React.useMemo(() => {
    if (!draft) return "";
    const savedAt = new Date(draft.savedAt);
    if (Number.isNaN(savedAt.getTime())) return "";
    return formatDistanceToNow(savedAt, {
      addSuffix: true,
      locale: getDateFnsLocale(locale),
    });
  }, [draft, locale]);

  return (
    <AlertDialog open={!!draft}>
      <AlertDialogContent data-testid="restore-case-draft-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            {t(isNewCase ? "restoreTitleNew" : "restoreTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(isNewCase ? "restoreDescriptionNew" : "restoreDescription", {
              age,
            })}
            {isStale && (
              <span className="mt-2 block text-destructive">
                {t("restoreStaleWarning")}
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            data-testid="restore-case-draft-discard"
            onClick={onDiscard}
          >
            {t("restoreDiscard")}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="restore-case-draft-restore"
            onClick={onRestore}
          >
            {t("restoreRestore")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default RestoreCaseDraftDialog;
