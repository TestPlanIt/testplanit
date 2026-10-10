"use client";

import { useSession } from "next-auth/react";
import { useCallback, useSyncExternalStore } from "react";

import { StepLayout } from "~/zenstack/models";

/**
 * The layout the user last chose in this page, keyed by who chose it. The
 * session only learns about a change after the PATCH lands and the session
 * refetches, so every steps component on the page reads this first to flip
 * together the moment the toggle is pressed.
 */
let chosen: { userId: string; layout: StepLayout } | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return chosen;
}

function setChosen(next: typeof chosen) {
  chosen = next;
  listeners.forEach((listener) => listener());
}

/**
 * The signed-in user's step layout: a step stacked over its expected result
 * (the default) or the two side by side. Read by every component that renders
 * steps; `setLayout` saves the choice to the user's preferences.
 *
 * The session is deliberately not refreshed after saving: the page-wide store
 * already carries the choice, and a session refresh re-renders everything that
 * reads the session, which refetches the case under the user's feet. The users
 * route clears the session cache, so the next page load reads the saved value.
 */
export function useStepLayout(): {
  layout: StepLayout;
  isSideBySide: boolean;
  setLayout: (layout: StepLayout) => Promise<void>;
  toggleLayout: () => Promise<void>;
} {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const pending = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const saved = session?.user?.preferences?.stepLayout ?? StepLayout.STACKED;
  const layout = pending && pending.userId === userId ? pending.layout : saved;

  const setLayout = useCallback(
    async (next: StepLayout) => {
      if (!userId) return;
      const previous = chosen;
      setChosen({ userId, layout: next });
      try {
        const response = await fetch(`/api/users/${userId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userPreferences: { stepLayout: next } }),
        });
        if (!response.ok) {
          throw new Error(`Saving step layout failed: ${response.status}`);
        }
      } catch (error) {
        console.error("Failed to save step layout preference:", error);
        setChosen(previous);
      }
    },
    [userId]
  );

  const toggleLayout = useCallback(
    () =>
      setLayout(
        layout === StepLayout.SIDE_BY_SIDE
          ? StepLayout.STACKED
          : StepLayout.SIDE_BY_SIDE
      ),
    [layout, setLayout]
  );

  return {
    layout,
    isSideBySide: layout === StepLayout.SIDE_BY_SIDE,
    setLayout,
    toggleLayout,
  };
}
