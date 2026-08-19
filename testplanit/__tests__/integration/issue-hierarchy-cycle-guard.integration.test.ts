// Live-DB integration scaffold for the tpl_issue_hierarchy_cycle_guard
// Postgres trigger (HIER-03, DB-level authoritative layer).
//
// The trigger is the authoritative layer because the declarative ZenStack
// policy language has no recursion primitive and therefore cannot express
// "is the new parent a descendant of self" — only a real recursive query
// inside Postgres can walk the ancestor chain. The app-layer assertNoCycle
// guard gives friendly errors first for the one real caller that exists
// today, but the trigger is what actually holds for every write path,
// including ones that bypass the service layer entirely.
//
// Entries 1, 3, and 4 below exist because no production code path writes
// Issue.parentId yet (that lands in Phase 22) — the sync-style upsert and
// bulk-import write shapes have to be simulated with raw transaction writes
// rather than exercised through real callers.
//
// Entry 6 exists because a row-level BEFORE trigger on its own does not
// serialize two concurrent reparents — each transaction sees a
// pre-commit snapshot of the tree, so two concurrent reparents that would
// only form a cycle together can each individually pass the trigger's
// check unless the trigger also takes an advisory lock.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-hierarchy-cycle-guard.integration.test.ts

import { describe, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("Issue hierarchy cycle guard trigger (live DB)", () => {
  it.todo("blocks a raw UPDATE that reparents a node under its own descendant");
  it.todo("blocks a raw UPDATE that makes a node its own parent");
  it.todo("blocks a cycle written inside a multi-row bulk-import transaction");
  it.todo(
    "blocks a cycle written through a sync-style upsert on the dedup key"
  );
  it.todo("allows a legitimate reparent within the same tree");
  it.todo(
    "blocks the second of two concurrent reparents that would together form a cycle"
  );
});
