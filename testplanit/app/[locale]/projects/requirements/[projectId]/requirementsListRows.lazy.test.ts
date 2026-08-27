// Wave 0 scaffold (phase 28-01) for the lazy-mode row-derivation unit lane
// (SCALE-02), converted by 28-12 once the roots/expand route carries a
// server-computed hasChildren flag (28-RESEARCH Pitfall 1: today's
// flattenRequirementRows re-derives hasChildren from the in-memory
// childrenMap, which is wrong for any root whose children haven't been
// fetched yet under lazy mode).

import { describe, it } from "vitest";

describe("requirementsListRows lazy-mode derivations", () => {
  it.todo(
    "trusts the server hasChildren flag instead of re-deriving it from childrenMap"
  );
  it.todo("renders a match's ancestors as context rows, not as matches");
  it.todo("keeps the depth<100 cap when assembling a partially loaded tree");
});
