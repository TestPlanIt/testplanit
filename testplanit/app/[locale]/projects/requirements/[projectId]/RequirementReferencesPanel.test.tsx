// Wave 0 scaffold, owner 27-10. Proves D-13/D-14/D-15 (CONTEXT.md / UI-SPEC):
// a dedicated "References" card in RequirementDetailPanel's existing stack,
// count-first pluralized title, key + title + live status chip per row,
// external references open externalUrl in a new tab, internal references
// navigate in-app, and removal is a popover-confirm hard-delete of the join
// row only (the referenced Issue always survives).
//
// Todo-only in this plan (27-01) — no RequirementReferencesPanel module
// exists yet, so this file does not import it. 27-10 converts each title
// into a real assertion once the component lands.

import { describe, it } from "vitest";

describe("RequirementReferencesPanel", () => {
  it.todo("renders the count-first pluralized card title");
  it.todo("renders the empty state when the requirement has no references");
  it.todo("renders key, title and a live status chip for each reference row");
  it.todo("opens an external reference in a new tab via externalUrl");
  it.todo("navigates in-app for an internal reference");
  it.todo(
    "removes a reference through a popover confirm, never a native dialog"
  );
  it.todo("stays usable on a synced, locked requirement");
});
