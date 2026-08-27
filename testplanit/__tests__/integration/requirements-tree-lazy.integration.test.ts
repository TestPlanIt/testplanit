// Wave 0 scaffold (phase 28-01) for the roots/expand/count/filter live-DB
// lane (SCALE-02), converted by 28-08 and 28-09.
//
// Run via (never against the default .env DATABASE_URL -- that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-tree-lazy.integration.test.ts

import { describe, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("requirements tree lazy loading (live DB)", () => {
  it.todo(
    "pages the roots window by keyset without skipping or repeating a row"
  );
  it.todo("carries a server-computed hasChildren on every root");
  it.todo("returns one node's live children on expand");
  it.todo(
    "matches computeVisibleRequirementIds for every filter-axis combination"
  );
  it.todo("returns each match's ancestor chain and never a partial chain");
  it.todo("never returns a row from another project");
});
