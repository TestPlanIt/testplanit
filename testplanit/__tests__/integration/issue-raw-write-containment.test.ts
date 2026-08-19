// Live-DB behavioral scaffold for PROV-06 raw-write containment. Entry 3 is
// the end-to-end proof of the actual vulnerability this phase closes:
// linking a test case to a Jira issue key is an ordinary, already-shipped
// user action whose upsert update branch writes `title` with no policy
// check, so a requirement classified from that same Jira key was silently
// overwritable by any tester before this phase.
//
// Run via (never against the default .env DATABASE_URL — that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   cd testplanit && DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/issue-raw-write-containment.test.ts

import { describe, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("Issue raw-write containment (PROV-06, behavioral)", () => {
  it.todo("a locked requirement keeps its title when written through the shell");
  it.todo("a detached requirement accepts a title write through the shell");
  it.todo(
    "a locked requirement keeps its title when linked through JiraLinkService.linkTestCaseToJiraIssue"
  );
});
