import { PrismaAdapter } from "@auth/prisma-adapter";
import type { AccountUncheckedCreateInput } from "~/zenstack/input";
import type { DbClient } from "~/lib/zenstack";
import { hash } from "bcrypt";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import { NotificationService } from "~/lib/services/notificationService";

const ACCOUNT_FIELDS: Record<keyof AccountUncheckedCreateInput, true> = {
  id: true,
  userId: true,
  type: true,
  provider: true,
  providerAccountId: true,
  refresh_token: true,
  access_token: true,
  expires_at: true,
  token_type: true,
  scope: true,
  id_token: true,
  session_state: true,
};

function sanitizeAccountData(
  account: AdapterAccount
): AccountUncheckedCreateInput {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(ACCOUNT_FIELDS)) {
    if (key in account) {
      result[key] = account[key as keyof AdapterAccount];
    }
  }

  if (result.session_state && typeof result.session_state !== "string") {
    result.session_state = null;
  }

  return result as AccountUncheckedCreateInput;
}

/**
 * Custom Prisma adapter that ensures UserPreferences are created
 * when a new user is created via OAuth or Magic Link
 */
export function createCustomPrismaAdapter(prisma: DbClient): Adapter {
  const baseAdapter = PrismaAdapter(prisma);

  return {
    ...baseAdapter,
    async linkAccount(account: AdapterAccount) {
      return prisma.account.create({
        data: sanitizeAccountData(account),
      }) as unknown as AdapterAccount;
    },
    // Override createVerificationToken to add timing protection
    async createVerificationToken(data: {
      identifier: string;
      expires: Date;
      token: string;
    }) {
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
      // Case-insensitive email match to detect a pre-existing row
      // (admin-created, SCIM-provisioned, or a prior auth flow).
      // Closes the SCIM-vs-SSO provisioning race in both directions:
      // when the SCIM service has already inserted a row for this email,
      // NextAuth's SSO sign-in path links that row instead of throwing
      // a unique-constraint violation.
      const incomingExternalId =
        (user as unknown as { externalId?: string | null }).externalId ?? null;

      const existing = await prisma.user.findFirst({
        where: { email: { equals: user.email!, mode: "insensitive" } },
      });

      if (existing) {
        // Conflict branch — the existing row already carries a different
        // external identity. Refuse to silently re-bind; surface as an
        // error so the operator can resolve via the admin conflict log.
        if (
          existing.externalId &&
          incomingExternalId &&
          existing.externalId !== incomingExternalId
        ) {
          throw new Error(
            `Cannot link SSO session: external identity conflict for ${user.email}`
          );
        }

        // Conservative authMethod transition — only flip to SSO when the
        // existing value is unset or SCIM-only. INTERNAL and BOTH rows keep
        // their authMethod so an admin-pre-created credential user is not
        // silently stripped of password access by a colliding SSO sign-in.
        const shouldFlipAuthMethod =
          !existing.authMethod || existing.authMethod === "SCIM";

        const linked = await prisma.user.update({
          where: { id: existing.id },
          data: {
            externalId: incomingExternalId ?? undefined,
            authMethod: shouldFlipAuthMethod ? "SSO" : undefined,
            name: user.name ?? existing.name,
          },
        });

        return {
          id: linked.id,
          email: linked.email,
          name: linked.name,
          image: linked.image,
          emailVerified: linked.emailVerified,
        };
      }

      // Generate a random password for OAuth users (they won't use it)
      const randomPassword = await hash(
        Math.random().toString(36).slice(-8) +
          Math.random().toString(36).slice(-8),
        10
      );

      // Get the system default access level from registration settings
      const registrationSettings =
        await prisma.registrationSettings.findFirst();
      const defaultAccess = registrationSettings?.defaultAccess || "USER";

      // Get the default role from database
      const defaultRole =
        (await prisma.roles.findFirst({
          where: { isDefault: true, isDeleted: false },
        })) ??
        (await prisma.roles.findFirst({
          where: { name: "user", isDeleted: false },
        }));

      if (!defaultRole) {
        throw new Error(
          "No default role found. Please ensure a default role exists."
        );
      }

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
          roleId: defaultRole.id,
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
        console.error(
          "Failed to send OAuth user registration notifications:",
          error
        );
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
