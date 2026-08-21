// Wave 0 scaffold — titles only, converted by 25-14. The component module
// (./LinkedRequirementsPanel.tsx) does not exist yet; do NOT import it
// here. Vite fails a static import at transform time, not per-assertion,
// so importing an unbuilt component would turn the whole suite RED.
import { describe, it } from "vitest";

describe("LinkedRequirementsPanel", () => {
  it.todo("lists the requirements linked to the test case");
  it.todo("scopes the add-link search to requirement-typed issues only");
  it.todo(
    "commits a new link through the same /api/issues/[issueId]/link route, with the requirement as the path param"
  );
  it.todo("removes a link through the same /api/issues/[issueId]/unlink route");
  it.todo(
    "shows the same link the requirement surface shows, from the opposite side"
  );
});
