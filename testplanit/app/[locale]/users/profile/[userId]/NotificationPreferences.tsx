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
  const { data: session } = useSession();
  const { toast } = useToast();
  const [notificationMode, setNotificationMode] =
    useState<NotificationMode>("USE_GLOBAL");

  const { data: globalSettings } = useFindUniqueAppConfig({
    where: { key: "notificationSettings" },
  });
  const { mutate: updatePreferences, isPending } = useUpdateUserPreferences();

  useEffect(() => {
    if (userPreferences) {
      setNotificationMode(userPreferences.notificationMode || "USE_GLOBAL");
    }
  }, [userPreferences]);

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
            title: t("error.title"),
            description: t("error.description"),
            variant: "destructive",
          });
        },
      }
    );
  };

  // Only show preferences if user is viewing their own profile
  if (session?.user?.id !== userId) {
    return null;
  }

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>
          {t("description")}
          {globalSettings?.value && notificationMode === "USE_GLOBAL" && (
            <span className="block mt-2 text-sm">
              {t("currentGlobal", {
                mode: t(
                  `modes.${(globalSettings.value as any).defaultMode?.toLowerCase()}` as any
                ),
              })}
            </span>
          )}
        </CardDescription>
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
              <Label htmlFor="use-global">{t("mode.useGlobal")}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="NONE" id="none" />
              <Label htmlFor="none">{t("mode.none")}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="IN_APP" id="in-app" />
              <Label htmlFor="in-app">{t("mode.inApp")}</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="IN_APP_EMAIL_IMMEDIATE"
                id="in-app-email-immediate"
              />
              <Label htmlFor="in-app-email-immediate">
                {t("mode.inAppEmailImmediate")}
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem
                value="IN_APP_EMAIL_DAILY"
                id="in-app-email-daily"
              />
              <Label htmlFor="in-app-email-daily">
                {t("mode.inAppEmailDaily")}
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="flex justify-end pt-4">
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? t("saving") : t("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
