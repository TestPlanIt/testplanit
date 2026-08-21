// Unit-lane proof for requirementCoverage's pure classification function
// (COV-01's precedence ladder). No database, no mocks — the function this
// suite targets takes a plain count tuple and returns a status, so it
// needs neither a $queryRaw stub nor a live connection. The rollup query
// itself (the recursive CTE that produces those counts) can only be
// proven against a live database — see
// requirement-coverage-rollup.integration.test.ts for that half.
//
// Deliberately no top-level import of "./requirementCoverage" — that
// module does not exist until it is implemented, and a top-level import of
// a missing module fails this file at transform time, taking the whole
// unit lane red for everyone working in parallel. The converting plan adds
// the import when it fills these titles in.
//
// Run via:
//   cd testplanit && pnpm exec vitest run lib/services/requirementCoverage.test.ts

import { describe, it } from "vitest";

describe("requirementCoverage classification (COV-01, pure)", () => {
  it.todo(
    "returns UNCOVERED when a requirement has no covering cases"
  );

  it.todo(
    "returns FAILED when any covering case's latest result failed, even when others passed"
  );

  it.todo(
    "returns PASSED only when every covering case's latest result passed"
  );

  it.todo(
    "returns NOT_RUN when cases are linked but none failed and not all passed"
  );
});
