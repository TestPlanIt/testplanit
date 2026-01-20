import { Worker, Job } from "bullmq";
import valkeyConnection from "../lib/valkey";
import { NOTIFICATION_QUEUE_NAME, getEmailQueue } from "../lib/queues";
import { pathToFileURL } from "node:url";
import {
  getPrismaClientForJob,
  isMultiTenantMode,
  MultiTenantJobData,
  disconnectAllTenantClients,
  validateMultiTenantJobData,
} from "../lib/multiTenantPrisma";

// Define job data structures with multi-tenant support
interface CreateNotificationJobData extends MultiTenantJobData {
  userId: string;
  type: string;
  title: string;
  message: string;
  relatedEntityId?: string;
  relatedEntityType?: string;
  data?: any;
}

interface ProcessUserNotificationsJobData extends MultiTenantJobData {
  userId: string;
}

interface SendDailyDigestJobData extends MultiTenantJobData {
  // No additional fields required
}

// Define job names
export const JOB_CREATE_NOTIFICATION = "create-notification";
export const JOB_PROCESS_USER_NOTIFICATIONS = "process-user-notifications";
export const JOB_SEND_DAILY_DIGEST = "send-daily-digest";

const processor = async (job: Job) => {
  console.log(`Processing notification job ${job.id} of type ${job.name}${job.data.tenantId ? ` for tenant ${job.data.tenantId}` : ""}`);

  // Validate multi-tenant job data if in multi-tenant mode
  validateMultiTenantJobData(job.data);

  // Get the appropriate Prisma client (tenant-specific or default)
  const prisma = getPrismaClientForJob(job.data);

  switch (job.name) {
    case JOB_CREATE_NOTIFICATION:
      const createData = job.data as CreateNotificationJobData;

      try {
        // Check user preferences first
        const userPreferences = await prisma.userPreferences.findUnique({
          where: { userId: createData.userId },
        });

        // Get global notification settings from AppConfig
        const globalSettings = await prisma.appConfig.findUnique({
          where: { key: "notificationSettings" },
        });

        // Determine notification mode
        let notificationMode =
          userPreferences?.notificationMode || "USE_GLOBAL";
        if (notificationMode === "USE_GLOBAL") {
          const settingsValue = globalSettings?.value as {
            defaultMode?: string;
          } | null;
          notificationMode = (settingsValue?.defaultMode || "IN_APP") as any;
        }

        // Skip notification creation if user has notifications set to NONE
        if (notificationMode === "NONE") {
          console.log(
            `Skipping notification for user ${createData.userId} - notifications disabled`
          );
          return;
        }

        // Create the in-app notification (for all modes except NONE)
        const notification = await prisma.notification.create({
          data: {
            userId: createData.userId,
            type: createData.type as any,
            title: createData.title,
            message: createData.message,
            relatedEntityId: createData.relatedEntityId,
            relatedEntityType: createData.relatedEntityType,
            data: createData.data,
          },
        });

        // Queue email if needed based on notification mode
        // Note: In multi-tenant mode, the email job should also include tenantId
        if (notificationMode === "IN_APP_EMAIL_IMMEDIATE") {
          await getEmailQueue()?.add("send-notification-email", {
            notificationId: notification.id,
            userId: createData.userId,
            immediate: true,
            tenantId: createData.tenantId, // Pass tenantId for multi-tenant support
          });
        }

        console.log(
          `Created notification ${notification.id} for user ${createData.userId} with mode ${notificationMode}`
        );
      } catch (error) {
        console.error(`Failed to create notification:`, error);
        throw error;
      }
      break;

    case JOB_PROCESS_USER_NOTIFICATIONS:
      const processData = job.data as ProcessUserNotificationsJobData;

      try {
        // Get unread notifications for the user
        const notifications = await prisma.notification.findMany({
          where: {
            userId: processData.userId,
            isRead: false,
            isDeleted: false,
          },
          orderBy: { createdAt: "desc" },
        });

        console.log(
          `Processing ${notifications.length} notifications for user ${processData.userId}`
        );
      } catch (error) {
        console.error(`Failed to process user notifications:`, error);
        throw error;
      }
      break;

    case JOB_SEND_DAILY_DIGEST:
      const digestData = job.data as SendDailyDigestJobData;

      try {
        // Get global settings from AppConfig
        const globalSettings = await prisma.appConfig.findUnique({
          where: { key: "notificationSettings" },
        });
        const settingsValue = globalSettings?.value as {
          defaultMode?: string;
        } | null;
        const globalDefaultMode = settingsValue?.defaultMode || "IN_APP";

        // Get all users with IN_APP_EMAIL_DAILY preference or USE_GLOBAL where global is daily
        const users = await prisma.userPreferences.findMany({
          where: {
            OR: [
              { notificationMode: "IN_APP_EMAIL_DAILY" },
              {
                notificationMode: "USE_GLOBAL",
                ...(globalDefaultMode === "IN_APP_EMAIL_DAILY"
                  ? {}
                  : { id: "none" }), // Only include if global is daily
              },
            ],
          },
          include: {
            user: true,
          },
        });

        for (const userPref of users) {
          // Get unread notifications from the last 24 hours
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);

          const notifications = await prisma.notification.findMany({
            where: {
              userId: userPref.userId,
              isRead: false,
              isDeleted: false,
              createdAt: { gte: yesterday },
            },
            orderBy: { createdAt: "desc" },
          });

          if (notifications.length > 0) {
            await getEmailQueue()?.add("send-digest-email", {
              userId: userPref.userId,
              notifications: notifications.map((n: any) => ({
                id: n.id,
                title: n.title,
                message: n.message,
                createdAt: n.createdAt,
              })),
              tenantId: digestData.tenantId, // Pass tenantId for multi-tenant support
            });
          }
        }

        console.log(`Processed daily digest for ${users.length} users`);
      } catch (error) {
        console.error(`Failed to send daily digest:`, error);
        throw error;
      }
      break;

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }
};

