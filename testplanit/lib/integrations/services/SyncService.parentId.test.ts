import { describe, it } from "vitest";

// PROV-04 unit scaffold — the synced parentId resolution and isRequirement
// classification SyncService.upsertIssueFromExternal/updateExistingIssue
// gain in this phase.
//
// Wave 0 scaffold convention: todo-only entries below, no implementation,
// no import of anything not yet created — a committed RED-failing test
// would break the branch-wide pnpm precommit gate for every plan running
// in parallel.
//
// Two plans convert these titles, in order:
//   - 22-02 converts todos 1-9 (the inline best-effort resolve-on-sync
//     write, plus the isRequirement classification write).
//   - 22-05 converts todos 10-12 (the end-of-import re-resolution pass for
//     a tracker parent that had no local row yet at first sync).
//
// Titles are byte-stable — both converting plans depend on the exact
// wording landed here.

describe("SyncService — synced parentId and requirement classification", () => {
  it.todo(
    "resolves a tracker parent ref to the local parent row id and writes it on upsert"
  );
  it.todo(
    "writes parentId: null explicitly when the tracker reports no parent"
  );
  it.todo(
    "leaves parentId untouched when the tracker parent has no local row yet"
  );
  it.todo(
    "leaves parentId untouched when the resolved parent belongs to a different project"
  );
  it.todo(
    "builds the parent lookup with only the identifier clauses the tracker actually supplied"
  );
  it.todo(
    "updateExistingIssue writes parentId against the existing row's own project"
  );
  it.todo("sets isRequirement from the project's configured requirement issue types");
  it.todo("clears isRequirement when the issue type is not configured");
  it.todo(
    "leaves isRequirement untouched when the db client does not expose projectIntegration"
  );
  it.todo(
    "reports an unresolved tracker parent through upsertIssueFromExternal's result"
  );
  it.todo(
    "re-resolves deferred parents after the import loop and links the child"
  );
  it.todo(
    "leaves a still-unresolvable deferred parent for a later sync pass"
  );
});
