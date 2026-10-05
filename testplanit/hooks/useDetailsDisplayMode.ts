"use client";

import { useSession } from "next-auth/react";

import { DetailsDisplayMode } from "~/zenstack/models";

/**
 * The signed-in user's preference for how a list opens an item's details:
 * docked in a panel beside the list (the default), or on the item's full page
 * in a new window. Every list with a docked details panel reads it from here.
 */
export function useDetailsDisplayMode(): {
  mode: DetailsDisplayMode;
  opensInNewWindow: boolean;
} {
  const { data: session } = useSession();
  const mode =
    session?.user?.preferences?.detailsDisplayMode ?? DetailsDisplayMode.DOCKED;
  return { mode, opensInNewWindow: mode === DetailsDisplayMode.NEW_WINDOW };
}
