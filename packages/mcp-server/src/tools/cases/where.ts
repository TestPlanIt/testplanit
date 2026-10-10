import type { RepositoryCasesWhereInput } from "@db/input";
import type { JsonValue } from "@zenstackhq/orm";
import * as z from "zod/v4";
import { dateBoundSchema, DATE_BOUND_HELP, parseDateBound } from "../../dateBounds.js";
import type { EnvConfig } from "../../env.js";
import { resolveCustomFields } from "./customFields.js";

/**
 * Shared RepositoryCases filter surface for cases_list and cases_count.
 *
 * The zod shape and the where-builder live together in one module so the two
 * tools can never drift: cases_count's totals must reconcile with a full
 * cases_list enumeration under the same filters, and that only holds if both
 * build their `where` from the same code path.
 *
 * Deliberately NOT here:
 *  - `staleSinceUpdate` — a handler-side post-filter (per-row arithmetic
 *    across relation timestamps), list-only. A count built on a bounded
 *    post-filter scan could silently disagree with enumeration, so
 *    cases_count refuses the dimension instead of approximating it.
 *  - pagination (`cursor` / `limit`) — list-only.
 *  - descendant expansion for `folderId` — each tool scopes subtrees its own
 *    way (list uses an id in-clause, count post-filters grouped folderIds),
 *    so when `includeDescendants` is set the builder leaves `folderId` out
 *    of the where entirely and the caller applies the subtree scope.
 */

// Enum literals for the source filter. Mirrors RepositoryCaseSource on
// schema.zmodel:1470 — keep synchronized.
export const SOURCE_VALUES = [
  "MANUAL",
  "JUNIT",
  "TESTNG",
  "XUNIT",
  "NUNIT",
  "MSTEST",
  "MOCHA",
  "CUCUMBER",
  "API",
] as const;

export const CASES_FILTER_SHAPE = {
  projectId: z.number().int().positive(),
  folderId: z.number().int().positive().optional(),
  // Widen a folderId filter to the folder's entire subtree. Without
  // folderId this is a no-op (no folder scope = the whole project already).
  includeDescendants: z.boolean().optional(),
  tagIds: z.array(z.number().int().positive()).optional(),
  name: z.string().min(1).optional(),
  stateId: z.number().int().positive().optional(),
  // `{ name }` alone matches cases that have the field set (presence).
  // `{ name, value }` filters by value: resolveCustomFields canonicalizes
  // the value the same way the write path stores it (Dropdown/Multi-Select
  // option name -> option id), so the equality check matches what is
  // actually persisted in caseFieldValues.value. strictObject rejects any
  // other key with a validation error instead of silently dropping it.
  customField: z
    .strictObject({
      name: z.string().min(1),
      value: z
        .union([
          z.string(),
          z.number(),
          z.boolean(),
          z.array(z.union([z.string(), z.number()])),
        ])
        .optional(),
    })
    .optional(),
  // filter cases linked to a specific issue. Pass the internal
  // numeric Issue.id (the `issues_list` / `issues_get` `id`
  // field), NOT the externalKey. `externalKey` (e.g. "JIRA-123") is
  // intentionally NOT a filter dimension here because it is not
  // globally unique on the schema (`@@unique([externalId,
  // integrationId])` is the only constraint — multiple integrations
  // can have the same external key); resolve a key to an id with the
  // issue tools first.
  issueId: z.number().int().positive().optional(),
  // Maintenance filters.
  automated: z.boolean().optional(),
  source: z
    .union([z.enum(SOURCE_VALUES), z.array(z.enum(SOURCE_VALUES))])
    .optional(),
  repositoryId: z.number().int().positive().optional(),
  hasNeverExecuted: z.boolean().optional(),
  // Automation-reality filters: `automated` is a user-set intent flag, these
  // three interrogate execution evidence (JUnit result rows).
  hasAutomatedResults: z.boolean().optional(),
  automatedResultSince: dateBoundSchema.optional(),
  noAutomatedResultSince: dateBoundSchema.optional(),
  updatedAfter: dateBoundSchema.optional(),
  updatedBefore: dateBoundSchema.optional(),
  creatorIds: z.array(z.string().trim().min(1)).optional(),
  from: dateBoundSchema.optional(),
  to: dateBoundSchema.optional(),
};

const casesFilterObject = z.object(CASES_FILTER_SHAPE);
export type CasesFilterInput = z.infer<typeof casesFilterObject>;

