"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  getConfigurableNotificationGroups,
  type NotificationCatalogueEntry,
} from "~/lib/notifications/catalogue";
import type { EffectiveNotificationMode } from "~/lib/notifications/delivery";
import { NotificationType } from "~/zenstack/models";

interface NotificationTypePreferencesProps {
  /** The muted set as currently shown (saved value, or the form's draft). */
  value: readonly string[];
  /** Called with the next muted set while editing. */
  onChange?: (next: NotificationType[]) => void;
  /** Off until the profile is in edit mode; the switches then only display. */
  readOnly: boolean;
  isAdmin: boolean;
  /** The resolved mode, so the section can say when nothing is delivered. */
  effectiveMode: EffectiveNotificationMode;
}

/**
 * "What to notify me about": one switch per catalogue entry, on by default.
 * The component is controlled by the profile form: it renders the muted set
 * it is given and reports changes; the form's Save writes them. The muted
 * set stores opt-outs only, so a type added later is on for everyone.
 */
export function NotificationTypePreferences({
  value,
  onChange,
  readOnly,
  isAdmin,
  effectiveMode,
}: NotificationTypePreferencesProps) {
  const t = useTranslations("users.profile.notifications");

  const sections = useMemo(
    () => getConfigurableNotificationGroups({ isAdmin }),
    [isAdmin]
  );
  const muted = useMemo(() => new Set<string>(value), [value]);

  const toggle = (entry: NotificationCatalogueEntry, enabled: boolean) => {
    const next = new Set(muted);
    if (enabled) next.delete(entry.type);
    else next.add(entry.type);
    onChange?.(Array.from(next) as NotificationType[]);
  };

  return (
    <div className="space-y-5" data-testid="notification-type-preferences">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h4 className="text-sm font-medium">{t("typeSection.title")}</h4>
          <p className="text-sm text-muted-foreground">
            {t("typeSection.description")}
          </p>
        </div>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange?.([])}
            disabled={muted.size === 0}
            data-testid="notification-types-reset"
          >
            {t("typeSection.resetToDefaults")}
          </Button>
        )}
      </div>

      {effectiveMode === "NONE" && (
        <p
          className="text-sm text-muted-foreground"
          data-testid="notification-types-mode-none-note"
        >
          {t("typeSection.modeNoneNote")}
        </p>
      )}

      <div className="columns-1 gap-x-8 sm:columns-2 xl:columns-3">
        {sections.map((section) => (
          <div
            key={section.group}
            className="mb-5 break-inside-avoid space-y-2"
          >
            <h5 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t(`groups.${section.group}`)}
            </h5>
            <div className="divide-y divide-border/50">
              {section.entries.map((entry) => {
                const locked = !entry.optional;
                const checked = locked || !muted.has(entry.type);
                const id = `notification-type-${entry.type}`;
                return (
                  <div
                    key={entry.type}
                    className="flex items-center justify-between gap-4 py-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={id} className="font-normal">
                        {t(`types.${entry.type}.label`)}
                      </Label>
                      <HelpPopover
                        helpKey={`## ${t(`types.${entry.type}.label`)}\n\n${t(`types.${entry.type}.description`)}`}
                      />
                      {locked && (
                        <Badge variant="outline" className="font-normal">
                          {t("typeSection.locked")}
                        </Badge>
                      )}
                      {entry.audience === "admin" && (
                        <Badge variant="secondary" className="font-normal">
                          {t("typeSection.adminOnly")}
                        </Badge>
                      )}
                    </div>
                    <Switch
                      id={id}
                      checked={checked}
                      disabled={locked || readOnly}
                      onCheckedChange={(next) => toggle(entry, next)}
                      aria-label={t(`types.${entry.type}.label`)}
                      data-testid={`notification-type-switch-${entry.type}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
