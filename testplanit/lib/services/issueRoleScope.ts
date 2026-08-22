/**
 * The single shared expression of "is this Issue row a requirement" for the
 * whole phase (HYG-01). Requirement-typed rows and defect-typed rows are
 * two kinds on the same `Issue` table, discriminated by one boolean column
 * (schema.zmodel: `isRequirement Boolean @default(false)`, set by the
 * classification write path — never derived per read; see Phase 22's
 * transactional recompute on config save, plus per-sync classification on
 * every synced issue, both of which keep this column authoritative).
 *
 * PURE module: zero imports. It is imported by "use client" pages (the
 * issue list pages, the shared search-issues picker dialog), by server
 * actions and services, and by a report-building module that is itself
 * bundled into client components — so it must never reach for a db client,
 * next-auth, or any server-only module. Doing so would pull server-only
 * code into the client bundle.
 *
 * Consumers apply this predicate at their own query boundary — there is no
 * shared query wrapper that injects it automatically. This module is data
 * shaping and reporting correctness, not an access-control boundary: the
 * `Issue` model's ZenStack read policy is unchanged by this phase, so a
 * caller who can already read issues can still read requirement rows
 * through the generic model route if it queries without this predicate.
 *
 * The object form (`DEFECT_SCOPE_WHERE` / `REQUIREMENT_SCOPE_WHERE`) and
 * the two raw-SQL mirrors (`ISSUE_ROLE_SCOPE_SQL_DEFECT` /
 * `ISSUE_ROLE_SCOPE_SQL_REQUIREMENT`, one per role) are ONE contract that
 * must move together: a call site built as a kysely-style tagged template
 * cannot interpolate a TypeScript where-object, so each raw-SQL query
 * mirrors the relevant object form as a literal SQL fragment instead. If
 * the discriminator column is ever renamed, every form must change in the
 * same commit — an unscoped read of the Issue model that forgets this
 * predicate (whether expressed as an ORM call or a raw join) is exactly
 * the leak this module exists to close, and this repo's structural
 * containment test elsewhere in this phase asserts every such read site
 * is accounted for. The defect mirror is consumed by the issue
 * test-coverage report's query; the requirement mirror is consumed by the
 * coverage rollup service's closure anchor.
 */

export const ISSUE_ROLE_SCOPE_COLUMN = "isRequirement";

export const DEFECT_SCOPE_WHERE: Readonly<{ isRequirement: false }> =
  Object.freeze({ isRequirement: false });

export const REQUIREMENT_SCOPE_WHERE: Readonly<{ isRequirement: true }> =
  Object.freeze({ isRequirement: true });

/**
 * Row form of the same predicate, for call sites that must apply it to rows
 * ALREADY IN HAND rather than at a query boundary — a client surface
 * filtering a list the server already sent it cannot spread a where-object
 * into an array filter. Same contract as the two fragments above and part of
 * the same mirror: the discriminator column is named once, here, so a rename
 * still moves every form in one commit.
 */
export function isRequirementRow(
  row: { isRequirement?: boolean | null } | null | undefined
): boolean {
  return row?.[ISSUE_ROLE_SCOPE_COLUMN] === true;
}

// Raw-SQL mirror (kysely / $queryRaw templates cannot interpolate a
// TypeScript where-object) — written against alias `i`, the alias already
// established for the Issue table in utils/issueTestCoverageUtils.ts, the
// only place this literal is consumed.
export const ISSUE_ROLE_SCOPE_SQL_DEFECT = 'AND i."isRequirement" = false';

// Raw-SQL mirror of REQUIREMENT_SCOPE_WHERE, written against the same
// table alias `i` so both mirrors read identically at their call sites.
export const ISSUE_ROLE_SCOPE_SQL_REQUIREMENT = 'AND i."isRequirement" = true';
