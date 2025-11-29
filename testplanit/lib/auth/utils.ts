import { prisma } from "@/lib/prisma";
import { enhance } from "@zenstackhq/runtime";
import type { Session } from "next-auth";

/**
 * Get a user with role and rolePermissions for ZenStack enhance
 *
 * Note: We intentionally do NOT include projects and groups relations here.
 * ZenStack can query these relations dynamically when evaluating access policies.
 * Preloading them would cause performance issues for users with many assignments.
 */
export async function getUserWithRole(userId: string) {
  return await prisma.user.findUnique({
    where: { id: userId },
    include: {
      role: {
        include: {
          rolePermissions: true,
        },
      },
    },
  });
}

/**
 * Get an enhanced database instance for a session user
 * This ensures the user has the required role and rolePermissions
 */
export async function getEnhancedDb(session: Session | null) {
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const user = await getUserWithRole(session.user.id);
  if (!user) {
    throw new Error("User not found");
  }

  return enhance(prisma, { user });
}
