import { describe, it } from "vitest";

// CFG-01/CFG-02 component scaffold for the requirements-config settings
// card (near-verbatim fork of milestone-sync-settings.tsx per
// 22-PATTERNS.md). Wave 0 scaffold convention: todo-only entries below,
// no implementation, no import of the not-yet-created component — plan
// 22-04 converts these titles in place.

describe("RequirementsConfigSettings", () => {
  it.todo(
    "renders the issue-type multi-select seeded from the saved requirements config"
  );
  it.todo(
    "shows how many issues become requirements for the newly selected types"
  );
  it.todo(
    "shows how many issues stop being requirements for the deselected types"
  );
  it.todo("calls out affected rows that are detached or locally owned");
  it.todo(
    "saves through the requirements-config route, not the projectIntegration update hook"
  );
  it.todo(
    "disables save until the pending selection differs from the saved config"
  );
});
