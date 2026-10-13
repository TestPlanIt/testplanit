import type { QueryClient } from "@tanstack/react-query";

/**
 * Soft-deletes a traceability snapshot through its route (Reporting
 * delete gate; raw-client write, so the row's post-update unreadability
 * under the model's isDeleted read-deny never surfaces as a failed
 * request) and invalidates every ZenStack query so each snapshot menu
 * drops the row. Throws on a non-2xx so callers toast the failure.
 */
export async function deleteRequirementSnapshot(
  projectId: number,
  snapshotId: number,
  queryClient: QueryClient
): Promise<void> {
  const response = await fetch(
    `/api/projects/${projectId}/requirements/snapshots/${snapshotId}`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    throw new Error(`Snapshot delete failed with status ${response.status}`);
  }
  // Match the list query's key content, not a prefix (the recorded rule).
  void queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === "zenstack",
  });
}
