// Wave 0 scaffold — titles only, converted by 25-11. The component module
// (./DeleteRequirementModal.tsx) does not exist yet; do NOT import it here.
// Vite fails a static import at transform time, not per-assertion, so
// importing an unbuilt component would turn the whole suite RED.
import { describe, it } from "vitest";

describe("DeleteRequirementModal", () => {
  it.todo("names how many descendants will be soft-deleted alongside the requirement");
  it.todo("posts to the delete-subtree route rather than deleting client-side");
  it.todo("uses an AlertDialog and never a native confirm dialog");
  it.todo("surfaces a failed delete without closing the dialog");
});
