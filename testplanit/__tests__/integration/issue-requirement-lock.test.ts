// Live-DB integration tests for the Issue requirement-lock @deny rules.
//
// This is the first field-level `@deny` ever placed on `Issue`
// (`isRequirement && integrationId != null && requirementDetachedAt ==
// null` on title/description/status/priority/parent-related fields). A
// mocked-Prisma unit test cannot catch a regression here — field-level
// @deny is compiled into the generated policy and only takes effect
// through the real policy-applying client, not through a mocked db object.
//
// Run via (requires the scratch DB migrated with the requirement-lock
// schema change):
//   cd testplanit && DATABASE_URL=<scratch> RUN_DB_INTEGRATION=1 pnpm exec vitest run __tests__/integration/issue-requirement-lock

import { describe, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("Issue requirement-lock @deny (live DB)", () => {
  it.todo("REJECTS updating title on a synced+locked requirement");
  it.todo("REJECTS updating parentId on a synced+locked requirement");
  it.todo(
    "ALLOWS updating title on a detached requirement (requirementDetachedAt set)"
  );
  it.todo(
    "ALLOWS updating title on an ordinary synced defect (isRequirement=false)"
  );
  it.todo("ALLOWS updating note on a synced+locked requirement");
});
