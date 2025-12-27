"use client";

import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFindManyNotification } from "~/lib/hooks";
import {
  markNotificationAsRead,
  markNotificationAsUnread,
  deleteNotification,
  markAllNotificationsAsRead,
} from "~/app/actions/notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DateFormatter } from "@/components/DateFormatter";
import { useToast } from "@/components/ui/use-toast";
import { useSession } from "next-auth/react";
import { cn } from "~/utils";
import { NotificationContent } from "@/components/NotificationContent";
import { useRouter, usePathname } from "~/lib/navigation";
import { useSearchParams } from "next/navigation";

interface NotificationItemProps {
  notification: any;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onDelete: (id: string) => void;
  userPreferences?: any;
}

function NotificationItem({
  notification,
  onMarkRead,
  onMarkUnread,
  onDelete,
  userPreferences,
}: NotificationItemProps) {
  const t = useTranslations("components.notifications");
  const tCommon = useTranslations("common");
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMouseEnter = () => {
    if (!notification.isRead) {
      // Set a 1000ms delay before marking as read
      hoverTimeoutRef.current = setTimeout(() => {
        // Check again if still unread before marking as read
        if (!notification.isRead) {
          onMarkRead(notification.id);
        }
      }, 1000);
    }
  };

  const handleMouseLeave = () => {
    // Clear the timeout if user leaves before the delay
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      className={cn(
        "p-3 border-b last:border-0 hover:bg-muted/50 transition-colors",
        !notification.isRead && "bg-primary/20",
        !notification.isRead &&
          notification.type === "SYSTEM_ANNOUNCEMENT" &&
          "bg-accent"
      )}
      data-notification-item
      data-state={notification.isRead ? "read" : "unread"}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="flex justify-between items-start gap-2">
        <div className="flex-1">
          <NotificationContent notification={notification} />
          <p className="text-xs text-muted-foreground mt-2">
            <DateFormatter
              date={notification.createdAt}
              formatString={userPreferences?.dateFormat}
              timezone={userPreferences?.timezone}
            />
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              data-testid={`notification-menu-${notification.id}`}
              aria-label={tCommon("actions.actionsLabel")}
            >
              <span className="sr-only">{tCommon("actions.actionsLabel")}</span>
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {notification.isRead ? (
              <DropdownMenuItem
                onClick={() => onMarkUnread(notification.id)}
                data-testid={`mark-unread-${notification.id}`}
              >
                {t("actions.markUnread")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                onClick={() => onMarkRead(notification.id)}
                data-testid={`mark-read-${notification.id}`}
              >
                {t("actions.markRead")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(notification.id)}
              className="text-destructive"
              data-testid={`delete-notification-${notification.id}`}
            >
              {tCommon("actions.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function NotificationBell() {
  const t = useTranslations("components.notifications");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  const { data: notifications, refetch } = useFindManyNotification(
    {
      where: {
        userId: session?.user?.id,
        isDeleted: false,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20,
    },
    {
      enabled: !!session?.user?.id,
      refetchInterval: isOpen ? 5000 : 30000, // Poll every 5 seconds when open, 30 seconds when closed
      refetchIntervalInBackground: true, // Continue polling when tab is not visible
    }
  );

  const unreadCount = notifications?.filter((n) => !n.isRead).length || 0;

  // Refetch notifications when window regains focus
  useEffect(() => {
    const handleFocus = () => {
      if (session?.user?.id) {
        refetch();
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [session?.user?.id, refetch]);

  // Check for URL parameter to open notifications
  useEffect(() => {
    if (searchParams.get("openNotifications") === "true") {
      setIsOpen(true);
      // Remove the parameter from URL after opening
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.delete("openNotifications");
      const queryString = newSearchParams.toString();

      // Use the pathname from navigation.ts to preserve locale
      const newPath = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newPath);
    }
  }, [searchParams, router, pathname]);

  const handleMarkRead = async (id: string) => {
    // Find the notification to check if it's already read
    const notification = notifications?.find((n) => n.id === id);
    if (notification?.isRead) {
      // Already read, no need to make API call
      return;
    }

    const result = await markNotificationAsRead(id);
    if (result.success) {
      refetch();
    } else {
      toast({
        title: t("error.markRead"),
        variant: "destructive",
      });
    }
  };

  const handleMarkUnread = async (id: string) => {
    const result = await markNotificationAsUnread(id);
    if (result.success) {
      refetch();
    } else {
      toast({
        title: t("error.markUnread"),
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    const result = await deleteNotification(id);
    if (result.success) {
      refetch();
      toast({
        title: t("success.deleted"),
      });
    } else {
      toast({
        title: t("error.delete"),
        variant: "destructive",
      });
    }
  };

  const handleMarkAllRead = async () => {
    const result = await markAllNotificationsAsRead();
    if (result.success) {
      refetch();
      toast({
        title: t("success.markedAllRead"),
      });
    } else {
      toast({
        title: t("error.markAllRead"),
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={t("aria.notifications", { count: unreadCount })}
          data-testid="notification-bell-button"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
              data-testid="notification-count-badge"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[400px] p-0 drop-shadow-2xl"
      >
        <div className="flex items-center justify-between p-4 border-b-2">
          <h3 className="font-semibold">
            <Bell className="inline mr-1 w-5" />
            {tCommon("fields.notificationMode")}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={unreadCount === 0}
            className={cn(unreadCount === 0 && "text-muted-foreground")}
            data-testid="mark-all-read-button"
          >
            {t("actions.markAllRead")}
          </Button>
        </div>
        <ScrollArea className="h-[400px]">
          {notifications && notifications.length > 0 ? (
            notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={handleMarkRead}
                onMarkUnread={handleMarkUnread}
                onDelete={handleDelete}
                userPreferences={session?.user?.preferences}
              />
            ))
          ) : (
            <div
              className="p-8 text-center text-muted-foreground"
              data-testid="empty-notifications"
            >
              {t("empty")}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
