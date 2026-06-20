import { ApplicationArea } from "~/zenstack/models";

/**
 * Shared constants and helpers for mapping the three review-relevant
 * ApplicationArea values to/from the ReviewEntityType discriminant. Single
 * source of truth used by admin role UI predicates AND server-side area
 * derivation in the review-request pipeline.
 */

/**
 * The three ApplicationArea values where canApprove gates reviewer
 * eligibility. Other areas exist on RolePermission rows but canApprove is
 * meaningless on them — the admin role-edit UI hides the column on those
 * rows and the server-side eligibility check never consults them.
 */
export const REVIEW_RELEVANT_AREAS = [
  ApplicationArea.TestCaseRepository,
  ApplicationArea.TestRuns,
  ApplicationArea.Sessions,
] as const;

export type ReviewRelevantArea = (typeof REVIEW_RELEVANT_AREAS)[number];

/**
 * Map a review entity discriminant to its ApplicationArea row.
 * - CASE     → TestCaseRepository
 * - RUN      → TestRuns
 * - SESSION  → Sessions
 *
 * TypeScript's union narrowing covers the three known entity types — the
 * input is locked to the union by the ReviewEntityType enum in schema.zmodel.
 */
export function areaForEntityType(
  entityType: "CASE" | "RUN" | "SESSION"
): ApplicationArea {
  if (entityType === "CASE") return ApplicationArea.TestCaseRepository;
  if (entityType === "RUN") return ApplicationArea.TestRuns;
  return ApplicationArea.Sessions;
}

/**
 * Thin predicate around `REVIEW_RELEVANT_AREAS.includes(area)`. Use this
 * inside admin UI row predicates so the relevant-area set stays defined in
 * one place.
 */
export function isReviewRelevantArea(area: ApplicationArea): boolean {
  return (REVIEW_RELEVANT_AREAS as readonly ApplicationArea[]).includes(area);
}
