"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  USER_TRASH_WINDOW_DAYS_DEFAULT,
  USER_TRASH_WINDOW_DAYS_KEY,
} from "~/lib/userTrash/itemTypes";
import { schema } from "~/zenstack/schema";

/**
 * System setting for the user-facing Trash: how many days a user may restore
 * their own deletes from their profile. Stored as an AppConfig number; no row
 * means the default, 0 turns self-service restore off. Admin > Trash itself is
 * never bound by it.
 */
export function UserTrashWindowRow() {
  const t = useTranslations("admin.trash.userWindow");
  const tGlobal = useTranslations();
  const { data: config, isLoading } = useClientQueries(
    schema
  ).appConfig.useFindUnique({ where: { key: USER_TRASH_WINDOW_DAYS_KEY } });
  const upsert = useClientQueries(schema).appConfig.useUpsert();

  const persisted =
    typeof config?.value === "number" && config.value >= 0
      ? config.value
      : USER_TRASH_WINDOW_DAYS_DEFAULT;
  const [draft, setDraft] = useState(String(persisted));
  useEffect(() => {
    setDraft(String(persisted));
  }, [persisted]);

  const parsed = Number(draft);
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= 0;
  const dirty = valid && parsed !== persisted;

  const save = async () => {
    if (!valid) {
      toast.error(t("invalid"));
      return;
    }
    try {
      await upsert.mutateAsync({
        where: { key: USER_TRASH_WINDOW_DAYS_KEY },
        create: { key: USER_TRASH_WINDOW_DAYS_KEY, value: parsed },
        update: { value: parsed },
      });
      toast.success(tGlobal("common.messages.updateSuccess"));
    } catch {
      toast.error(tGlobal("common.messages.updateError"));
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2"
      data-testid="user-trash-window-row"
    >
      <Label
        htmlFor="user-trash-window-days"
        className="flex items-center gap-1"
      >
        {t("label")}
        <HelpPopover helpKey="userTrashWindow" />
      </Label>
      <Input
        id="user-trash-window-days"
        type="number"
        min={0}
        step={1}
        inputMode="numeric"
        className="w-24"
        value={draft}
        disabled={isLoading || upsert.isPending}
        onChange={(e) => setDraft(e.target.value)}
        data-testid="user-trash-window-input"
      />
      <span className="text-sm text-muted-foreground">
        {tGlobal("search.filters.days")}
      </span>
      {persisted === 0 && (
        <Badge variant="secondary">{tGlobal("alerts.filters.off")}</Badge>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={save}
        disabled={!dirty || upsert.isPending}
        aria-label={tGlobal("common.actions.save")}
        data-testid="user-trash-window-save"
      >
        <Save className="h-4 w-4" />
        {tGlobal("common.actions.save")}
      </Button>
    </div>
  );
}
