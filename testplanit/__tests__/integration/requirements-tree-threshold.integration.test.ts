// Wave 0 scaffold (phase 28-01) for the 499/500/501 classified-requirement
// mode-boundary lane (SCALE-01/SCALE-02), converted by 28-08 and extended by
// 28-13. This plan's own Task 2 adds one real test to this file -- the
// roots-query EXPLAIN measurement the composite-index decision (28-RESEARCH
// Open Question 3) rests on.
//
// Run via (never against the default .env DATABASE_URL -- that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/requirements-tree-threshold.integration.test.ts

import { describe, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("requirements tree mode threshold (live DB)", () => {
  it.todo("reports mode 'all' at 499 classified requirements");
  it.todo("reports mode 'all' at exactly 500 classified requirements");
  it.todo("reports mode 'lazy' at 501 classified requirements");
  it.todo("counts only live, requirement-role rows toward the threshold");
});
