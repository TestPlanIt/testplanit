"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import {
  useFindUniqueAppConfig,
  useCreateAppConfig,
  useUpdateAppConfig,
} from "~/lib/hooks";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { toast } from "sonner"; // cspell:ignore sonner
import { NotificationMode } from "@prisma/client";
import { Loading } from "@/components/Loading";
import { Input } from "@/components/ui/input";
import { Bell, Megaphone, Send } from "lucide-react";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import TextFromJson from "@/components/TextFromJson";
import { emptyEditorContent } from "~/app/constants";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import {
  createSystemNotification,
  getSystemNotificationHistory,
} from "~/app/actions/admin-system-notifications";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateFormatter } from "@/components/DateFormatter";
import { Separator } from "@/components/ui/separator";

export default function NotificationSettingsPage() {
  const t = useTranslations("admin.notifications");
  const { data: session, status } = useSession();
  const router = useRouter();
  const [defaultMode, setDefaultMode] = useState<NotificationMode>("IN_APP");
  const [systemNotificationTitle, setSystemNotificationTitle] = useState("");
  const [systemNotificationMessage, setSystemNotificationMessage] =
    useState<object>(emptyEditorContent);
  const [isSendingSystemNotification, setIsSendingSystemNotification] =
    useState(false);
  const [notificationHistory, setNotificationHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const { data: settings, isLoading } = useFindUniqueAppConfig({
    where: { key: "notificationSettings" },
  });
  const { mutate: createSettings, isPending: isCreating } =
    useCreateAppConfig();
  const { mutate: updateSettings, isPending: isUpdating } =
    useUpdateAppConfig();

  useEffect(() => {
    // Redirect non-admin users
    if (status === "authenticated" && session?.user?.access !== "ADMIN") {
      router.push("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    if (settings?.value) {
      const value = settings.value as { defaultMode?: NotificationMode };
      if (value.defaultMode) {
        setDefaultMode(value.defaultMode);
      }
    }
  }, [settings]);

  useEffect(() => {
    loadNotificationHistory();
  }, []);

  const loadNotificationHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const result = await getSystemNotificationHistory({ pageSize: 10 });
      if (result.success) {
        setNotificationHistory(result.notifications);
      }
    } catch (error) {
      console.error("Failed to load notification history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleSendSystemNotification = async () => {
    const messageText = extractTextFromNode(systemNotificationMessage);
    if (!systemNotificationTitle.trim() || !messageText.trim()) {
      toast.error(t("systemNotification.error.emptyFields"));
      return;
    }

    setIsSendingSystemNotification(true);
    try {
      const result = await createSystemNotification({
        title: systemNotificationTitle,
        message: JSON.stringify(systemNotificationMessage),
      });

      if (result.success) {
        toast.success(t("systemNotification.success.title"), {
          description: t("systemNotification.success.description", {
            count: result.sentToCount || 0,
          }),
        });
        setSystemNotificationTitle("");
        setSystemNotificationMessage(emptyEditorContent);
        loadNotificationHistory();
      } else {
        toast.error(t("systemNotification.error.title"), {
          description:
            result.error || t("systemNotification.error.description"),
        });
      }
    } catch (error) {
      toast.error(t("systemNotification.error.title"), {
        description: t("systemNotification.error.description"),
      });
    } finally {
      setIsSendingSystemNotification(false);
    }
  };

  const handleSave = () => {
    const configData = {
      key: "notificationSettings",
      value: {
        defaultMode,
      },
    };

    if (settings) {
      updateSettings(
        {
          where: { key: "notificationSettings" },
          data: {
            value: {
              defaultMode,
            },
          },
        },
        {
          onSuccess: () => {
            toast.success(t("success.title"), {
              description: t("success.description"),
            });
          },
          onError: () => {
            toast.error(t("error.title"), {
              description: t("error.description"),
            });
          },
        }
      );
    } else {
      createSettings(
        {
          data: configData,
        },
        {
          onSuccess: () => {
            toast.success(t("success.title"), {
              description: t("success.description"),
            });
          },
          onError: () => {
            toast.error(t("error.title"), {
              description: t("error.description"),
            });
          },
        }
      );
    }
  };

  if (isLoading || status === "loading") {
    return <Loading />;
  }

  // Don't render content for non-admin users
  if (status === "authenticated" && session?.user?.access !== "ADMIN") {
    return null;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle
                data-testid="notifications-page-title"
                className="items-center flex"
              >
                <Bell className="inline mr-2 h-8 w-8" />
                {t("title")}
              </CardTitle>
              <CardDescription data-testid="notifications-page-description">
                {t("description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="default-mode">{t("defaultMode.label")}</Label>
              <RadioGroup
                id="default-mode"
                value={defaultMode}
                onValueChange={(value) =>
                  setDefaultMode(value as NotificationMode)
                }
                className="mt-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="NONE" id="none" />
                  <Label htmlFor="none">{t("defaultMode.none")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="IN_APP" id="in-app" />
                  <Label htmlFor="in-app">{t("defaultMode.inApp")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem
                    value="IN_APP_EMAIL_IMMEDIATE"
                    id="in-app-email-immediate"
                  />
                  <Label htmlFor="in-app-email-immediate">
                    {t("defaultMode.inAppEmailImmediate")}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem
                    value="IN_APP_EMAIL_DAILY"
                    id="in-app-email-daily"
                  />
                  <Label htmlFor="in-app-email-daily">
                    {t("defaultMode.inAppEmailDaily")}
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isCreating || isUpdating}>
              {isCreating || isUpdating ? t("saving") : t("save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle
                data-testid="system-notifications-section"
                className="items-center flex"
              >
                <Megaphone className="inline mr-2 h-8 w-8" />
                {t("systemNotification.title")}
              </CardTitle>
              <CardDescription data-testid="system-notifications-description">
                {t("systemNotification.description")}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="system-notification-title">
                {t("systemNotification.titleLabel")}
              </Label>
              <Input
                id="system-notification-title"
                data-testid="notification-title-input"
                value={systemNotificationTitle}
                onChange={(e) => setSystemNotificationTitle(e.target.value)}
                placeholder={t("systemNotification.titlePlaceholder")}
                maxLength={100}
              />
            </div>
            <div>
              <Label
                htmlFor="system-notification-message"
                data-testid="notification-message-label"
              >
                {t("systemNotification.messageLabel")}
              </Label>
              <div className="border rounded-md">
                <TipTapEditor
                  content={systemNotificationMessage}
                  onUpdate={(newContent) =>
                    setSystemNotificationMessage(newContent)
                  }
                  readOnly={false}
                  className="h-auto"
                  placeholder={t("systemNotification.messagePlaceholder")}
                  projectId="admin"
                  data-testid="notification-message-editor"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSendSystemNotification}
              disabled={isSendingSystemNotification}
              data-testid="send-notification-button"
            >
              {isSendingSystemNotification ? (
                <>{t("systemNotification.sending")}</>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {t("systemNotification.send")}
                </>
              )}
            </Button>
          </div>

          <Separator />

          <div>
            <h3
              className="text-lg font-semibold mb-4"
              data-testid="notification-history-title"
            >
              {t("systemNotification.history.title")}
            </h3>
            {isLoadingHistory ? (
              <Loading />
            ) : notificationHistory.length > 0 ? (
              <Table data-testid="notification-history-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t("systemNotification.history.title")}
                    </TableHead>
                    <TableHead>
                      {t("systemNotification.history.message")}
                    </TableHead>
                    <TableHead>
                      {t("systemNotification.history.sentBy")}
                    </TableHead>
                    <TableHead>
                      {t("systemNotification.history.sentAt")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notificationHistory.map((notification) => (
                    <TableRow key={notification.id}>
                      <TableCell className="font-medium">
                        {notification.title}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        {notification.data?.richContent ? (
                          <div className="max-h-20 overflow-hidden">
                            <TextFromJson
                              jsonString={JSON.stringify(
                                notification.data.richContent
                              )}
                              format="html"
                              room="notification-history"
                              expand={false}
                            />
                          </div>
                        ) : (
                          <span className="truncate">
                            {notification.message}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {notification.data?.sentByName || "Administrator"}
                      </TableCell>
                      <TableCell>
                        <DateFormatter date={notification.createdAt} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-muted-foreground">
                {t("systemNotification.history.empty")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
