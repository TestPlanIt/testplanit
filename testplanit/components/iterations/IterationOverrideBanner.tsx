"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface IterationOverrideBannerProps {
  onViewHistory?: () => void;
}

/**
 * Surface B.4 — Inline banner shown below the values strip when at least
 * one parameter on the active iteration has been overridden. Parent decides
 * visibility; this component is dumb.
 */
export function IterationOverrideBanner({
  onViewHistory,
}: IterationOverrideBannerProps) {
  const t = useTranslations("parameters");
  return (
    <Alert
      variant="default"
      className="mx-4 my-2 flex items-start gap-3"
      data-testid="iteration-override-banner"
    >
      <Pencil className="h-4 w-4 mt-0.5 shrink-0" />
      <AlertDescription className="flex-1">
        {t("iterationOverrideBanner")}
        {onViewHistory && (
          <Button
            variant="link"
            size="sm"
            className="ms-1 h-auto p-0 align-baseline"
            onClick={onViewHistory}
            data-testid="iteration-override-banner-history"
          >
            {t("iterationViewHistory")}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export default IterationOverrideBanner;
