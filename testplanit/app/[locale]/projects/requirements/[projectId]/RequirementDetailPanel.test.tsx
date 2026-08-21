// Wave 0 scaffold — titles only, converted by 25-10 (rich text / lock) and
// 25-12 (attachments). The component module (./RequirementDetailPanel.tsx)
// does not exist yet; do NOT import it here. Vite fails a static import at
// transform time, not per-assertion, so importing an unbuilt component
// would turn the whole suite RED.
import { describe, it } from "vitest";

describe("RequirementDetailPanel", () => {
  it.todo("renders the provenance badge for the selected requirement");
  it.todo("renders the Tiptap editor bound to Issue.note");
  it.todo("parses a legacy string note and a structured JSON note identically");
  it.todo("keeps the note editable on a synced, non-detached requirement");
  it.todo("disables the locked fields on a synced, non-detached requirement");
  it.todo("enables the same fields on a detached requirement");
  it.todo("enables the same fields on a native requirement, identically to a detached one");
  it.todo("saves the note through the ZenStack issue update hook, not a bespoke route");
  it.todo(
    "uploads an attachment through the signed-url path and creates an Attachments row with issueId"
  );
  it.todo("lists the requirement's existing attachments and offers a soft-delete removal");
});
