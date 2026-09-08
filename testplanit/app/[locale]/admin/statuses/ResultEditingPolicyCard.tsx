"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const KEY = "edit_results_duration";

type PolicyMode = "none" | "disabled" | "max";

/**
 * System-level result-editing policy (the ceiling projects resolve against):
 *   - none     → no AppConfig row; projects decide freely.
 *   - disabled → value 0; editing off everywhere, projects cannot override.
 *   - max      → value N seconds; projects may tighten down to [0, N].
 */
export function ResultEditingPolicyCard() {
  const t = useTranslations("admin.statuses.editPolicy");
  const { data: config } = useClientQueries(schema).appConfig.useFindUnique({
    where: { key: KEY },
  });
  const upsert = useClientQueries(schema).appConfig.useUpsert();
  const remove = useClientQueries(schema).appConfig.useDelete();

  const [mode, setMode] = useState<PolicyMode>("none");
  const [maxMinutes, setMaxMinutes] = useState("");

  useEffect(() => {
    const value = config?.value;
    if (value === undefined) return; // not loaded yet
    if (typeof value === "number" && value > 0) {
      setMode("max");
      setMaxMinutes(String(Math.max(1, Math.round(value / 60))));
    } else if (value === 0) {
      setMode("disabled");
      setMaxMinutes("");
    } else {
      setMode("none");
      setMaxMinutes("");
    }
  }, [config?.value]);

  const isPending = upsert.isPending || remove.isPending;

  const handleSave = async () => {
    try {
      if (mode === "none") {
        if (config) {
          await remove.mutateAsync({ where: { key: KEY } });
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
          where: { key: KEY },
          create: { key: KEY, value },
          update: { value },
        });
      }
      toast.success(t("savedToast"));
    } catch {
      toast.error(t("saveError"));
    }
  };

  return (
    <Card className="mb-6" data-testid="result-editing-policy-card">
      <CardHeader>
        <SectionHeader className="flex items-center gap-2">
          <CardTitle>{t("title")}</CardTitle>
          <HelpPopover helpKey="resultEditingPolicy" />
        </SectionHeader>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-4">
          <Select
            value={mode}
            onValueChange={(value) => setMode(value as PolicyMode)}
            disabled={isPending}
          >
            <SelectTrigger
              className="w-full sm:w-80"
              data-testid="edit-policy-mode-select"
              aria-label={t("modeAria")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("modeNone")}</SelectItem>
              <SelectItem value="disabled">{t("modeDisabled")}</SelectItem>
              <SelectItem value="max">{t("modeMax")}</SelectItem>
            </SelectContent>
          </Select>
          {mode === "max" && (
            <div className="flex items-center gap-2 text-sm">
              <Label
                htmlFor="edit-policy-minutes"
                className="whitespace-nowrap font-normal"
              >
                {t("minutesBefore")}
              </Label>
              <Input
                id="edit-policy-minutes"
                data-testid="edit-policy-minutes-input"
                type="number"
                min={1}
                value={maxMinutes}
                onChange={(event) => setMaxMinutes(event.target.value)}
                className="w-24"
                aria-label={t("minutesAriaLabel")}
              />
              <span>
                {t("minutesUnit", { minutes: Number(maxMinutes) || 0 })}
              </span>
            </div>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            aria-label={t("save")}
            data-testid="edit-policy-save"
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