export async function buildCasesWhere(
  input: CasesFilterInput,
  env: EnvConfig,
): Promise<RepositoryCasesWhereInput> {
  // Use the typed where so reintroducing an unknown
  // column or forgetting a relation accessor TS2353s at compile time.
  const where: RepositoryCasesWhereInput = {
    projectId: input.projectId,
    isDeleted: false,
  };
  // Subtree scoping is the caller's job (see module docstring) — only the
  // exact-match form goes into the shared where.
  if (input.folderId !== undefined && !input.includeDescendants) {
    where.folderId = input.folderId;
  }
  if (input.tagIds && input.tagIds.length > 0) {
    // RepositoryCases tags are now on the explicit RepositoryCaseTag
    // join model — filter through caseTags.tag.
    where.caseTags = { some: { tag: { id: { in: input.tagIds } } } };
  }
  if (input.name) {
    where.name = { contains: input.name, mode: "insensitive" };
  }
  if (input.stateId !== undefined) where.stateId = input.stateId;
  if (input.customField) {
    if (input.customField.value === undefined) {
      // Presence filter — cases that have this field set (any value).
      where.caseFieldValues = {
        some: { field: { displayName: input.customField.name } },
      };
    } else {
      // Value filter — resolve {name, value} to the canonical
      // {fieldId, value} the write path persists. resolveCustomFields
      // throws 422 for unknown/ambiguous fields and invalid option
      // values, so an unmatched filter surfaces an error rather than
      // returning unfiltered results. It returns exactly one entry per
      // input key or throws, so [resolved] is always defined here.
      // Project-wide filter: no single template to scope to, so resolve
      // against the global catalog (templateId undefined).
      const [resolved] = await resolveCustomFields(
        { [input.customField.name]: input.customField.value },
        undefined,
        env,
      );
      const canonical = resolved!.value as JsonValue;
      where.caseFieldValues = {
        some: {
          fieldId: resolved!.fieldId,
          value: Array.isArray(resolved!.value)
            ? { array_contains: canonical }
            : { equals: canonical },
        },
      };
    }
  }
  if (input.issueId !== undefined) {
    // RepositoryCases issues now live on the explicit
    // RepositoryCaseIssue join model — filter through caseIssues.issue.
    // `issue: { isDeleted: false }` excludes soft-deleted issue links
    // from matching, consistent with the soft-delete invariant.
    where.caseIssues = {
      some: { issue: { id: input.issueId, isDeleted: false } },
    };
  }
  // Maintenance filter appends.
  if (input.automated !== undefined) where.automated = input.automated;
  if (input.source !== undefined) {
    where.source = Array.isArray(input.source)
      ? { in: input.source }
      : input.source;
  }
  if (input.repositoryId !== undefined) {
    where.repositoryId = input.repositoryId;
  }
  if (input.hasNeverExecuted) {
    // Pure-where — no execution exists when
    // junitResults has no rows AND no TestRunCases junction has any
    // associated results.
    where.junitResults = { none: {} };
    where.testRuns = { none: { results: { some: {} } } };
  }
  // Automation-reality filters accumulate as AND terms so they compose with
  // each other and with hasNeverExecuted's direct `junitResults` key instead
  // of silently overwriting it. Contradictory combinations (e.g.
  // hasAutomatedResults:false + automatedResultSince) AND together to an
  // empty result set, which is the honest answer.
  const junitConds: RepositoryCasesWhereInput[] = [];
  if (input.hasAutomatedResults === true) {
    junitConds.push({ junitResults: { some: {} } });
  }
  if (input.hasAutomatedResults === false) {
    junitConds.push({ junitResults: { none: {} } });
  }
  if (input.automatedResultSince !== undefined) {
    junitConds.push({
      junitResults: {
        some: { executedAt: { gte: parseDateBound(input.automatedResultSince, "start") } },
      },
    });
  }
  if (input.noAutomatedResultSince !== undefined) {
    // The rot query: no automated result at-or-after the timestamp —
    // includes cases that never ran at all. Null executedAt rows never
    // match a gte comparison, so results with no timestamp count as "not
    // run since" (the safe default for a maintenance report).
    junitConds.push({
      junitResults: {
        none: { executedAt: { gte: parseDateBound(input.noAutomatedResultSince, "start") } },
      },
    });
  }
  if (junitConds.length > 0) where.AND = junitConds;
  if (
    input.updatedAfter !== undefined ||
    input.updatedBefore !== undefined
  ) {
    // RepositoryCases has no updatedAt column — go through
    // the repositoryCaseVersions relation (the row matching
    // currentVersion carries the canonical lastUpdatedAt).
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (input.updatedAfter !== undefined) {
      createdAt.gte = parseDateBound(input.updatedAfter, "start");
    }
    if (input.updatedBefore !== undefined) {
      createdAt.lte = parseDateBound(input.updatedBefore, "end");
    }
    where.repositoryCaseVersions = { some: { createdAt } };
  }
  if (input.creatorIds && input.creatorIds.length > 0) {
    where.creatorId = { in: input.creatorIds };
  }
  if (input.from || input.to) {
    where.createdAt = {
      ...(input.from ? { gte: parseDateBound(input.from, "start") } : {}),
      ...(input.to ? { lte: parseDateBound(input.to, "end") } : {}),
    };
  }
  return where;
}
