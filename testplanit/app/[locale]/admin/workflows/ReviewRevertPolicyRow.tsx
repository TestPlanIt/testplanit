"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  REVERT_DECISION_DURATION_KEY,
  REVERT_DECISION_WINDOW_SECONDS_DEFAULT,
} from "~/lib/services/reviewRevertWindow";

type PolicyMode = "none" | "disabled" | "max";

const DEFAULT_HOURS = Math.round(REVERT_DECISION_WINDOW_SECONDS_DEFAULT / 3600);
const DEFAULT_MINUTES = Math.round(REVERT_DECISION_WINDOW_SECONDS_DEFAULT / 60);

/**
 * System-level revert-decision policy, rendered as a row inside the review
 * workflow card:
 *   - none     → no AppConfig row; projects decide, falling back to the
 *                built-in default window.
 *   - disabled → value 0; reverting off everywhere, projects cannot override.
 *   - max      → value N seconds; projects may tighten down to [0, N].
 *
 * Unlike the result-editing policy, "none" is NOT unrestricted: a decision
 * reverted long after the fact is confusing, so an unconfigured install still
 * gets the default bound. System admins bypass the window entirely.
 */
export function ReviewRevertPolicyRow({
  disabled = false,
}: {
  disabled?: boolean;
}) {
  const t = useTranslations("admin.workflows.systemFeatureCard.revertPolicy");
  const tCommon = useTranslations("common");
  const { data: config, isLoading } = useClientQueries(
    schema
  ).appConfig.useFindUnique({
    where: { key: REVERT_DECISION_DURATION_KEY },
  });
  const upsert = useClientQueries(schema).appConfig.useUpsert();
  const remove = useClientQueries(schema).appConfig.useDelete();

  const storedValue = config?.value;
  const persistedMode: PolicyMode =
    typeof storedValue === "number" && storedValue > 0
      ? "max"
      : storedValue === 0
        ? "disabled"
        : "none";
  const persistedMinutes =
    persistedMode === "max"
      ? Math.max(1, Math.round((storedValue as number) / 60))
      : null;

  const [mode, setMode] = useState<PolicyMode>("none");
  const [maxMinutes, setMaxMinutes] = useState("");

  useEffect(() => {
    if (isLoading) return;
    setMode(persistedMode);
    setMaxMinutes(persistedMinutes === null ? "" : String(persistedMinutes));
  }, [isLoading, persistedMode, persistedMinutes]);

  const isPending = upsert.isPending || remove.isPending;
  const controlsDisabled = disabled || isLoading || isPending;

  const parsedMinutes = Number(maxMinutes);
  const minutesAreValid =
    maxMinutes !== "" &&
    Number.isFinite(parsedMinutes) &&
    Number.isInteger(parsedMinutes) &&
    parsedMinutes >= 1;
  const isDirty =
    mode !== persistedMode ||
    (mode === "max" && minutesAreValid && parsedMinutes !== persistedMinutes);
  const saveDisabled =
    controlsDisabled || !isDirty || (mode === "max" && !minutesAreValid);

  const handleSave = async () => {
    try {
      if (mode === "none") {
        if (config) {
          await remove.mutateAsync({
            where: { key: REVERT_DECISION_DURATION_KEY },
          });
        }
      } else {
        let value: number;
        if (mode === "disabled") {
          value = 0;
        } else {
          const minutes = Number(maxMinutes);
          if (!Number.isFinite(minutes) || minutes <= 0) {
            toast.error(t("invalidMinutes"));
            return;
          }
          value = Math.round(minutes * 60);
        }
        await upsert.mutateAsync({
          where: { key: REVERT_DECISION_DURATION_KEY },
          create: { key: REVERT_DECISION_DURATION_KEY, value },
          update: { value },
        });
      }
      toast.success(t("savedToast"));
    } catch {
      toast.error(t("saveError"));
    }
  };

  return (
    <div
      data-testid="revert-policy-row"
      className="mb-6 flex flex-wrap items-center gap-2"
    >
      <Label
        htmlFor="revert-policy-mode"
        className="text-sm font-medium whitespace-nowrap"
      >
        {t("label")}
      </Label>
      <Select
        value={mode}
        onValueChange={(value) => {
          const next = value as PolicyMode;
          setMode(next);
          if (next === "max" && maxMinutes === "") {
            setMaxMinutes(String(persistedMinutes ?? DEFAULT_MINUTES));
          }
        }}
        disabled={controlsDisabled}
      >
        <SelectTrigger
          id="revert-policy-mode"
          className="w-auto min-w-64"
          data-testid="revert-policy-mode-select"
          aria-label={t("modeAria")}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">
            {t("modeNone", { hours: DEFAULT_HOURS })}
          </SelectItem>
          <SelectItem value="disabled">{t("modeDisabled")}</SelectItem>
          <SelectItem value="max">{t("modeMax")}</SelectItem>
        </SelectContent>
      </Select>
      {mode === "max" && (
        <>
          <Input
            id="revert-policy-minutes"
            data-testid="revert-policy-minutes-input"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={maxMinutes}
            onChange={(event) => setMaxMinutes(event.target.value)}
            disabled={controlsDisabled}
            aria-label={t("minutesAriaLabel")}
            className="w-24"
          />
          <span className="text-sm font-medium">
            {t("minutesUnit", { minutes: Number(maxMinutes) || 0 })}
          </span>
        </>
      )}
      <HelpPopover helpKey="reviewRevert" />
      <Button
        type="button"
        onClick={handleSave}
        disabled={saveDisabled}
        aria-label={tCommon("actions.save")}
        data-testid="revert-policy-save"
        className="group gap-0 transition-all duration-200 hover:gap-2"
      >
        <Save className="h-4 w-4" />
        <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
          {tCommon("actions.save")}
        </span>
      </Button>
    </div>
  );
}
