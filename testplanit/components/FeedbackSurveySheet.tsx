"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from "@/components/ui/sheet";
import { MessageSquareHeart, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

const FEEDBACK_DISMISSED_KEY = "testplanit-feedback-dismissed";
const FEEDBACK_BANNER_DELAY_DAYS = 3;

interface FeedbackSurveySheetProps {
  isOpen: boolean;
  onClose: () => void;
  surveyUrl: string;
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    access?: string | null;
  };
}

/**
 * Renders the Formbricks survey in an iframe inside a slide-out Sheet.
 * Using an iframe ensures complete CSS isolation — Formbricks injects
 * global Tailwind utilities that conflict with the app's own Tailwind styles.
 * User info is passed as hidden fields via URL query parameters.
 */
export function FeedbackSurveySheet({
  isOpen,
  onClose,
  surveyUrl,
  user,
}: FeedbackSurveySheetProps) {
  const t = useTranslations();

  // Build URL with embed flag and user hidden fields
  const embedUrl = (() => {
    const url = new URL(surveyUrl);
    url.searchParams.set("embed", "true");
    if (user?.id) url.searchParams.set("user_id", user.id);
    if (user?.name) url.searchParams.set("user_name", user.name);
    if (user?.email) url.searchParams.set("user_email", user.email);
    if (user?.access) url.searchParams.set("user_role", user.access);
    if (typeof window !== "undefined") {
      url.searchParams.set("tenant_domain", window.location.host);
    }
    return url.toString();
  })();

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="sm:max-w-lg w-full p-0 flex flex-col"
      >
        <SheetHeader className="p-6 pb-2">
          <SheetTitle className="flex items-center gap-2">
            <MessageSquareHeart className="h-5 w-5" />
            {t("feedback.sheetTitle")}
          </SheetTitle>
          <SheetDescription>{t("feedback.sheetDescription")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0">
          <iframe
            src={embedUrl}
            className="w-full h-full border-0"
            title={t("feedback.sheetTitle")}
            allow="clipboard-write"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface FeedbackBannerProps {
  trialStartDaysAgo: number;
  onOpenSurvey: () => void;
}

export function FeedbackBanner({
  trialStartDaysAgo,
  onOpenSurvey,
}: FeedbackBannerProps) {
  const t = useTranslations();
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    const dismissed = localStorage.getItem(FEEDBACK_DISMISSED_KEY);
    if (!dismissed && trialStartDaysAgo >= FEEDBACK_BANNER_DELAY_DAYS) {
      setIsDismissed(false);
    }
  }, [trialStartDaysAgo]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(FEEDBACK_DISMISSED_KEY, "true");
    setIsDismissed(true);
  }, []);

  const handleOpenSurvey = useCallback(() => {
    handleDismiss();
    onOpenSurvey();
  }, [handleDismiss, onOpenSurvey]);

  if (isDismissed) return null;

  return (
    <div className="flex items-center justify-center gap-2 bg-primary/10 border-b border-primary/20 px-4 py-2 text-sm">
      <MessageSquareHeart className="h-4 w-4 text-primary shrink-0" />
      <span className="text-foreground mr-4">
        {t("feedback.bannerMessage")}
      </span>
      <Button variant="secondary" size="sm" onClick={handleOpenSurvey}>
        {t("feedback.menuItem")}
      </Button>
      <button
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground transition-colors ml-1"
        aria-label={t("common.actions.close")}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
