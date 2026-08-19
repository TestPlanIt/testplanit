// Unit-lane structural scaffold for PROV-06 raw-write containment,
// co-located with the shell it will guard (lib/services/linkedIssueUpsert.ts)
// so it runs inside `pnpm precommit`, the always-on gate. This is a decision
// record, not a rubber stamp — the reviewed allowlist of files permitted to
// write Issue via a raw/base client, and why each one is on it:
//
//   - lib/integrations/services/SyncService.ts — the blessed sync ingestion
//     path, where the external tracker is deliberately the source of truth
//     for locked fields, and which already carries the cross-project
//     projectId-reassignment guard (PROV-05, Phase 20).
//   - lib/services/linkedIssueUpsert.ts — the one reviewed shell every
//     non-sync write routes through (PROV-06's single containment point).
//   - app/api/issues/[issueId]/link/route.ts and
//     app/api/issues/[issueId]/unlink/route.ts — resolve their client
//     through getEnhancedDb, so the field-level requirement-lock deny
//     predicate already applies to them, and they write relation connects
//     rather than locked columns directly.
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/linkedIssueUpsert.containment.test.ts

import { describe, it } from "vitest";

describe("Issue raw-write containment (PROV-06, structural)", () => {
  it.todo("no file outside the reviewed allowlist calls issue.update or issue.upsert");
  it.todo("jira-link-service routes every issue upsert through the shared shell");
  it.todo(
    "the create-issue routes and the test-case importer route through the shared shell"
  );
});
