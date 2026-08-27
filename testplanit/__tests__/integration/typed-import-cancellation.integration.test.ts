// Wave 0 scaffold (phase 28-01) for the cooperative-cancellation live-DB
// lane (SCALE-01), converted by 28-05.
//
// Run via (never against the default .env DATABASE_URL -- that resolves to
// `ew`; always pass the scratch tpi_req20 URL explicitly):
//   DATABASE_URL=<scratch tpi_req20 URL> RUN_DB_INTEGRATION=1 \
//     pnpm exec vitest run __tests__/integration/typed-import-cancellation.integration.test.ts

import { describe, it } from "vitest";

const RUN_INTEGRATION = process.env.RUN_DB_INTEGRATION === "1";
const HAS_DB_URL = Boolean(process.env.DATABASE_URL);
const describeIntegration =
  RUN_INTEGRATION && HAS_DB_URL ? describe : describe.skip;

describeIntegration("typed import cooperative cancellation (live DB)", () => {
  it.todo(
    "stops a paged-to-completion import within one page of a cancel request"
  );
  it.todo("leaves the rows already imported in place after a cancellation");
  it.todo("records a terminal cancelled syncStatus, not an error");
});
