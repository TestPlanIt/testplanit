// Test inventory scaffold for the read-only covering-cases drill-down
// panel. Titles only — converted by 26-09. This panel is read-only by
// design (LinkedRequirementCasesPanel already owns linking on the same
// surface); see 26-PATTERNS.md "Covering-case drill-down".

import { describe, it } from "vitest";

describe("RequirementCoveragePanel", () => {
  it.todo("lists every covering case with its latest result");
  it.todo("shows a not-run treatment for a covering case that has never executed");
  it.todo(
    "marks an inherited case as inherited and offers no unlink affordance on it"
  );
  it.todo("links a cross-project case into its own project, not the requirement's");
  it.todo("renders the empty state for a requirement with no covering cases");
  it.todo("surfaces the cross-project case count when the rollup reports one");
});
