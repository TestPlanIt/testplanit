/**
 * Shared query-key + entity-type helpers for the entity-scoped Comments
 * thread. Kept in this dedicated module — separate from
 * `CommentsSection.tsx` — so importers (Sheet, decide-dialog, etc.) don't
 * transitively pull the `getCommentsForEntity` server action and its
 * Prisma/server-env dependency chain into client-only bundles or tests.
 */

/**
 * Stable queryKey shape for `useQuery({ queryKey: commentsQueryKey(...) })`.
 * Anything that mutates a comment (post, edit, delete, paired-Comment side
 * effect of a review request / decision) MUST invalidate via this helper
 * so the thread refetches immediately rather than waiting for a manual
 * reload.
 */
export const commentsQueryKey = (
  entityType: "repositoryCase" | "testRun" | "session" | "milestone",
  entityId: number
) => ["comments", entityType, entityId] as const;

/**
 * Map the uppercase ReviewableEntityType used by review-feature code
 * (`CASE | RUN | SESSION`) to the camelCase shape `getCommentsForEntity`
 * speaks. Keep in sync with both vocabularies — the Comment model itself
 * has FK columns for all four (incl. milestone), but reviews are scoped
 * to the three reviewable types.
 */
export const reviewableEntityTypeToCommentEntityType = (
  entityType: "CASE" | "RUN" | "SESSION"
): "repositoryCase" | "testRun" | "session" => {
  switch (entityType) {
    case "CASE":
      return "repositoryCase";
    case "RUN":
      return "testRun";
    case "SESSION":
      return "session";
  }
};
