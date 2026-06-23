"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { Label } from "~/components/ui/label";
import { PaginationProvider } from "~/lib/contexts/PaginationContext";
import { ProjectReviewToggleList } from "./ProjectReviewToggleList";

const REMINDER_THRESHOLD_KEY = "review_reminder_threshold_days";
const REMINDER_THRESHOLD_DEFAULT = 1;

function parseStoredDays(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { days?: unknown }).days === "number" &&
    Number.isFinite((value as { days: number }).days) &&
    (value as { days: number }).days >= 0
  ) {
    return (value as { days: number }).days;
  }
  return REMINDER_THRESHOLD_DEFAULT;
}

export function SystemFeatureCard() {
  const t = useTranslations("admin.workflows.systemFeatureCard");
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { systemEnabled, isLoading } = useReviewFeatureEnabled();
  const upsertAppConfig = useClientQueries(schema).appConfig.useUpsert();

  const isAdmin = session?.user?.access === "ADMIN";
  const isEnabled = systemEnabled === true;
  const disabled = isLoading || upsertAppConfig.isPending || !isAdmin;

  const { data: thresholdConfig, isLoading: thresholdLoading } =
    useClientQueries(schema).appConfig.useFindUnique(
      { where: { key: REMINDER_THRESHOLD_KEY } },
      { enabled: isAdmin && isEnabled }
    );
  const persistedThresholdDays = parseStoredDays(thresholdConfig?.value);
  const [thresholdInput, setThresholdInput] = useState<string>("");
  useEffect(() => {
    if (!thresholdLoading) {
      setThresholdInput(String(persistedThresholdDays));
    }
  }, [thresholdLoading, persistedThresholdDays]);

  const remindersEnabled = persistedThresholdDays > 0;
  const parsedThresholdInput = Number(thresholdInput);
  const thresholdIsValid =
    thresholdInput !== "" &&
    Number.isFinite(parsedThresholdInput) &&
    Number.isInteger(parsedThresholdInput) &&
    parsedThresholdInput >= 1;
  const thresholdIsDirty =
    thresholdIsValid && parsedThresholdInput !== persistedThresholdDays;
  const thresholdSaveDisabled =
    !thresholdIsDirty || disabled || thresholdLoading;

  const handleToggle = async (next: boolean) => {
    try {
      await upsertAppConfig.mutateAsync({
        where: { key: "review_feature_enabled" },
        create: { key: "review_feature_enabled", value: next },
        update: { value: next },
      });
      await queryClient.invalidateQueries({
        queryKey: ["config", "review-feature"],
      });
      toast.success(
        next ? t("updateSuccessEnabled") : t("updateSuccessDisabled")
      );
    } catch {
      toast.error(t("updateError"));
    }
  };

  const persistThreshold = async (nextValue: number) => {
    try {
      await upsertAppConfig.mutateAsync({
        where: { key: REMINDER_THRESHOLD_KEY },
        create: { key: REMINDER_THRESHOLD_KEY, value: nextValue },
        update: { value: nextValue },
      });
      toast.success(t("thresholdUpdateSuccess"));
    } catch {
      toast.error(t("thresholdUpdateError"));
    }
  };

  const handleRemindersToggle = (next: boolean) => {
    void persistThreshold(next ? 1 : 0);
  };

  const handleThresholdSave = () => {
    if (!thresholdIsValid) return;
    void persistThreshold(parsedThresholdInput);
  };

  return (
    <Card data-testid="system-feature-card">
      <CardHeader>
        <Label className="flex items-center gap-3">
          <Switch
            id="system-feature-toggle"
            data-testid="system-feature-toggle"
            aria-label={t("toggleAriaLabel")}
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={disabled}
          />
          <CardTitle>{t("title")}</CardTitle>
        </Label>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      {!isAdmin && (
        <CardContent>
          <p
            data-testid="system-feature-admin-only-notice"
            className="text-sm text-muted-foreground"
          >
            {t("adminOnlyNotice")}
          </p>
        </CardContent>
      )}
      {isAdmin && isEnabled && (
        <CardContent>
          <div
            data-testid="reminder-threshold-row"
            className="flex flex-col gap-2 mb-6"
          >
            <Label className="flex items-center gap-3 text-sm font-medium">
              <Switch
                id="reminders-enabled-toggle"
                data-testid="reminders-enabled-toggle"
                aria-label={t("remindersToggleAriaLabel")}
                checked={remindersEnabled}
                onCheckedChange={handleRemindersToggle}
                disabled={disabled || thresholdLoading}
              />
              <span>{t("remindersToggleLabel")}</span>
            </Label>
            {remindersEnabled && (
              <>
                <Label
                  htmlFor="reminder-threshold-input"
                  className="text-sm font-medium"
                >
                  {t("thresholdLabel")}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="reminder-threshold-input"
                    data-testid="reminder-threshold-input"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={thresholdInput}
                    onChange={(e) => setThresholdInput(e.target.value)}
                    disabled={disabled || thresholdLoading}
                    className="w-32"
                    aria-describedby="reminder-threshold-help"
                  />
                  <span className="text-sm text-muted-foreground">
                    {t("thresholdUnit")}
                  </span>
                  <Button
                    type="button"
                    data-testid="reminder-threshold-save"
                    size="sm"
                    onClick={handleThresholdSave}
                    disabled={thresholdSaveDisabled}
                  >
                    {t("thresholdSaveButton")}
                  </Button>
                </div>
                <p
                  id="reminder-threshold-help"
                  className="text-sm text-muted-foreground"
                >
                  {t("thresholdHelp")}
                </p>
              </>
            )}
          </div>
          <PaginationProvider defaultPageSize={10}>
            <ProjectReviewToggleList />
          </PaginationProvider>
        </CardContent>
      )}
    </Card>
  );
}
