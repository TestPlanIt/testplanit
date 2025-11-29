"use server";

import { prisma } from "~/lib/prisma";
import { NotificationService } from "~/lib/services/notificationService";
import { getServerAuthSession } from "~/server/auth";
import { z } from "zod/v4";

const createSystemNotificationSchema = z.object({
  title: z.string().min(1).max(100),
  message: z.string().min(1),
});

export async function createSystemNotification(data: {
  title: string;
  message: string;
}) {
  const session = await getServerAuthSession();
  
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return {
      success: false,
      error: "Unauthorized. Only administrators can send system notifications.",
    };
  }

  try {
    const validated = createSystemNotificationSchema.parse(data);

    // Get all active users (not deleted and active)
    const activeUsers = await prisma.user.findMany({
      where: {
        isDeleted: false,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    // Parse the message content for display
    let messageContent;
    let displayMessage;
    try {
      messageContent = JSON.parse(validated.message);
      // Extract plain text for the notification message field
      const extractText = (node: any): string => {
        if (!node) return "";
        if (typeof node === "string") return node;
        if (node.text) return node.text;
        if (node.content && Array.isArray(node.content)) {
          return node.content.map(extractText).join(" ");
        }
        return "";
      };
      displayMessage = extractText(messageContent);
    } catch {
      // If parsing fails, treat as plain text
      messageContent = validated.message;
      displayMessage = validated.message;
    }

    // Create notifications for all users
    // Always create notifications directly in database for now
    // TODO: Re-enable queue system when worker is running in test environment
    const notificationPromises = activeUsers.map((user) =>
      prisma.notification.create({
        data: {
          userId: user.id,
          type: "SYSTEM_ANNOUNCEMENT",
          title: validated.title,
          message: displayMessage.substring(0, 500), // Limit plain text message
          isRead: false,
          data: {
            sentById: session.user.id,
            sentByName: session.user.name || "Administrator",
            sentAt: new Date().toISOString(),
            richContent: messageContent, // Store the full TipTap content
          },
        },
      })
    );

    await Promise.all(notificationPromises);

    return {
      success: true,
      sentToCount: activeUsers.length,
    };
  } catch (error) {
    console.error("Failed to create system notification:", error);
    
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: "Invalid input. Please check your title and message.",
      };
    }
    
    return {
      success: false,
      error: "Failed to send system notification. Please try again.",
    };
  }
}

export async function getSystemNotificationHistory(options?: {
  page?: number;
  pageSize?: number;
}) {
  const session = await getServerAuthSession();
  
  if (!session?.user?.id || session.user.access !== "ADMIN") {
    return {
      success: false,
      error: "Unauthorized",
      notifications: [],
      totalCount: 0,
    };
  }

  try {
    const page = options?.page || 1;
    const pageSize = options?.pageSize || 10;
    const skip = (page - 1) * pageSize;

    // Get unique system notifications (we'll get one per batch send)
    const systemNotifications = await prisma.notification.findMany({
      where: {
        type: "SYSTEM_ANNOUNCEMENT",
      },
      distinct: ["title", "message"],
      orderBy: {
        createdAt: "desc",
      },
      take: pageSize,
      skip,
      select: {
        id: true,
        title: true,
        message: true,
        data: true,
        createdAt: true,
      },
    });

    // Get total count of unique system notifications
    const totalCount = await prisma.notification.groupBy({
      by: ["title", "message"],
      where: {
        type: "SYSTEM_ANNOUNCEMENT",
      },
      _count: true,
    });

    return {
      success: true,
      notifications: systemNotifications,
      totalCount: totalCount.length,
      currentPage: page,
      totalPages: Math.ceil(totalCount.length / pageSize),
    };
  } catch (error) {
    console.error("Failed to get system notification history:", error);
    return {
      success: false,
      error: "Failed to load notification history",
      notifications: [],
      totalCount: 0,
    };
  }
}