"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Loading } from "@/components/Loading";
import { DataTable } from "@/components/tables/DataTable";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { NotificationMode } from "~/zenstack/models";
import { Save, Send } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner"; // cspell:ignore sonner
import {
  createSystemNotification,
  getSystemNotificationHistory,
} from "~/app/actions/admin-system-notifications";
import { emptyEditorContent } from "~/app/constants";
import { useRouter } from "~/lib/navigation";
import { extractTextFromNode } from "~/utils/extractTextFromJson";
import { useColumns, NotificationHistoryItem } from "./columns";

// System-notification history is fetched from a server action a page at a time
// and accumulated into one list; the virtualized table renders only the visible
// window and pulls the next page as the admin scrolls near the bottom.
const PAGE_SIZE = 50;

export default function NotificationSettingsPage() {
  return <NotificationSettingsContent />;
}

function NotificationSettingsContent() {
  const locale = useLocale();
  const t = useTranslations("admin.notifications");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [totalCount, setTotalCount] = useState(0);

  const [defaultMode, setDefaultMode] = useState<NotificationMode>("IN_APP");
  const [systemNotificationTitle, setSystemNotificationTitle] = useState("");
  const [systemNotificationMessage, setSystemNotificationMessage] =
    useState<object>(emptyEditorContent);
  const [isSendingSystemNotification, setIsSendingSystemNotification] =
    useState(false);
  const [notificationHistory, setNotificationHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [isEmailServerConfigured, setIsEmailServerConfigured] = useState(true);

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const timeFormat = session?.user?.preferences?.timeFormat;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone, timeFormat } } }),
    [dateFormat, timezone, timeFormat]
  );

  const columns = useColumns(userPreferences, t, tCommon);

  const tableData: NotificationHistoryItem[] = useMemo(
    () =>
      notificationHistory.map((notification) => ({
        id: notification.id,
        name: notification.title,
        title: notification.title,
        message: notification.message,
        createdAt: notification.createdAt,
        data: {
          richContent: notification.data?.richContent,
          htmlContent: notification.data?.htmlContent,
          sentById: notification.data?.sentById,
          sentByName: notification.data?.sentByName,
        },
      })),
    [notificationHistory]
  );

  const { data: settings, isLoading } = useClientQueries(
    schema
  ).appConfig.useFindUnique({
    where: { key: "notificationSettings" },
  });
  const { mutate: createSettings, isPending: isCreating } =
    useClientQueries(schema).appConfig.useCreate();
  const { mutate: updateSettings, isPending: isUpdating } =
    useClientQueries(schema).appConfig.useUpdate();

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

  // Check if email server is configured
  useEffect(() => {
    const checkEmailServerConfig = async () => {
      try {
        const response = await fetch("/api/admin/sso/magic-link-status");
        if (response.ok) {
          const data = await response.json();
          setIsEmailServerConfigured(data.configured);

          // If email server is not configured and default mode is email-based,
          // fall back to IN_APP mode
          if (
            !data.configured &&
            (defaultMode === "IN_APP_EMAIL_IMMEDIATE" ||
              defaultMode === "IN_APP_EMAIL_DAILY")
          ) {
            setDefaultMode("IN_APP");
          }
        }
      } catch (error) {
        console.error("Failed to check email server configuration:", error);
      }
    };

    void checkEmailServerConfig();
  }, [defaultMode]);

  const loadNotificationHistory = useCallback(
    async (page: number, append: boolean) => {
      setIsLoadingHistory(true);
      try {
        const result = await getSystemNotificationHistory({
          page,
          pageSize: PAGE_SIZE,
        });
        if (result.success) {
          setNotificationHistory((prev) =>
            append ? [...prev, ...result.notifications] : result.notifications
          );
          setTotalCount(result.totalCount || 0);
        }
      } catch (error) {
        console.error("Failed to load notification history:", error);
      } finally {
        setIsLoadingHistory(false);
      }
    },
    []
  );

  // Load the first page on mount.
  useEffect(() => {
    void loadNotificationHistory(1, false);
  }, [loadNotificationHistory]);

  // Pull the next page and append as the table nears the bottom.
  const handleLoadMore = useCallback(() => {
    const nextPage = Math.floor(notificationHistory.length / PAGE_SIZE) + 1;
    void loadNotificationHistory(nextPage, true);
  }, [notificationHistory.length, loadNotificationHistory]);

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
        // Reload from the first page after sending (replaces the accumulated list)
        void loadNotificationHistory(1, false);
      } else {
        toast.error(tGlobal("common.errors.error"), {
          description:
            result.error || t("systemNotification.error.description"),
        });
      }
    } catch {
      toast.error(tGlobal("common.errors.error"), {
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
            toast.error(tGlobal("common.errors.error"), {
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
            toast.error(tGlobal("common.errors.error"), {
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
          <SectionHeader className="flex items-center gap-2">
            <CardTitle data-testid="notifications-page-title">
              {t("title")}
            </CardTitle>
            <HelpPopover helpKey="notifications" />
          </SectionHeader>
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
                  <Label htmlFor="none">
                    {tGlobal("components.notifications.empty")}
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="IN_APP" id="in-app" />
                  <Label htmlFor="in-app">{t("defaultMode.inApp")}</Label>
                </div>
                {isEmailServerConfigured && (
                  <>
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
                  </>
                )}
              </RadioGroup>
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={isCreating || isUpdating}>
              <Save className="h-4 w-4" />
              {isCreating || isUpdating
                ? tGlobal("common.actions.saving")
                : t("save")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="w-full">
          <SectionHeader className="flex items-center gap-2">
            <CardTitle data-testid="system-notifications-section">
              {t("systemNotification.title")}
            </CardTitle>
            <HelpPopover helpKey="notificationsSystem" />
          </SectionHeader>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="system-notification-title">
                {t("systemNotification.title")}
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
                {tGlobal("common.actions.automated.message")}
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
                <>{tGlobal("auth.signin.magicLink.sending")}</>
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
            <div className="flex items-center justify-between mb-4">
              <SectionHeader className="flex items-center gap-2">
                <CardTitle data-testid="notification-history-title">
                  {t("systemNotification.history.title")}
                </CardTitle>
                <HelpPopover helpKey="notificationsHistory" />
              </SectionHeader>
              {tableData.length > 0 && (
                <p className="text-sm text-muted-foreground shrink-0">
                  {tGlobal("admin.auditLogs.showing", {
                    loaded: tableData.length.toLocaleString(locale),
                    total: (totalCount || tableData.length).toLocaleString(
                      locale
                    ),
                  })}
                </p>
              )}
            </div>
            <div
              className="h-[500px] min-h-[300px] w-full"
              data-testid="notification-history-table"
            >
              <DataTable
                virtualized
                columns={columns as any}
                data={tableData}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={isLoadingHistory}
                hasMore={notificationHistory.length < totalCount}
                onLoadMore={handleLoadMore}
                emptyMessage={t("systemNotification.history.empty")}
                testIdPrefix="notification-history-vtable"
                rowTestIdPrefix="notification-history-row"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
