"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Loader2, SquarePen, Save, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

/**
 * Notification preferences for one user: the delivery mode ("how you are
 * reached") and the per-type switches ("what you are told about"). Lives on
 * the Notifications & Alerts page; read-only until Edit, saved together
 * through the users PATCH route like the rest of the profile.
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
  const tActions = useTranslations("common.actions");
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

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<NotificationMode>(
    NotificationMode.USE_GLOBAL
  );
  const [muted, setMuted] = useState<NotificationType[]>([]);

  const savedMode =
    preferences?.notificationMode ?? NotificationMode.USE_GLOBAL;
  const savedMuted = (preferences?.mutedNotificationTypes ??
    []) as NotificationType[];

  useEffect(() => {
    if (!editing) {
      setMode(savedMode);
      setMuted(savedMuted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences, editing]);

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

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userPreferences: {
            notificationMode: mode,
            mutedNotificationTypes: muted,
          },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? "Failed to update preferences");
      }
      toast.success(t("success.title"), {
        description: t("success.description"),
      });
      setEditing(false);
      await refetch();
    } catch (error) {
      console.error("Failed to save notification preferences", error);
      toast.error(t("error.description"));
    } finally {
      setSaving(false);
    }
  };

  const shownMode = editing ? mode : savedMode;
  const shownMuted = editing ? muted : savedMuted;

  return (
    <section data-testid="notification-preferences-card" className="space-y-6">
      <div className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            {t("title")}
            <HelpPopover helpKey="user.notificationMode" />
          </h3>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {editing ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => setEditing(false)}
                  data-testid="notification-preferences-cancel"
                >
                  <X />
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void save()}
                  data-testid="notification-preferences-save"
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  {tActions("save")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                data-testid="notification-preferences-edit"
              >
                <SquarePen />
                {tActions("edit")}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="space-y-6">
        <div className="space-y-3">
          <Label className="text-sm font-medium">{t("mode.label")}</Label>
          {editing ? (
            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as NotificationMode)}
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
                      <span className="ms-1 text-sm font-semibold text-primary/60">
                        {`(${modeLabel(globalDefault)})`}
                      </span>
                    )}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" data-testid="notification-mode-badge">
                {modeLabel(savedMode)}
              </Badge>
              {savedMode === NotificationMode.USE_GLOBAL && globalDefault && (
                <span className="text-xs font-semibold text-primary/60">
                  {`(${modeLabel(globalDefault)})`}
                </span>
              )}
            </div>
          )}
        </div>
        <Separator className="opacity-50" />
        <NotificationTypePreferences
          value={shownMuted}
          onChange={setMuted}
          readOnly={!editing}
          isAdmin={isAdmin}
          effectiveMode={resolveEffectiveNotificationMode(
            { notificationMode: shownMode },
            globalSettings?.value
          )}
        />
      </div>
    </section>
  );
}
