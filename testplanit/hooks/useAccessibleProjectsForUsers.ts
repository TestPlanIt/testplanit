"use client";

import { useEffect, useRef, useState } from "react";
import {
  getUsersAccessibleProjects,
  type AccessibleProject,
} from "~/app/actions/getUserAccessibleProjects";

/**
 * Resolves effective accessible projects for a growing list of users — e.g. the
 * accumulating pages of an infinite-scroll table.
 *
 * Only ids not already requested (since the last `resetKey` change) are fetched,
 * and each batch call is bounded by the page size, so the table never issues one
 * giant request even after scrolling through tens of thousands of rows. Pass a
 * `resetKey` derived from the query's filters/sort so the accumulated map is
 * dropped whenever the underlying result set changes.
 */
export function useAccessibleProjectsForUsers(
  userIds: string[],
  resetKey?: string
): Record<string, AccessibleProject[]> {
  const [projectsByUser, setProjectsByUser] = useState<
    Record<string, AccessibleProject[]>
  >({});
  const requestedRef = useRef<Set<string>>(new Set());

  // Depend on the *content* of the id list, not the array identity: React Query
  // hands back a new-but-equal `pages` reference on unrelated state changes, and
  // keying off identity would re-run the fetch effect for an unchanged page —
  // stranding the in-flight first-page batch on a skeleton.
  const idsKey = userIds.join(",");

  // Drop everything fetched so far when the query resets (search/sort/toggle).
  useEffect(() => {
    requestedRef.current = new Set();
    setProjectsByUser({});
  }, [resetKey]);

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    const missing = ids.filter((id) => !requestedRef.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requestedRef.current.add(id);

    // No cancellation guard: a late-resolving batch only merges more correct
    // data into the map, so it is always safe to apply.
    void getUsersAccessibleProjects(missing).then((result) => {
      setProjectsByUser((prev) => ({ ...prev, ...result }));
    });
  }, [idsKey, resetKey]);

  return projectsByUser;
}
