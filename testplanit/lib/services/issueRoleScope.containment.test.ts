// Unit-lane structural gate for HYG-01's read-side containment — the
// read-side mirror of PROV-06's write-side gate
// (lib/services/linkedIssueUpsert.containment.test.ts): same technique (a
// repo-wide structural search over tracked source, a reviewed allowlist
// with a written reason per entry, a throw-with-actionable-message before
// the final empty-array assertion), pointed at reads instead of writes.
// Co-located under lib/services/ so it runs inside `pnpm precommit`, the
// always-on unit lane — the read-side leak this gate defends against has
// no live-DB precondition, so gating it behind the slower CI database lane
// would let a regression sit uncaught for an entire review cycle.
//
// THE PATTERN TRAP: an earlier research pass grepped a flattened symbol
// name for the generated per-model list hook and found it nowhere in this
// codebase — that symbol does not exist here. The real shape is a dynamic
// property access: a shared client-queries object is indexed by the issue
// model's name at runtime, and a specific listing method (find-many,
// find-first, count, or group-by, in either its raw or its generated-hook
// form) is called off that property. A grep built against the flattened
// symbol silently matches zero of the real call sites and reports a false
// "clean" result while every real consumer keeps leaking. The two patterns
// below were confirmed against this codebase's actual consumers before
// being written here, and the pattern self-test further down re-confirms
// that on every run rather than trusting it once.
//
// THE COMMENT-TEXT TRAP (this file's own hazard): `git grep` cannot tell
// code from comment. A structural gate whose own explanatory comment
// reproduces the literal substring it greps for becomes a self-inflicted
// false positive — this happened for real on an earlier phase's write-side
// gate, when a "do NOT do this" comment reproduced the exact matched call
// shape. Every comment in this file describes forbidden shapes in prose;
// the two shapes themselves live only in the String.raw literals passed to
// gitGrep below, and nowhere else in this file.
//
// COVERAGE BOUNDARY: gitGrep below runs with cwd = process.cwd() (vitest's
// cwd for this package is testplanit/) and relative pathspecs, so it can
// never see packages/mcp-server — that surface is out of this gate's reach
// by construction, not by omission, and is covered by its own package
// tests instead. A dedicated assertion below asserts no hit path begins
// with "packages/", so this boundary stays visible in the gate itself
// rather than assumed.
//
// DYNAMIC-DISPATCH BLIND SPOT: a query executed by indexing a db client
// with a runtime-resolved model name (rather than spelling the model name
// in source text) is invisible to every pattern below, by construction —
// no regex over source text can see a property name that only exists at
// runtime. utils/drillDownQueryBuilders.ts's issue query is executed
// exactly this way, from the report-builder drill-down route. The only
// guard possible for a site like that is a content assertion that checks
// for the shared predicate by name rather than by call shape — see the
// per-file threshold table further down, which also covers a second file
// that IS grep-visible but has no behavioral test of its own.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ISSUE_ROLE_SCOPE_COLUMN,
  ISSUE_ROLE_SCOPE_SQL_DEFECT,
  ISSUE_ROLE_SCOPE_SQL_REQUIREMENT,
} from "./issueRoleScope";

interface GrepHit {
  file: string;
  line: string;
}

/**
 * Run `git grep -nE <pattern>` scoped to tracked *.ts/*.tsx files from
 * process.cwd() (vitest runs with cwd = testplanit/, so relative pathspecs
 * stay inside this package). git grep exits 1 when there are no matches —
 * that is a valid empty result, not a real failure, so it is caught here
 * rather than allowed to throw.
 */
function gitGrep(pattern: string): GrepHit[] {
  let raw = "";
  try {
    raw = execSync(`git grep -nE '${pattern}' -- '*.ts' '*.tsx'`, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    const execError = error as { stdout?: string };
    raw = execError.stdout ?? "";
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const match = /^(.+?):(\d+):/.exec(line);
      return match
        ? { file: match[1], line: match[2] }
        : { file: line, line: "?" };
    });
}

