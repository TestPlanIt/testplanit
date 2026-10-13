"use client";

import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { History } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import React from "react";
import type { CaseDraftPayload } from "~/lib/services/caseDraft";
import { getDateFnsLocale } from "~/utils/locales";

interface CaseDraftRecoveryBannerProps {
  draft: CaseDraftPayload | null;
  onResume: () => void;
  onDiscard: () => void;
}

/**
 * Read-mode notice that an unsaved draft exists for this case.
 *
 * After a crash or a session timeout the user lands here, not in the editor,
 * and the page shows the last *saved* content — which reads exactly like the
 * work being gone. The banner is what makes the draft discoverable; the
 * restore dialog only appears once they are already editing.
 */
export function CaseDraftRecoveryBanner({
  draft,
  onResume,
  onDiscard,
}: CaseDraftRecoveryBannerProps) {
  const t = useTranslations("repository.draft");
  const locale = useLocale();

  const age = React.useMemo(() => {
    if (!draft) return "";
    const savedAt = new Date(draft.savedAt);
    if (Number.isNaN(savedAt.getTime())) return "";
    return formatDistanceToNow(savedAt, {
      addSuffix: true,
      locale: getDateFnsLocale(locale),
    });
  }, [draft, locale]);

  if (!draft) return null;

  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
      role="status"
      data-testid="case-draft-recovery-banner"
    >
      <History className="h-4 w-4 shrink-0 text-primary" />
      <span className="flex-1 min-w-0">{t("bannerText", { age })}</span>
      <Button
        type="button"
        size="sm"
        onClick={onResume}
        data-testid="case-draft-banner-resume"
      >
        {t("bannerAction")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDiscard}
        data-testid="case-draft-banner-discard"
      >
        {t("bannerDiscard")}
      </Button>
    </div>
  );
}

export default CaseDraftRecoveryBanner;
