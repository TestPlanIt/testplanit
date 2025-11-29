"use server";

import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import { getUpgradeNotificationsBetweenVersions } from "~/lib/upgrade-notifications";
import packageJson from "~/package.json";

/**
 * Check for upgrade notifications and create a batched notification if needed.
 * Updates the user's lastSeenVersion after processing.
 */
export async function checkUpgradeNotifications(): Promise<{
  success: boolean;
  notificationCreated: boolean;
  error?: string;
}> {
  const session = await getServerAuthSession();

  if (!session?.user?.id) {
    return {
      success: false,
      notificationCreated: false,
      error: "Not authenticated",
    };
  }

  try {
    const currentVersion = packageJson.version;

    // Get user's last seen version
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { lastSeenVersion: true },
    });

    if (!user) {
      return {
        success: false,
        notificationCreated: false,
        error: "User not found",
      };
    }

    const lastSeenVersion = user.lastSeenVersion;

    // If user has never seen any version, just update to current (no notifications for first-time setup)
    if (!lastSeenVersion) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: { lastSeenVersion: currentVersion },
      });

      return {
        success: true,
        notificationCreated: false,
      };
    }

    // If already on current version, no need to check
    if (lastSeenVersion === currentVersion) {
      return {
        success: true,
        notificationCreated: false,
      };
    }

    // Get notifications for versions between lastSeen and current
    const pendingNotifications = getUpgradeNotificationsBetweenVersions(
      lastSeenVersion,
      currentVersion
    );

    // Update user's last seen version first (to prevent duplicate notifications on refresh)
    await prisma.user.update({
      where: { id: session.user.id },
      data: { lastSeenVersion: currentVersion },
    });

    // If no notifications to send, we're done
    if (pendingNotifications.length === 0) {
      return {
        success: true,
        notificationCreated: false,
      };
    }

    // Create a batched notification combining all pending notifications
    const title =
      pendingNotifications.length === 1
        ? pendingNotifications[0].notification.title
        : `What's New in TestPlanIt`;

    let message: string;
    if (pendingNotifications.length === 1) {
      message = pendingNotifications[0].notification.message;
    } else {
      // Combine multiple notifications into a single message
      message = pendingNotifications
        .map(
          ({ version, notification }) =>
            `**${notification.title}** (v${version})\n${notification.message}`
        )
        .join("\n\n");
    }

    // Build HTML content for the notification
    let htmlContent: string;
    if (pendingNotifications.length === 1) {
      htmlContent = pendingNotifications[0].notification.message;
    } else {
      // Combine multiple notifications into HTML
      htmlContent = pendingNotifications
        .map(({ version, notification }) => {
          return `<div><strong>${notification.title}</strong> (v${version})<br/>${notification.message}</div>`;
        })
        .join("<hr/>");
    }

    // Create the notification
    await prisma.notification.create({
      data: {
        userId: session.user.id,
        type: "SYSTEM_ANNOUNCEMENT",
        title,
        message: message.substring(0, 500),
        isRead: false,
        data: {
          type: "upgrade_notification",
          fromVersion: lastSeenVersion,
          toVersion: currentVersion,
          notificationCount: pendingNotifications.length,
          versions: pendingNotifications.map((n) => n.version),
          htmlContent,
        },
      },
    });

    return {
      success: true,
      notificationCreated: true,
    };
  } catch (error) {
    console.error("Failed to check upgrade notifications:", error);
    return {
      success: false,
      notificationCreated: false,
      error: "Failed to check upgrade notifications",
    };
  }
}
