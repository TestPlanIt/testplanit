import { ApplicationArea } from "~/zenstack/models";

/**
 * The two ApplicationArea values where `canReadSensitive` gates whether a
 * role can see sensitive parameter values. The data layer enforces the
 * permission on rendering (datasets, iteration cells, matrix CSV exports,
 * issue-prefill bodies); other areas exist on RolePermission rows but the
 * column is meaningless on them — the admin role-edit UI hides the column
 * on those rows for clarity.
 */
export const RESTRICTED_FIELDS_AREAS = [
  ApplicationArea.TestCaseRestrictedFields,
  ApplicationArea.TestRunResultRestrictedFields,
] as const;

export type RestrictedFieldsArea = (typeof RESTRICTED_FIELDS_AREAS)[number];

/**
 * Thin predicate around `RESTRICTED_FIELDS_AREAS.includes(area)`. Use this
 * inside admin UI row predicates so the relevant-area set stays defined in
 * one place.
 */
export function isRestrictedFieldsArea(area: ApplicationArea): boolean {
  return (RESTRICTED_FIELDS_AREAS as readonly ApplicationArea[]).includes(area);
}
