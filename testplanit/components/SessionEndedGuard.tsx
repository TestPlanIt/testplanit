"use client";

import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { isPublicPath } from "~/lib/auth/publicRoutes";
import { usePathname, useRouter } from "~/lib/navigation";

/**
 * Sends a browser whose session was invalidated server-side to the sign-in
 * page.
 *
 * The proxy only decodes the JWT, so a cookie that is still cryptographically
 * valid gets through it even after the session callback has started returning
 * an empty session (password changed elsewhere, account deactivated). Without
 * this, such a browser sees pages fail to load and fall through to 404 rather
 * than being asked to sign in again. The sign-in page clears the stale cookie
 * on load.
 */
export function SessionEndedGuard() {
  const { status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status !== "unauthenticated") return;
    if (isPublicPath(pathname)) return;
    router.replace("/signin?error=SessionEnded");
  }, [status, pathname, router]);

  return null;
}
