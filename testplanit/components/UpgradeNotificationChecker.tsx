"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { checkUpgradeNotifications } from "~/app/actions/upgrade-notifications";

/**
 * Component that checks for upgrade notifications on first page load after login.
 * Should be placed in the root layout to run on every page.
 */
export function UpgradeNotificationChecker() {
  const { data: session, status } = useSession();
  const hasChecked = useRef(false);

  useEffect(() => {
    // Only check once per session, when authenticated
    if (status === "authenticated" && session?.user?.id && !hasChecked.current) {
      hasChecked.current = true;

      // Check for upgrade notifications in the background
      checkUpgradeNotifications().catch((error) => {
        console.error("Failed to check upgrade notifications:", error);
      });
    }
  }, [status, session?.user?.id]);

  // This component doesn't render anything
  return null;
}
