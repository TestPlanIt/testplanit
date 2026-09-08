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
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useReviewFeatureEnabled } from "~/hooks/useReviewFeatureEnabled";
import { Label } from "~/components/ui/label";
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

export function SystemFeatureCard({
  embedded = false,
}: {
  /** Render the review-workflow controls inline (no surrounding Card) so they
   * can live inside another card's content. Defaults to a standalone Card. */
  embedded?: boolean;
} = {}) {
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

  // Reveal/hide the settings smoothly when the feature is toggled: keep the
  // content mounted while it collapses, then unmount it — so it isn't rendered
  // (or its per-project list fetched) while the feature is off, yet it still
  // animates out rather than snapping away.
  const [renderSettings, setRenderSettings] = useState(isEnabled);
  const [settingsExpanded, setSettingsExpanded] = useState(isEnabled);
  useEffect(() => {
    if (isEnabled) {
      setRenderSettings(true);
      const raf = requestAnimationFrame(() => setSettingsExpanded(true));
      return () => cancelAnimationFrame(raf);
    }
    setSettingsExpanded(false);
    const timer = setTimeout(() => setRenderSettings(false), 300);
    return () => clearTimeout(timer);
  }, [isEnabled]);

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

  const header = (
    <Label className="flex w-fit items-center gap-3">
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
  );

  const adminOnlyNotice = (
    <p
      data-testid="system-feature-admin-only-notice"
      className="text-sm text-muted-foreground"
    >
      {t("adminOnlyNotice")}
    </p>
  );

  const settings = (
    <>
      <div
        data-testid="reminder-threshold-row"
        className="mb-6 flex flex-wrap items-center gap-2"
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
        <Input
          id="reminder-threshold-input"
          data-testid="reminder-threshold-input"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={thresholdInput}
          onChange={(e) => setThresholdInput(e.target.value)}
          disabled={disabled || thresholdLoading || !remindersEnabled}
          aria-label={t("thresholdLabel")}
          className="w-16"
        />
        <span className="text-sm font-medium">
          {t("thresholdUnit", { count: Number(thresholdInput) || 0 })}
        </span>
        <HelpPopover helpKey="reviewReminders" />
        <Button
          type="button"
          data-testid="reminder-threshold-save"
          onClick={handleThresholdSave}
          disabled={thresholdSaveDisabled}
          aria-label={t("thresholdSaveButton")}
          className="group gap-0 transition-all duration-200 hover:gap-2"
        >
          <Save className="h-4 w-4" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
            {t("thresholdSaveButton")}
          </span>
        </Button>
      </div>
      <ProjectReviewToggleList />
    </>
  );

  // Animate a collapsing grid row (0fr ↔ 1fr). `renderSettings` keeps the
  // content mounted through the collapse then drops it, so it's absent while the
  // feature is off; `settingsExpanded` drives the open/closed row.
  const collapsibleSettings = (padded: boolean) =>
    renderSettings ? (
      <div
        aria-hidden={!settingsExpanded}
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
          settingsExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          {padded ? <div className="px-6 pb-6">{settings}</div> : settings}
        </div>
      </div>
    ) : null;

  if (embedded) {
    // Description is surfaced by the parent card's help popover here, so it is
    // omitted inline; the standalone Card below keeps it (e.g. project settings).
    return (
      <div data-testid="system-feature-card" className="flex flex-col gap-4">
        {header}
        {!isAdmin && adminOnlyNotice}
        {isAdmin && collapsibleSettings(false)}
      </div>
    );
  }

  return (
    <Card data-testid="system-feature-card">
      <CardHeader>
        {header}
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      {!isAdmin && <CardContent>{adminOnlyNotice}</CardContent>}
      {isAdmin && collapsibleSettings(true)}
    </Card>
  );
}
