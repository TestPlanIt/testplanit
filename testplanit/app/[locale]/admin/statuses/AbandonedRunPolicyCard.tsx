"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ABANDONED_RUN_IDLE_MINUTES_KEY,
  ABANDONED_RUN_MIN_IDLE_MINUTES,
} from "~/lib/services/abandonedRuns";

/**
 * System-level abandoned automated-run policy (the default projects inherit):
 *   - off → no AppConfig row; the hourly sweeper skips every project unless a
 *     project sets its own threshold in Advanced settings.
 *   - on  → value N minutes; incomplete automated runs with no imported
 *     results for N minutes are auto-closed.
 */
export function AbandonedRunPolicyCard() {
  const t = useTranslations("admin.statuses.abandonedRunPolicy");
  const { data: config } = useClientQueries(schema).appConfig.useFindUnique({
    where: { key: ABANDONED_RUN_IDLE_MINUTES_KEY },
  });
  const upsert = useClientQueries(schema).appConfig.useUpsert();
  const remove = useClientQueries(schema).appConfig.useDelete();

  const [enabled, setEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState("");

  useEffect(() => {
    const value = config?.value;
    if (value === undefined) return; // not loaded yet
    if (typeof value === "number" && value > 0) {
      setEnabled(true);
      setIdleMinutes(String(Math.max(1, Math.round(value))));
    } else {
      setEnabled(false);
      setIdleMinutes("");
    }
  }, [config?.value]);

  const isPending = upsert.isPending || remove.isPending;

  const handleSave = async () => {
    try {
      if (!enabled) {
        if (config) {
          await remove.mutateAsync({
            where: { key: ABANDONED_RUN_IDLE_MINUTES_KEY },
          });
        }
      } else {
        const minutes = Number(idleMinutes);
        if (
          !Number.isFinite(minutes) ||
          minutes < ABANDONED_RUN_MIN_IDLE_MINUTES
        ) {
          toast.error(
            t("invalidMinutes", { min: ABANDONED_RUN_MIN_IDLE_MINUTES })
          );
          return;
        }
        const value = Math.round(minutes);
        await upsert.mutateAsync({
          where: { key: ABANDONED_RUN_IDLE_MINUTES_KEY },
          create: { key: ABANDONED_RUN_IDLE_MINUTES_KEY, value },
          update: { value },
        });
      }
      toast.success(t("savedToast"));
    } catch {
      toast.error(t("saveError"));
    }
  };

  return (
    <Card className="mb-6" data-testid="abandoned-run-policy-card">
      <CardHeader>
        <SectionHeader className="flex items-center gap-2">
          <CardTitle>{t("title")}</CardTitle>
          <HelpPopover helpKey="abandonedRunPolicy" />
        </SectionHeader>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-4">
          <Label
            htmlFor="abandoned-run-policy-mode"
            className="flex items-center gap-2"
          >
            <Switch
              id="abandoned-run-policy-mode"
              data-testid="abandoned-run-policy-mode-switch"
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={isPending}
            />
            {t("modeOn")}
          </Label>
          {enabled && (
            <div className="flex items-center gap-2 text-sm">
              <Label
                htmlFor="abandoned-run-policy-minutes"
                className="whitespace-nowrap font-normal"
              >
                {t("minutesBefore")}
              </Label>
              <Input
                id="abandoned-run-policy-minutes"
                data-testid="abandoned-run-policy-minutes-input"
                type="number"
                min={ABANDONED_RUN_MIN_IDLE_MINUTES}
                placeholder="1440"
                value={idleMinutes}
                onChange={(event) => setIdleMinutes(event.target.value)}
                className="w-24"
                aria-label={t("minutesAriaLabel")}
              />
              <span>
                {t("minutesUnit", { minutes: Number(idleMinutes) || 0 })}
              </span>
            </div>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            aria-label={t("save")}
            data-testid="abandoned-run-policy-save"
            className="group gap-0 transition-all duration-200 hover:gap-2"
          >
            <Save className="h-4 w-4" />
            <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-40">
              {t("save")}
            </span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
