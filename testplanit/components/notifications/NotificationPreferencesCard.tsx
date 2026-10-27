"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { HelpPopover } from "@/components/ui/help-popover";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { NotificationTypePreferences } from "@/components/notifications/NotificationTypePreferences";
import { resolveEffectiveNotificationMode } from "~/lib/notifications/delivery";
import { NotificationMode, NotificationType } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

const MODES: NotificationMode[] = [
  NotificationMode.USE_GLOBAL,
  NotificationMode.NONE,
  NotificationMode.IN_APP,
  NotificationMode.IN_APP_EMAIL_IMMEDIATE,
  NotificationMode.IN_APP_EMAIL_DAILY,
];

const SAVED_TOAST_ID = "notification-preferences-saved";

interface Draft {
  mode: NotificationMode;
  muted: NotificationType[];
}

/**
 * Notification preferences for one user: the delivery mode ("how you are
 * reached") and the per-type switches ("what you are told about"). Lives on
 * the Notifications & Alerts page next to the alert switches and saves the
 * same way they do: every change is written as soon as it is made, through
 * the users PATCH route, and reverts if the write fails.
 */
export function NotificationPreferencesCard({
  userId,
  canEdit,
}: {
  userId: string;
  canEdit: boolean;
}) {
  const t = useTranslations("users.profile.notifications");
  const tModes = useTranslations("admin.notifications.defaultMode");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const isAdmin = session?.user?.access === "ADMIN";
  const client = useClientQueries(schema);

  const { data: preferences, refetch } = client.userPreferences.useFindUnique(
    {
      where: { userId },
      select: { notificationMode: true, mutedNotificationTypes: true },
    },
    { enabled: !!userId }
  );
  const { data: globalSettings } = client.appConfig.useFindUnique({
    where: { key: "notificationSettings" },
  });

  const saved: Draft = {
    mode: preferences?.notificationMode ?? NotificationMode.USE_GLOBAL,
    muted: (preferences?.mutedNotificationTypes ?? []) as NotificationType[],
  };

  // While a write is in flight the card shows what the user chose; once the
  // last write settles it falls back to the server's copy, which is the same
  // value on success and the old value when the write failed.
  const [draft, setDraft] = useState<Draft | null>(null);
  const inFlight = useRef(0);
  const shown = draft ?? saved;

  const persist = async (next: Draft) => {
    setDraft(next);
    inFlight.current += 1;
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userPreferences: {
            notificationMode: next.mode,
            mutedNotificationTypes: next.muted,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to update preferences");
      }
      toast.success(t("success.title"), {
        id: SAVED_TOAST_ID,
        description: t("success.description"),
      });
    } catch (error) {
      console.error("Failed to save notification preferences", error);
      toast.error(t("error.description"));
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) {
        await refetch();
        if (inFlight.current === 0) setDraft(null);
      }
    }
  };

  const modeLabel = (value: string | undefined) => {
    switch (value) {
      case "USE_GLOBAL":
        return t("mode.useGlobal");
      case "NONE":
        return tCommon("access.none");
      case "IN_APP":
        return tModes("inApp");
      case "IN_APP_EMAIL_IMMEDIATE":
        return tModes("inAppEmailImmediate");
      case "IN_APP_EMAIL_DAILY":
        return tModes("inAppEmailDaily");
      default:
        return value ?? "";
    }
  };
  const globalDefault = (
    globalSettings?.value as { defaultMode?: string } | null
  )?.defaultMode;

  return (
    <section data-testid="notification-preferences-card" className="space-y-6">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          {t("title")}
          <HelpPopover helpKey="user.notificationMode" />
        </h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-medium">{t("mode.label")}</Label>
          <RadioGroup
            value={shown.mode}
            disabled={!canEdit}
            onValueChange={(value) =>
              void persist({ ...shown, mode: value as NotificationMode })
            }
            className="grid grid-cols-1 gap-3 md:grid-cols-2"
          >
            {MODES.map((value) => (
              <div key={value} className="flex items-center space-x-3">
                <RadioGroupItem
                  value={value}
                  id={`notification-mode-${value}`}
                  data-testid={`notification-mode-${value}`}
                />
                <Label
                  htmlFor={`notification-mode-${value}`}
                  className="font-normal"
                >
                  {modeLabel(value)}
                  {value === NotificationMode.USE_GLOBAL && globalDefault && (
                    <span className="ms-1 text-sm font-semibold text-primary">
                      {`(${modeLabel(globalDefault)})`}
                    </span>
                  )}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
        <Separator className="opacity-50" />
        <NotificationTypePreferences
          value={shown.muted}
          onChange={(muted) => void persist({ ...shown, muted })}
          readOnly={!canEdit}
          isAdmin={isAdmin}
          effectiveMode={resolveEffectiveNotificationMode(
            { notificationMode: shown.mode },
            globalSettings?.value
          )}
        />
      </div>
    </section>
  );
}