const TEST_PATH_MARKERS = ["__tests__/", ".test.ts", ".spec.ts", "e2e/"];

function isTestPath(filePath: string): boolean {
  return TEST_PATH_MARKERS.some((marker) => filePath.includes(marker));
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// The two real call shapes this codebase actually uses for issue LISTING
// reads (find-many, find-first, count, group-by) — never the flattened
// hook-name symbol an earlier research pass grepped and found nothing for.
// Confirmed against components/issues/search-issues-dialog.tsx and
// app/[locale]/issues/page.tsx by direct read before being written here.
const RAW_ISSUE_READ_PATTERN = String.raw`\.issue\.(findMany|findFirst|count|groupBy)\(`;
const HOOK_ISSUE_READ_PATTERN = String.raw`\.issue\.use(FindMany|InfiniteFindMany|FindFirst|Count|GroupBy)\(`;

// The closure's descendant-arm separator — the SQL keyword that splits the
// requirement rollup's closure CTE's anchor half from its recursive-descent
// half. Exactly one occurrence is expected in the service file; a second
// would make every index-based position assertion below ambiguous about
// which half of the text a given index actually falls in.
const DESCENDANT_ARM_SEPARATOR = "UNION ALL";

// The predicates that ARE supposed to repeat in both the anchor and the
// descendant arm (matching the shipped, tested precedent this closure
// generalizes), plus the recursion depth cap. Asserting these are present
// turns "no role predicate here" into the actual invariant this gate
// exists to prove: the predicates that must repeat did repeat, and the one
// that must not, did not.
const PRESERVED_DESCENDANT_ARM_PREDICATES: Array<{
  needle: string;
  label: string;
}> = [
  { needle: '"projectId"', label: "the project-scoping column" },
  { needle: '"isDeleted"', label: "the soft-delete column" },
  { needle: "depth < 100", label: "the recursion depth cap" },
];

// ---------------------------------------------------------------------------
// Reviewed allowlist, bucketed by REASON. The bucket a file sits in is the
// reason it is allowed to read issues without the shared defect-scope
// predicate — a flat list would lose that. Every entry here was opened and
// read during this gate's construction, not added on the strength of an
// earlier plan's inventory alone.
// ---------------------------------------------------------------------------

// SCOPED — carries lib/services/issueRoleScope.ts's DEFECT_SCOPE_WHERE (or
// the opt-in includeRequirements toggle) at its query boundary. Verified by
// this file's own per-file occurrence-count table further down, not just by
// presence in this array.
const SCOPED_FILES = [
  "app/actions/searchIssues.ts",
  "components/issues/search-issues-dialog.tsx",
  "app/[locale]/issues/page.tsx",
  "app/[locale]/projects/issues/[projectId]/page.tsx",
  "app/[locale]/admin/issues/page.tsx",
  "lib/services/milestoneSummary.ts",
  "utils/reportUtils.ts",
  // Grep-invisible: its issue query is dispatched through a db client
  // indexed by a runtime-resolved model name, so it never appears as a hit
  // from either pattern above. Listed here defensively (if a future edit
  // ever added a directly-spelled call, this entry keeps it reviewed) and
  // guarded for real by the content-assertion table further down.
  "utils/drillDownQueryBuilders.ts",
  // Grep-visible but has no behavioral test of its own — the content
  // assertion further down is the only thing that would catch someone
  // quietly deleting the spread from inside an otherwise-intact call.
  "app/api/report-builder/project-health/route.ts",
  // 25-08's load-all requirement tree spreads REQUIREMENT_SCOPE_WHERE (the
  // other half of this module's mirror pair, not DEFECT_SCOPE_WHERE) into
  // its single findMany call — verified by direct read, and by this file's
  // own RequirementsTreeView.test.tsx asserting on the hook's actual `where`
  // argument rather than by source grep alone.
  "app/[locale]/projects/requirements/[projectId]/RequirementsTreeView.tsx",
];

// ROLE-AWARE BY DESIGN — queries the role explicitly, in both directions,
// because the surface's whole purpose is to preview how many rows move
// across the requirement/defect line. Scoping it to defects-only would make
// half of it always report zero.
const ROLE_AWARE_BY_DESIGN_FILES = [
  "app/[locale]/projects/settings/[projectId]/integrations/requirements-config-settings.tsx",
];

// EXEMPT — the caller already named the exact rows it wants by id (or by an
// externally-synced key acting as an id), so the requirement/defect
// distinction does not apply: resolving a row the caller already identified
// is not a listing operation that could leak an unintended row kind.
const EXEMPT_IDENTITY_LOOKUP_FILES = [
  "app/api/issues/[issueId]/link/route.ts",
  "app/api/issues/[issueId]/unlink/route.ts",
  "app/api/issues/counts/route.ts",
  "app/api/issues/projects/route.ts",
  "app/api/llm/magic-select-cases/route.ts",
  "app/api/repository-cases/view-options/route.ts",
  "app/api/sessions/[sessionId]/summary/route.ts",
  "lib/repositoryCaseFacetCounts.ts",
  "lib/services/jira-link-service.ts",
  "lib/webhooks/services/applyInboundIssueUpdate.ts",
  "components/issues/DeferredIssueManager.tsx",
  "components/issues/ManageSimpleUrlIssues.tsx",
  "components/search/FacetedSearchFilters.tsx",
  "app/[locale]/projects/repository/[projectId]/AddResultModal.tsx",
  "app/[locale]/projects/repository/[projectId]/[caseId]/[version]/page.tsx",
  // Fetches project-wide, but the result is used ONLY as a name lookup for
  // ids already present in local component state (the same file's
  // linked-issue-id map over the fetched list) — confirmed by reading both
  // sites, not assumed from an earlier inventory.
  "app/[locale]/projects/sessions/[projectId]/AddSessionModal.tsx",
  // Reads issue records for an LLM prompt through a cast client, scoped to
  // the test run's own linked-issue id set — the caller already named the
  // specific rows.
  "workers/magicSelectWorker.ts",
  // Phase 25's four requirement routes (reparent, delete-subtree, restore,
  // detach) each resolve the addressed row by id via baseDb.issue.findFirst
  // before authorizing/operating on it — an identity lookup, same reasoning
  // as every other entry in this bucket. Unlike most of this bucket, each
  // call site ALSO spreads REQUIREMENT_SCOPE_WHERE (defense-in-depth per
  // T-25-05-03: a route addressed at a non-requirement Issue id must 404,
  // not silently operate on a defect row), so these are strictly more
  // scoped than a bare identity lookup, not less.
  "app/api/projects/[projectId]/requirements/[issueId]/reparent/route.ts",
  "app/api/projects/[projectId]/requirements/[issueId]/delete-subtree/route.ts",
  "app/api/projects/[projectId]/requirements/[issueId]/restore/route.ts",
  "app/api/projects/[projectId]/requirements/[issueId]/detach/route.ts",
];

// EXEMPT — milestone membership legitimately spans both row kinds (an Epic
// can be a milestone member and a requirement at once — a perpendicular
// design axis, not a leak). MilestoneIssueManager.tsx, the picker caller
// that opts a milestone member picker IN to seeing requirement rows, never
// appears in either grep pattern above — it only forwards a prop into
// search-issues-dialog.tsx, it never queries directly — so it has no entry
// here. This note exists so a future reader auditing that opt-in prop does
// not go looking for a missing allowlist line.
const EXEMPT_MILESTONE_MEMBERSHIP_FILES = [
  "app/api/report-builder/drill-down/route.ts",
];

// EXEMPT — resolves rows by an externally-synced key against a tracker's
// own result set, the same identity-lookup reasoning as the bucket above,
// kept separate because the identifier is a tracker key rather than a
// local numeric id.
const EXEMPT_EXTERNAL_KEY_LOOKUP_FILES = [
  "app/api/integrations/jira/search/route.ts",
  "app/api/integrations/jira/test-info/route.ts",
];

// EXEMPT — ingestion and import must see every row kind, or importing (or
// re-syncing) a project would silently drop rows.
const EXEMPT_INGESTION_IMPORT_FILES = [
  "lib/integrations/services/SyncService.ts",
  // Its search method doubles as the SIMPLE_URL import enumerator that
  // SyncService pages through — scoping it would stop importing rows, not
  // just narrow a picker.
  "lib/integrations/adapters/SimpleUrlAdapter.ts",
  "lib/services/testCaseImport.ts",
  "app/api/repository/import/route.ts",
  "workers/testmoImport/issueImports.ts",
];

// EXEMPT — requirement-scoped by design: this module builds the
// requirement hierarchy's own parent/child map, so it necessarily reads
// across both row kinds to walk the tree it is building.
const EXEMPT_REQUIREMENT_SCOPED_FILES = [
  "lib/services/requirementHierarchy.ts",
];

// EXEMPT — the search index must contain every row kind so the in-app role
// filter (a query-time facet against the indexed isRequirement field, not a
// row-kind exclusion at index time) has something to filter against.
// Paired with the "bulk indexer is not scoped" assertion further down,
// which makes the same reasoning structural from the other direction.
const EXEMPT_SEARCH_INDEX_FILES = [
  "services/issueSearch.ts",
  "scripts/reindexAllEntities.ts",
];

const ALL_ALLOWED_FILES = [
  ...SCOPED_FILES,
  ...ROLE_AWARE_BY_DESIGN_FILES,
  ...EXEMPT_IDENTITY_LOOKUP_FILES,
  ...EXEMPT_MILESTONE_MEMBERSHIP_FILES,
  ...EXEMPT_EXTERNAL_KEY_LOOKUP_FILES,
  ...EXEMPT_INGESTION_IMPORT_FILES,
  ...EXEMPT_REQUIREMENT_SCOPED_FILES,
  ...EXEMPT_SEARCH_INDEX_FILES,
];

describe("Issue read-scope containment (HYG-01, structural)", () => {
  it("every issue read call site is either scoped, opt-in, or exempt with a written reason", () => {
    const hits = [
      ...gitGrep(RAW_ISSUE_READ_PATTERN),
      ...gitGrep(HOOK_ISSUE_READ_PATTERN),
    ].filter((hit) => !isTestPath(hit.file));

    // This gate's reach stops at this package: gitGrep runs with a
    // cwd-relative pathspec, so a hit whose path begins with "packages/"
    // would mean that scoping assumption no longer holds.
    const packageHits = hits.filter((hit) => hit.file.startsWith("packages/"));
    expect(packageHits).toEqual([]);

    const offenders = hits.filter(
      (hit) => !ALL_ALLOWED_FILES.includes(hit.file)
    );

    if (offenders.length > 0) {
      const offenderList = offenders
        .map((hit) => `${hit.file}:${hit.line}`)
        .join(", ");
      throw new Error(
        `Found unreviewed Issue read(s) outside the reviewed allowlist: ${offenderList}. ` +
          "Scope the query with DEFECT_SCOPE_WHERE / REQUIREMENT_SCOPE_WHERE " +
          "(lib/services/issueRoleScope.ts), or add the file to the correct " +
          "bucket array in this file with a written reason after review."
      );
    }
    expect(offenders).toEqual([]);
  });

  it("the grep patterns match the real ZenStack hook call shape", () => {
    const rawHits = gitGrep(RAW_ISSUE_READ_PATTERN).filter(
      (hit) => !isTestPath(hit.file)
    );
    const hookHits = gitGrep(HOOK_ISSUE_READ_PATTERN).filter(
      (hit) => !isTestPath(hit.file)
    );
    const rawFiles = new Set(rawHits.map((hit) => hit.file));
    const hookFiles = new Set(hookHits.map((hit) => hit.file));

    const likelyWrongPattern =
      "matched far fewer issue read sites than this codebase actually has. " +
      "That almost certainly means the pattern no longer matches the " +
      "codebase's real call shape (see the flattened-symbol trap this gate " +
      "exists to close), not that the codebase shrank.";

    if (rawHits.length < 40 || !rawFiles.has("utils/reportUtils.ts")) {
      throw new Error(
        `Raw-shape pattern ${likelyWrongPattern} Expected at least 40 ` +
          `non-test hits including utils/reportUtils.ts; got ${rawHits.length} ` +
          `hits across ${rawFiles.size} files.`
      );
    }
    if (
      hookHits.length < 15 ||
      !hookFiles.has("components/issues/search-issues-dialog.tsx")
    ) {
      throw new Error(
        `Hook-shape pattern ${likelyWrongPattern} Expected at least 15 ` +
          "non-test hits including components/issues/search-issues-dialog.tsx; " +
          `got ${hookHits.length} hits across ${hookFiles.size} files.`
      );
    }

    expect(rawHits.length).toBeGreaterThanOrEqual(40);
    expect(hookHits.length).toBeGreaterThanOrEqual(15);
  });

  it("every scoped consumer carries the shared defect-scope predicate", () => {
    // A MINIMUM, not an exact count: an exact count breaks on a legitimate
    // second use, and that failure looks identical to a real regression —
    // which teaches people to edit thresholds reflexively instead of
    // reading what changed. A floor only fails on removal, which is the
    // thing actually worth failing on. Every minimum below is the real
    // occurrence count of the shared predicate token in the file as of
    // this gate's construction (one import line plus one use per query
    // site) — verified by direct count, not copied from an earlier plan's
    // summary without checking.
    const thresholds: Array<{ file: string; minimum: number; reason: string }> =
      [
        {
          file: "components/issues/search-issues-dialog.tsx",
          minimum: 2,
          reason:
            "1 import + 1 conditional spread guarding the opt-in includeRequirements toggle",
        },
        {
          file: "app/actions/searchIssues.ts",
          minimum: 2,
          reason:
            "1 import + 1 spread into the shared findMany/count where object",
        },
        {
          file: "app/[locale]/issues/page.tsx",
          minimum: 4,
          reason:
            "1 import + 2 useGroupBy where objects + 1 push into the issuesWhere builder's conditions array",
        },
        {
          file: "app/[locale]/projects/issues/[projectId]/page.tsx",
          minimum: 4,
          reason:
            "1 import + 2 useGroupBy where objects + 1 push into the issuesWhere builder's conditions array",
        },
        {
          file: "app/[locale]/admin/issues/page.tsx",
          minimum: 2,
          reason:
            "1 import + 1 spread in the flat issuesWhere builder (this page has no useGroupBy calls)",
        },
        {
          file: "lib/services/milestoneSummary.ts",
          minimum: 2,
          reason:
            "1 import + 1 spread in getMilestoneLinkedIssues's where object",
        },
        {
          file: "utils/reportUtils.ts",
          minimum: 12,
          reason:
            "1 import + 1 use in findProjectIssues + 10 uses across the file's cross-project raw call sites — this file's named under-fix trap, so the floor is deliberately high",
        },
        {
          file: "utils/drillDownQueryBuilders.ts",
          minimum: 2,
          reason:
            "1 import + 1 use in buildIssuesQuery's base where — the ONLY guard this file has, since its query executes through a dynamically-indexed model property invisible to both grep patterns above",
        },
        {
          file: "app/api/report-builder/project-health/route.ts",
          minimum: 3,
          reason:
            "1 import + 2 uses (issue-creator distribution, issue-date series) — this route has no test file of its own, so this is the only guard against a silent regression",
        },
      ];

    for (const { file, minimum, reason } of thresholds) {
      const content = readFileSync(file, "utf8");
      const actual = countOccurrences(content, "DEFECT_SCOPE_WHERE");
      if (actual < minimum) {
        throw new Error(
          `${file} contains ${actual} occurrence(s) of DEFECT_SCOPE_WHERE; ` +
            `expected at least ${minimum} (${reason}). ` +
            "A count below the floor means a query site lost its scope predicate — " +
            "restore it, or update this threshold only after confirming by reading the file " +
            "that a site was legitimately removed."
        );
      }
      expect(actual).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("the raw-SQL coverage query mirrors the shared predicate literally", () => {
    // Imports the SQL mirror from the shared module rather than retyping
    // it — importing is the entire mechanism that keeps the TypeScript
    // where-object form and the raw-SQL form from drifting apart across a
    // future column rename.
    const file = "utils/issueTestCoverageUtils.ts";
    const content = readFileSync(file, "utf8");
    const occurrences = countOccurrences(content, ISSUE_ROLE_SCOPE_SQL_DEFECT);

    if (occurrences !== 1) {
      throw new Error(
        `${file} contains ${occurrences} occurrence(s) of the raw-SQL defect-scope ` +
          "mirror exported as ISSUE_ROLE_SCOPE_SQL_DEFECT from lib/services/issueRoleScope.ts; " +
          "expected exactly 1. If the discriminator column was renamed, update BOTH the " +
          "SQL fragment in issueRoleScope.ts and this file's raw query in the same commit."
      );
    }
    expect(occurrences).toBe(1);
  });

  it("both Elasticsearch document call sites write the requirement role", () => {
    const searchFile = "services/issueSearch.ts";
    const searchContent = readFileSync(searchFile, "utf8");
    const roleAssignments = countOccurrences(
      searchContent,
      "isRequirement: issue.isRequirement"
    );

    if (roleAssignments !== 2) {
      throw new Error(
        `${searchFile} writes the requirement role in ${roleAssignments} document ` +
          "literal(s); expected exactly 2 (indexIssue and syncProjectIssuesToElasticsearch — " +
          "the two-writer invariant made structural). A third writer, or only one of the two " +
          "being updated, means the live index and the app's role filter can disagree — " +
          "add the missing assignment, or investigate why a third writer exists."
      );
    }
    expect(roleAssignments).toBe(2);

    // The bulk indexer's own source query must NOT carry the defect-scope
    // predicate: the index has to contain every row kind so the in-app
    // role filter (a query-time facet against the indexed field, not a
    // row-kind exclusion at index time) has something to filter against.
    // Scoping this query would silently drop every requirement row from
    // search results.
    const bulkScopedOccurrences = countOccurrences(
      searchContent,
      "DEFECT_SCOPE_WHERE"
    );
    if (bulkScopedOccurrences !== 0) {
      throw new Error(
        `${searchFile} references DEFECT_SCOPE_WHERE ${bulkScopedOccurrences} time(s); ` +
          "expected 0. Scoping the bulk indexer's source query to defects only would " +
          "remove every requirement row from the search index, breaking the role filter " +
          "this phase enabled — this file indexes every row kind by design."
      );
    }
    expect(bulkScopedOccurrences).toBe(0);

    const mappingFile = "services/unifiedElasticsearchService.ts";
    const mappingContent = readFileSync(mappingFile, "utf8");
    const mappingDeclarations = countOccurrences(
      mappingContent,
      'isRequirement: { type: "boolean" as const }'
    );
    if (mappingDeclarations !== 1) {
      throw new Error(
        `${mappingFile} declares the isRequirement field ${mappingDeclarations} time(s) ` +
          "in ENTITY_MAPPINGS; expected exactly 1 (the ISSUE entity's mapping)."
      );
    }
    expect(mappingDeclarations).toBe(1);
  });

  it("the requirement rollup anchors on the shared requirement predicate exactly once", () => {
    const file = "lib/services/requirementCoverage.ts";
    const content = readFileSync(file, "utf8");

    const mirrorOccurrences = countOccurrences(
      content,
      ISSUE_ROLE_SCOPE_SQL_REQUIREMENT
    );
    if (mirrorOccurrences !== 1) {
      throw new Error(
        `${file} contains ${mirrorOccurrences} occurrence(s) of the raw-SQL requirement-scope ` +
          "mirror exported as ISSUE_ROLE_SCOPE_SQL_REQUIREMENT from lib/services/issueRoleScope.ts; " +
          "expected exactly 1, on the closure's anchor. A second occurrence usually means the " +
          "predicate was copied onto the recursive descendant arm as well, which silently stops " +
          "the rollup at the first non-requirement node in every subtree — while every other " +
          "test in this repository stays green."
      );
    }
    expect(mirrorOccurrences).toBe(1);

    const separatorOccurrences = countOccurrences(
      content,
      DESCENDANT_ARM_SEPARATOR
    );
    if (separatorOccurrences !== 1) {
      throw new Error(
        `${file} contains ${separatorOccurrences} occurrence(s) of the closure's descendant-arm ` +
          "separator; expected exactly 1. A second occurrence would make every position " +
          "assertion in this test ambiguous about which half of the text a given index falls in."
      );
    }
    expect(separatorOccurrences).toBe(1);

    const mirrorIndex = content.indexOf(ISSUE_ROLE_SCOPE_SQL_REQUIREMENT);
    const separatorIndex = content.indexOf(DESCENDANT_ARM_SEPARATOR);
    if (!(mirrorIndex < separatorIndex)) {
      throw new Error(
        `${file}'s requirement-scope mirror occurs at index ${mirrorIndex}, which is not before ` +
          `the descendant-arm separator at index ${separatorIndex}. The mirror belongs on the ` +
          "closure's anchor, which is defined before the separator that introduces the " +
          "recursive descendant arm — its predicate must apply only to the row set the anchor " +
          "selects, never to every row reachable from it."
      );
    }
    expect(mirrorIndex).toBeLessThan(separatorIndex);
  });

  it("the requirement rollup's recursive descendant walk carries no requirement-role predicate", () => {
    const file = "lib/services/requirementCoverage.ts";
    const content = readFileSync(file, "utf8");
    const separatorIndex = content.indexOf(DESCENDANT_ARM_SEPARATOR);
    if (separatorIndex === -1) {
      throw new Error(
        `${file} does not contain the closure's descendant-arm separator at all; the rollup's ` +
          "recursive structure may have changed shape and this gate needs to be re-derived " +
          "against the new text."
      );
    }
    const descendantArm = content.slice(separatorIndex);

    const roleOccurrences = countOccurrences(
      descendantArm,
      ISSUE_ROLE_SCOPE_COLUMN
    );
    if (roleOccurrences !== 0) {
      throw new Error(
        `${file}'s text from the descendant-arm separator onward contains ${roleOccurrences} ` +
          "occurrence(s) of the shared role discriminator column name. Adding a role filter to " +
          "the descendant walk makes a requirement silently stop counting any case linked " +
          "through an intermediate node beneath it, while every other test in this repository " +
          "stays green — remove it from the descendant arm; the predicate belongs on the anchor " +
          "only."
      );
    }
    expect(roleOccurrences).toBe(0);

    for (const { needle, label } of PRESERVED_DESCENDANT_ARM_PREDICATES) {
      const preservedOccurrences = countOccurrences(descendantArm, needle);
      if (preservedOccurrences === 0) {
        throw new Error(
          `${file}'s text from the descendant-arm separator onward is missing ${label}. This ` +
            "test exists to prove the two predicates that are supposed to repeat in both arms " +
            "did repeat, and the one that must not, did not — a missing predicate here would " +
            "let this test trivially pass on a broken descendant arm, not only a correct one."
        );
      }
      expect(preservedOccurrences).toBeGreaterThan(0);
    }
  });
});
