// Live-DB integration scaffold for requirementHierarchy's ancestor-map and
// subtree recursive CTEs (HIER-01). buildIssueAncestorMap/getIssueSubtreeIds
// execute WITH RECURSIVE SQL inside Postgres, so unlike the pure guard
// functions in requirementHierarchy.test.ts (mockable against a fake
// $queryRaw), these can only be proven against a real database — a mocked
// client can't validate real recursive-query correctness on a multi-root,
// depth>5 tree with soft-deleted branches and cross-project isolation.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirement-hierarchy.integration.test.ts

import { describe, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("requirement hierarchy CTEs (live DB)", () => {
  it.todo(
    "buildIssueAncestorMap returns the full root-ward chain for every node in a depth-6 tree"
  );
  it.todo(
    "buildIssueAncestorMap keeps two independent root trees in the same project separate"
  );
  it.todo(
    "getIssueSubtreeIds returns every descendant of a root and excludes the sibling tree"
  );
  it.todo(
    "getIssueSubtreeIds excludes soft-deleted nodes and their descendants"
  );
  it.todo(
    "getIssueSubtreeIds is scoped to a single project and never crosses into another project"
  );
});
