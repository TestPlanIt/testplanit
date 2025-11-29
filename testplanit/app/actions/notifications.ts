"use server";

import { prisma } from "~/lib/prisma";
import { getServerAuthSession } from "~/server/auth";
import { revalidatePath } from "next/cache";
import { NotificationService } from "~/lib/services/notificationService";

export async function markNotificationAsRead(notificationId: string) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  try {
    const notification = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true },
    });

    revalidatePath("/");
    return { success: true, notification };
  } catch (error) {
    console.error("Failed to mark notification as read:", error);
    return { success: false, error: "Failed to update notification" };
  }
}

export async function markNotificationAsUnread(notificationId: string) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  try {
    const notification = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: false },
    });

    revalidatePath("/");
    return { success: true, notification };
  } catch (error) {
    console.error("Failed to mark notification as unread:", error);
    return { success: false, error: "Failed to update notification" };
  }
}

export async function deleteNotification(notificationId: string) {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  try {
    const notification = await prisma.notification.update({
      where: { id: notificationId },
      data: { isDeleted: true },
    });

    revalidatePath("/");
    return { success: true, notification };
  } catch (error) {
    console.error("Failed to delete notification:", error);
    return { success: false, error: "Failed to delete notification" };
  }
}

export async function markAllNotificationsAsRead() {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  try {
    const result = await prisma.notification.updateMany({
      where: {
        userId: session.user.id,
        isRead: false,
        isDeleted: false,
      },
      data: { isRead: true },
    });

    revalidatePath("/");
    return { success: true, count: result.count };
  } catch (error) {
    console.error("Failed to mark all notifications as read:", error);
    return { success: false, error: "Failed to update notifications" };
  }
}

export async function getUnreadNotificationCount() {
  const session = await getServerAuthSession();
  if (!session?.user?.id) {
    return 0;
  }

  try {
    const count = await prisma.notification.count({
      where: {
        userId: session.user.id,
        isRead: false,
        isDeleted: false,
      },
    });

    return count;
  } catch (error) {
    console.error("Failed to get notification count:", error);
    return 0;
  }
}

export async function createUserRegistrationNotification(
  newUserName: string,
  newUserEmail: string,
  newUserId: string,
  registrationMethod: "form" | "sso"
) {
  try {
    await NotificationService.createUserRegistrationNotification(
      newUserName,
      newUserEmail,
      newUserId,
      registrationMethod
    );
    return { success: true };
  } catch (error) {
    console.error("Failed to create user registration notification:", error);
    return { success: false, error: "Failed to create notification" };
  }
}
