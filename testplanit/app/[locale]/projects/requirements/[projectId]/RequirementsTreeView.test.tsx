// Wave 0 scaffold — titles only, converted by 25-07 (nav/shell), 25-08
// (render), 25-09 (drag), 25-11 (create/edit). The component module
// (./RequirementsTreeView.tsx) does not exist yet; do NOT import it here.
// Vite fails a static import at transform time, not per-assertion, so
// importing an unbuilt component would turn the whole suite RED.
import { describe, it } from "vitest";

describe("RequirementsTreeView", () => {
  it.todo("renders every requirement for the project as a node, at arbitrary depth");
  it.todo(
    "queries with the shared REQUIREMENT_SCOPE_WHERE predicate and excludes soft-deleted rows"
  );
  it.todo("renders multiple independent root trees side by side");
  it.todo("expands and collapses a node without issuing a network request");
  it.todo("selecting a node surfaces that requirement in the detail panel");
  it.todo(
    "posts the dragged node and its new parent to the reparent route rather than writing parentId directly"
  );
  it.todo("dropping onto the bottom zone reparents the node to the root level");
  it.todo(
    "surfaces a server-rejected reparent as an error toast and leaves the tree unchanged"
  );
  it.todo("disables drag when the viewer cannot edit the project");
  it.todo("creates a native requirement with isRequirement true and the selected parentId");
  it.todo("renames a requirement in place through the ZenStack update hook");
  it.todo("does not offer rename on a synced, non-detached requirement");
});
