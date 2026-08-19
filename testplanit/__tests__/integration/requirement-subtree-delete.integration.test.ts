// Live-DB integration scaffold for deleteRequirementSubtree /
// restoreRequirementSubtree (P2/P6 — cascade soft-delete tree policy).
//
// Issue.parentId's ON DELETE CASCADE foreign key is a hard-delete-only
// mechanism and never fires on a soft-delete UPDATE, so it cannot implement
// this policy — the cascade soft-delete is an explicit application-level
// operation, mirroring the shipped RepositoryFolders subtree delete
// (app/api/projects/[projectId]/folders/delete-subtree/route.ts): resolve
// the subtree with a recursive CTE, then soft-delete the whole set in one
// transaction.
//
// Entry 5 is the symmetry proof: restoreRequirementSubtree must restore
// exactly the rows the matching cascade delete touched, and must not
// resurrect a descendant that was already soft-deleted before the cascade
// ran — a naive "restore everything in the subtree" implementation would
// incorrectly un-delete that row too.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirement-subtree-delete.integration.test.ts

import { describe, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("requirement subtree delete and restore (live DB)", () => {
  it.todo(
    "deleteRequirementSubtree soft-deletes the root and every descendant in one transaction"
  );
  it.todo(
    "deleteRequirementSubtree leaves a sibling tree in the same project untouched"
  );
  it.todo(
    "deleteRequirementSubtree stamps deletedAt on every row it soft-deletes"
  );
  it.todo(
    "restoreRequirementSubtree restores exactly the rows the matching cascade deleted"
  );
  it.todo(
    "restoreRequirementSubtree leaves a descendant that was already deleted before the cascade deleted"
  );
});
