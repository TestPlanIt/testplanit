// Wave 0 scaffold — titles only, converted by 25-13. The component module
// (./LinkedRequirementCasesPanel.tsx) does not exist yet; do NOT import it
// here. Vite fails a static import at transform time, not per-assertion,
// so importing an unbuilt component would turn the whole suite RED.
import { describe, it } from "vitest";

describe("LinkedRequirementCasesPanel", () => {
  it.todo("lists the test cases linked to the requirement");
  it.todo("excludes already-linked cases from the add-link search results");
  it.todo(
    "commits a new link through the existing /api/issues/[issueId]/link route"
  );
  it.todo(
    "removes a link through the existing /api/issues/[issueId]/unlink route"
  );
  it.todo(
    "confirms removal in a popover and never uses a native confirm dialog"
  );
  it.todo(
    "remains usable on a synced, locked requirement — linking is not a locked field"
  );
});
