"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";

/**
 * Read-only system-level display of the review-feature flag (D-19).
 *
 * The underlying flag is operator-controlled via the
 * `TESTPLANIT_REVIEW_FEATURE_ENABLED` env var. We intentionally render NO
 * mutation control — operators change the value via deployment config and
 * restart, NOT via the admin UI. This card surfaces the resolved state so
 * admins know the system answer at a glance.
 */
export function SystemFeatureCard() {
  const t = useTranslations("admin.workflows.systemFeatureCard");
  const { systemEnabled } = useReviewFeatureEnabled();

  // While loading, treat as undefined so we don't flicker between states.
  // The card always renders some state so operators don't see an empty space.
  const isEnabled = systemEnabled === true;

  return (
    <Card data-testid="system-feature-card">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          data-testid="system-feature-state"
          data-state={isEnabled ? "enabled" : "disabled"}
          className="flex items-center gap-2 text-sm font-medium"
        >
          {isEnabled ? (
            <>
              <CheckCircle2
                className="h-4 w-4 text-success"
                aria-hidden="true"
              />
              <span className="text-success">{t("stateEnabled")}</span>
            </>
          ) : (
            <>
              <XCircle
                className="h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="text-muted-foreground">{t("stateDisabled")}</span>
            </>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {t("operatorNotePrefix")}{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
            {"TESTPLANIT_REVIEW_FEATURE_ENABLED"}
          </code>
          {t("operatorNoteSuffix")}
        </p>
      </CardContent>
    </Card>
  );
}
