import { Session } from "next-auth";

/**
 * Checks if the current user has admin access
 * @param session - The current NextAuth session
 * @returns true if the user has ADMIN access, false otherwise
 */
export function isAdmin(session: Session | null): boolean {
  return session?.user?.access === "ADMIN";
}

/**
 * Checks if the current user has project admin access
 * @param session - The current NextAuth session
 * @returns true if the user has ADMIN or PROJECTADMIN access, false otherwise
 */
export function isProjectAdmin(session: Session | null): boolean {
  return session?.user?.access === "ADMIN" || session?.user?.access === "PROJECTADMIN";
}