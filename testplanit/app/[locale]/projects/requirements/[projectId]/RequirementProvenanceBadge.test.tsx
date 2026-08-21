// Wave 0 scaffold — titles only, converted by 25-07. The component module
// (./RequirementProvenanceBadge.tsx) does not exist yet; do NOT import it
// here. Vite fails a static import at transform time, not per-assertion,
// so importing an unbuilt component would turn the whole suite RED.
import { describe, it } from "vitest";

describe("RequirementProvenanceBadge", () => {
  it.todo("renders no synced badge for a native requirement with no integrationId");
  it.todo("renders the locked badge for a synced, non-detached requirement");
  it.todo(
    "renders the detached badge, keeping the tracker reference, for a detached requirement"
  );
  it.todo("offers the detach action only to a project admin");
  it.todo("posts to the detach route and never uses a native confirm dialog");
});
