"use client";

import { Button } from "@/components/ui/button";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const { data: config } = useClientQueries(schema).appConfig.useFindUnique({ where: { key: KEY } });
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
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-w-md">
          <Select
            value={mode}
            onValueChange={(value) => setMode(value as PolicyMode)}
            disabled={isPending}
          >
            <SelectTrigger
              className="max-w-xs"
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
            <div className="space-y-1">
              <Label htmlFor="edit-policy-minutes">{t("minutesLabel")}</Label>
              <Input
                id="edit-policy-minutes"
                data-testid="edit-policy-minutes-input"
                type="number"
                min={1}
                value={maxMinutes}
                onChange={(event) => setMaxMinutes(event.target.value)}
                className="max-w-xs"
              />
            </div>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={isPending}
            data-testid="edit-policy-save"
          >
            {t("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