let worker: Worker | null = null;

// Function to start the worker
const startWorker = async () => {
  // Log multi-tenant mode status
  if (isMultiTenantMode()) {
    console.log("Notification worker starting in MULTI-TENANT mode");
  } else {
    console.log("Notification worker starting in SINGLE-TENANT mode");
  }

  if (valkeyConnection) {
    worker = new Worker(NOTIFICATION_QUEUE_NAME, processor, {
      connection: valkeyConnection as any,
      concurrency: 5,
    });

    worker.on("completed", (job) => {
      console.log(`Job ${job.id} completed successfully.`);
    });

    worker.on("failed", (job, err) => {
      console.error(`Job ${job?.id} failed:`, err);
    });

    worker.on("error", (err) => {
      console.error("Worker error:", err);
    });

    console.log(
      `Notification worker started for queue "${NOTIFICATION_QUEUE_NAME}".`
    );
  } else {
    console.warn(
      "Valkey connection not available. Notification worker not started."
    );
  }

  // Allow graceful shutdown
  process.on("SIGINT", async () => {
    console.log("Shutting down notification worker...");
    if (worker) {
      await worker.close();
    }
    // Disconnect all tenant Prisma clients in multi-tenant mode
    if (isMultiTenantMode()) {
      await disconnectAllTenantClients();
    }
    process.exit(0);
  });
};

// Run the worker if this file is executed directly (works with both ESM and CommonJS)
if (
  (typeof import.meta !== "undefined" &&
    import.meta.url === pathToFileURL(process.argv[1]).href) ||
  (typeof import.meta === "undefined" ||
    (import.meta as any).url === undefined)
) {
  console.log("Notification worker running...");
  startWorker().catch((err) => {
    console.error("Failed to start notification worker:", err);
    process.exit(1);
  });
}

export default worker;
export { processor };
