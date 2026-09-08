import type { RepositoryCasesWhereInput } from "~/zenstack/input";

/**
 * Attachments is a relation on RepositoryCases with a soft-delete flag, not a
 * scalar column. A case whose only attachment was soft-deleted must count as
 * "no attachments," so the predicate always guards on `isDeleted: false` — a
 * bare relation-existence check (`some: {}` / `none: {}`) would be wrong.
 *
 * `hasAttachments === true`  → cases with at least one live attachment.
 * `hasAttachments === false` → cases with no live attachments.
 *
 * Single source of truth for the guard, shared by the view-options facet
 * counts and the Repository Cases list `where` builder.
 */
export function attachmentsWhereClause(
  hasAttachments: boolean
): RepositoryCasesWhereInput {
  return hasAttachments
    ? { attachments: { some: { isDeleted: false } } }
    : { attachments: { none: { isDeleted: false } } };
}

/**
 * Shape the attachments facet as `Array<{ value: boolean; count: number }>` to
 * match the automated/parameterized contract the ViewSelector consumes. The
 * "no attachments" bucket is derived by subtraction so the two buckets always
 * sum to `total`.
 */
export function shapeAttachmentsFacet(
  total: number,
  withAttachments: number
): Array<{ value: boolean; count: number }> {
  return [
    { value: true, count: withAttachments },
    { value: false, count: total - withAttachments },
  ];
}
