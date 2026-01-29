"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useUpdateUserPreferences, useFindUniqueAppConfig } from "~/lib/hooks";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { NotificationMode } from "@prisma/client";

interface NotificationPreferencesProps {
  userPreferences: any;
  userId: string;
}

export function NotificationPreferences({
  userPreferences,
  userId,
}: NotificationPreferencesProps) {
  const t = useTranslations("users.profile.notifications");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const tNotificationModes = useTranslations("admin.notifications.defaultMode");
  const { data: session } = useSession();
  const { toast } = useToast();
  const [notificationMode, setNotificationMode] =
    useState<NotificationMode>("USE_GLOBAL");
  const [isEmailServerConfigured, setIsEmailServerConfigured] = useState(true);

  const { data: globalSettings } = useFindUniqueAppConfig({
    where: { key: "notificationSettings" },
  });
  const { mutate: updatePreferences, isPending } = useUpdateUserPreferences();

  useEffect(() => {
    if (userPreferences) {
      setNotificationMode(userPreferences.notificationMode || "USE_GLOBAL");
    }
  }, [userPreferences]);

  // Check if email server is configured
  useEffect(() => {
    const checkEmailServerConfig = async () => {
      try {
        const response = await fetch("/api/admin/sso/magic-link-status");
        if (response.ok) {
          const data = await response.json();
          setIsEmailServerConfigured(data.configured);

          // If email server is not configured and user has an email-based notification mode,
          // fall back to IN_APP mode
          if (!data.configured && (notificationMode === "IN_APP_EMAIL_IMMEDIATE" || notificationMode === "IN_APP_EMAIL_DAILY")) {
            setNotificationMode("IN_APP");
          }
        }
      } catch (error) {
        console.error("Failed to check email server configuration:", error);
      }
    };

    checkEmailServerConfig();
  }, [notificationMode]);

  const handleSave = () => {
    if (!userPreferences?.id) return;

    updatePreferences(
      {
        where: { id: userPreferences.id },
        data: {
          notificationMode,
          // These are now determined by the mode selection
          emailNotifications:
            notificationMode === "IN_APP_EMAIL_IMMEDIATE" ||
            notificationMode === "IN_APP_EMAIL_DAILY",
          inAppNotifications:
            notificationMode === "IN_APP" ||
            notificationMode === "IN_APP_EMAIL_IMMEDIATE" ||
            notificationMode === "IN_APP_EMAIL_DAILY",
        },
      },
      {
        onSuccess: () => {
          toast({
            title: t("success.title"),
            description: t("success.description"),
          });
        },
        onError: () => {
          toast({
            title: tCommon("messages.createError"),
            description: t("error.description"),
            variant: "destructive",
          });
        },
      }
    );
  };

  const getGlobalModeLabel = (mode: string | undefined) => {
    switch (mode) {
      case "NONE":
        return tCommon("access.none");
      case "IN_APP":
        return tNotificationModes("inApp");
      case "IN_APP_EMAIL_IMMEDIATE":
        return tNotificationModes("inAppEmailImmediate");
      case "IN_APP_EMAIL_DAILY":
        return tNotificationModes("inAppEmailDaily");
      default:
        return mode ?? "";
    }
  };

  // Only show preferences if user is viewing their own profile
  if (session?.user?.id !== userId) {
    return null;
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label htmlFor="notification-mode">{t("mode.label")}</Label>
          <RadioGroup
            id="notification-mode"
            value={notificationMode}
            onValueChange={(value) =>
              setNotificationMode(value as NotificationMode)
            }
            className="mt-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="USE_GLOBAL" id="use-global" />
              <Label htmlFor="use-global">
                {t("mode.useGlobal")}
                {globalSettings?.value && (
                  <span className="opacity-70">
                    {` (${getGlobalModeLabel(
                      (globalSettings.value as any).defaultMode
                    )})`}
                  </span>
                )}
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="NONE" id="none" />
              <Label htmlFor="none">{tCommon("access.none")}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="IN_APP" id="in-app" />
              <Label htmlFor="in-app">
                {tGlobal("admin.notifications.defaultMode.inApp")}
              </Label>
            </div>
            {isEmailServerConfigured && (
              <>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem
                    value="IN_APP_EMAIL_IMMEDIATE"
                    id="in-app-email-immediate"
                  />
                  <Label htmlFor="in-app-email-immediate">
                    {tGlobal("admin.notifications.defaultMode.inAppEmailImmediate")}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem
                    value="IN_APP_EMAIL_DAILY"
                    id="in-app-email-daily"
                  />
                  <Label htmlFor="in-app-email-daily">
                    {tGlobal("admin.notifications.defaultMode.inAppEmailDaily")}
                  </Label>
                </div>
              </>
            )}
          </RadioGroup>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? tCommon("actions.saving") : tCommon("actions.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
