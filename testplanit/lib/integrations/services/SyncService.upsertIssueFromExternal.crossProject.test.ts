import { describe, it } from "vitest";

/**
 * Guard scaffold (PROV-05) for SyncService.upsertIssueFromExternal's
 * cross-project protection: a second project's sync of the same external
 * issue must never silently reassign an existing row's projectId. The
 * dedup key (`Issue @@unique([externalId, integrationId])`) carries no
 * projectId, so this guard lives inside the update branch of the upsert
 * itself rather than as a schema constraint.
 *
 * Run: cd testplanit && pnpm exec vitest run lib/integrations/services/SyncService.upsertIssueFromExternal
 */

describe("SyncService.upsertIssueFromExternal cross-project guard (PROV-05)", () => {
  it.todo(
    "throws instead of reassigning projectId when the matched row belongs to another project and has dependents"
  );
  it.todo("does not call db.issue.upsert when the guard fires");
  it.todo(
    "allows the upsert when the matched row belongs to another project but has no dependents"
  );
  it.todo(
    "allows the upsert when the matched row already belongs to the same project"
  );
});
