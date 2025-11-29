import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import type { PrismaClient } from "@prisma/client";
import { hash } from "bcrypt";
import { NotificationService } from "~/lib/services/notificationService";

/**
 * Custom Prisma adapter that ensures UserPreferences are created
 * when a new user is created via OAuth or Magic Link
 */
export function createCustomPrismaAdapter(prisma: PrismaClient): Adapter {
  const baseAdapter = PrismaAdapter(prisma);

  return {
    ...baseAdapter,
    // Override createVerificationToken to add timing protection
    async createVerificationToken(data: { identifier: string; expires: Date; token: string }) {
      // Always create the token (for both existing and non-existing users)
      // This prevents enumeration by making the flow identical
      return baseAdapter.createVerificationToken!(data);
    },
    useVerificationToken: baseAdapter.useVerificationToken,
    // Override getUserByEmail to ensure Magic Link can find existing users
    async getUserByEmail(email: string) {
      if (!email) return null;

      const user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          emailVerified: true,
        },
      });

      return user;
    },
    async createUser(user: Omit<AdapterUser, "id">) {
      // Generate a random password for OAuth users (they won't use it)
      const randomPassword = await hash(
        Math.random().toString(36).slice(-8) +
          Math.random().toString(36).slice(-8),
        10
      );

      // Get the system default access level from registration settings
      const registrationSettings = await prisma.registrationSettings.findFirst();
      const defaultAccess = registrationSettings?.defaultAccess || "USER";

      // Get the default role from database
      const defaultRole = await prisma.roles.findFirst({
        where: { isDefault: true, isDeleted: false },
      });

      // Create user with default preferences
      const newUser = await prisma.user.create({
        data: {
          email: user.email!,
          name: user.name || user.email!.split("@")[0], // Use email prefix if no name
          image: user.image,
          emailVerified: new Date(), // OAuth users have verified emails
          password: randomPassword, // Required field, but won't be used for OAuth
          authMethod: "SSO", // Mark OAuth users as SSO
          access: defaultAccess, // Use system default access from registration settings
          roleId: defaultRole?.id || 1, // Use default role
          userPreferences: {
            create: {
              // Default preferences matching the schema
              theme: "Purple",
              itemsPerPage: "P10",
              locale: "en_US",
              dateFormat: "MM_DD_YYYY_DASH",
              timeFormat: "HH_MM_A",
              timezone: "Etc/UTC",
              notificationMode: "USE_GLOBAL",
              emailNotifications: true,
              inAppNotifications: true,
            },
          },
        },
        include: {
          userPreferences: true,
        },
      });

      // Notify system administrators about the new user registration via OAuth
      try {
        await NotificationService.createUserRegistrationNotification(
          newUser.name,
          newUser.email,
          newUser.id,
          "sso"
        );
      } catch (error) {
        console.error("Failed to send OAuth user registration notifications:", error);
        // Don't fail the OAuth process if notifications fail
      }

      return {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        image: newUser.image,
        emailVerified: newUser.emailVerified,
      };
    },
  };
}
