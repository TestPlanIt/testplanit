import { describe, expect, it } from "vitest";
import { GUC_MODELS } from "./sideEffectsPlugin";

describe("GUC_MODELS — audit actor-context coverage", () => {
  // Regression: milestone edits made through the model API were mis-attributed
  // to `__system__` because "Milestones" was missing here, so the CDC trigger
  // recorded a null actor. Any user-editable audited root entity written
  // directly through the model API (i.e. not inside an auditedTransaction) must
  // be listed, or its changes lose the acting user.
  it("covers the user-editable root entities that write via the model API", () => {
    for (const model of [
      "RepositoryCases",
      "TestRuns",
      "Sessions",
      "Milestones",
      "Projects",
      "Comment",
      "SharedStepGroup",
      "Issue",
    ]) {
      expect(GUC_MODELS.has(model)).toBe(true);
    }
  });
});
