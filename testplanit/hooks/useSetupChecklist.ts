"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "~/lib/navigation";
import { schema } from "~/zenstack/schema";

export type SetupChecklistItemKey =
  | "createProject"
  | "inviteTeam"
  | "connectIssueTracker"
  | "connectAiProvider"
  | "setUpSso";

const ITEM_KEYS: SetupChecklistItemKey[] = [
  "createProject",
  "inviteTeam",
  "connectIssueTracker",
  "connectAiProvider",
  "setUpSso",
];

export type SetupChecklistItem = {
  key: SetupChecklistItemKey;
  /** The data the item asks for exists. */
  detected: boolean;
  /** An admin ticked it by hand. */
  marked: boolean;
  done: boolean;
  /** The admin page that completes the item; null when it opens a dialog. */
  href: string | null;
};

export type SetupChecklistCounts = {
  projects: number;
  otherUsers: number;
  issueTrackers: number;
  aiProviders: number;
  ssoProviders: number;
};

/** AppConfig entry holding the items admins ticked by hand, for every admin. */
export const SETUP_CHECKLIST_MARKED_KEY = "setup_checklist_marked_done";

/** Home page query parameter that shows the checklist even when all is done. */
export const SETUP_CHECKLIST_OPEN_PARAM = "setupChecklist";

export function parseMarkedItems(value: unknown): SetupChecklistItemKey[] {
  if (!Array.isArray(value)) return [];
  return ITEM_KEYS.filter((key) => value.includes(key));
}

/** Each item is done when the data it asks for exists or an admin ticked it. */
export function buildSetupChecklistItems(
  counts: SetupChecklistCounts,
  marked: SetupChecklistItemKey[] = []
): SetupChecklistItem[] {
  const item = (
    key: SetupChecklistItemKey,
    detected: boolean,
    href: string | null
  ): SetupChecklistItem => {
    const isMarked = marked.includes(key);
    return {
      key,
      detected,
      marked: isMarked,
      done: detected || isMarked,
      href,
    };
  };
  return [
    item("createProject", counts.projects > 0, null),
    item("inviteTeam", counts.otherUsers > 0, "/admin/users"),
    item(
      "connectIssueTracker",
      counts.issueTrackers > 0,
      "/admin/integrations"
    ),
    item("connectAiProvider", counts.aiProviders > 0, "/admin/llm"),
    item("setUpSso", counts.ssoProviders > 0, "/admin/sso"),
  ];
}

/**
 * The first things an administrator does on a new instance. Shown to admins
 * until every item is done or they hide it; `forceVisible` keeps it on screen
 * when everything is done, so a tick can be taken back.
 */
export function useSetupChecklist(
  enabled: boolean,
  { forceVisible = false }: { forceVisible?: boolean } = {}
) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const client = useClientQueries(schema);
  const options = { enabled };

  const { data: projects } = client.projects.useCount(
    // The seeded Demo Project is sample data, not the admin's own project.
    { where: { isDeleted: false, isDemo: false } },
    options
  );
  const { data: otherUsers } = client.user.useCount(
    // The SCIM provisioner row is inactive, so it never counts as a teammate.
    { where: { isDeleted: false, isActive: true, id: { not: userId } } },
    { enabled: enabled && !!userId }
  );
  const { data: issueTrackers } = client.integration.useCount(
    { where: { isDeleted: false } },
    options
  );
  const { data: aiProviders } = client.llmIntegration.useCount(
    { where: { isDeleted: false } },
    options
  );
  const { data: ssoProviders } = client.ssoProvider.useCount(
    // Magic link is an email sign-in method, not single sign-on.
    { where: { enabled: true, type: { not: "MAGIC_LINK" } } },
    options
  );
  const { data: markedConfig } = client.appConfig.useFindUnique(
    { where: { key: SETUP_CHECKLIST_MARKED_KEY } },
    options
  );
  const { data: preferences } = client.userPreferences.useFindFirst(
    { where: { userId: userId || "" } },
    { enabled: enabled && !!userId }
  );
  const { mutateAsync: updatePreferences } = client.userPreferences.useUpdate();
  const { mutateAsync: upsertConfig } = client.appConfig.useUpsert();

  // Ticks show at once and stay put while quick clicks are still saving.
  const [pendingMarked, setPendingMarked] = useState<
    SetupChecklistItemKey[] | null
  >(null);
  const storedValue = markedConfig?.value;
  const marked = pendingMarked ?? parseMarkedItems(storedValue);
  useEffect(() => {
    if (
      pendingMarked &&
      parseMarkedItems(storedValue).join() === pendingMarked.join()
    ) {
      setPendingMarked(null);
    }
  }, [storedValue, pendingMarked]);

  const loaded =
    projects !== undefined &&
    otherUsers !== undefined &&
    issueTrackers !== undefined &&
    aiProviders !== undefined &&
    ssoProviders !== undefined &&
    markedConfig !== undefined &&
    preferences !== undefined;

  const items = buildSetupChecklistItems(
    {
      projects: projects ?? 0,
      otherUsers: otherUsers ?? 0,
      issueTrackers: issueTrackers ?? 0,
      aiProviders: aiProviders ?? 0,
      ssoProviders: ssoProviders ?? 0,
    },
    marked
  );
  const doneCount = items.filter((item) => item.done).length;

  const preferencesId = preferences?.id;
  const dismiss = useCallback(async () => {
    if (!preferencesId) return;
    await updatePreferences({
      where: { id: preferencesId },
      data: { hasDismissedSetupChecklist: true },
    });
  }, [preferencesId, updatePreferences]);

  const setMarked = useCallback(
    async (key: SetupChecklistItemKey, isMarked: boolean) => {
      const current = pendingMarked ?? parseMarkedItems(storedValue);
      const next = ITEM_KEYS.filter((k) =>
        k === key ? isMarked : current.includes(k)
      );
      setPendingMarked(next);
      try {
        await upsertConfig({
          where: { key: SETUP_CHECKLIST_MARKED_KEY },
          create: { key: SETUP_CHECKLIST_MARKED_KEY, value: next },
          update: { value: next },
        });
      } catch (error) {
        setPendingMarked(null);
        throw error;
      }
    },
    [pendingMarked, storedValue, upsertConfig]
  );

  return {
    visible:
      enabled &&
      loaded &&
      preferences?.hasDismissedSetupChecklist !== true &&
      (forceVisible || doneCount < items.length),
    items,
    doneCount,
    dismiss,
    setMarked,
  };
}

/**
 * For the Help menu: undoes this admin's "Hide checklist" and opens the home
 * page with the checklist on screen.
 */
export function useShowSetupChecklist() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const isAdmin = session?.user?.access === "ADMIN";
  const client = useClientQueries(schema);
  const router = useRouter();
  const { data: preferences } = client.userPreferences.useFindFirst(
    { where: { userId: userId || "" } },
    { enabled: isAdmin && !!userId }
  );
  const { mutateAsync: updatePreferences } = client.userPreferences.useUpdate();

  const preferencesId = preferences?.id;
  const dismissed = preferences?.hasDismissedSetupChecklist === true;
  return useCallback(async () => {
    if (preferencesId && dismissed) {
      await updatePreferences({
        where: { id: preferencesId },
        data: { hasDismissedSetupChecklist: false },
      });
    }
    router.push(`/?${SETUP_CHECKLIST_OPEN_PARAM}=open`);
  }, [preferencesId, dismissed, updatePreferences, router]);
}
