// First co-located suite for this component. Todo-only scaffold, owner
// 27-10. Proves LINK-03's Pitfall 2 fix/fork (UI-SPEC.md): internal picks
// must add the issue id to the tracked array without an upsert call
// (27-RESEARCH.md's previously-undocumented gap — handleAddIssue silently
// drops internal picks today), while external picks keep upserting a
// shell exactly as before.

import { describe, it } from "vitest";

describe("internal issue picks", () => {
  it.todo("adds an internally picked issue id to the tracked array");
  it.todo("does not call the issue upsert for an internally picked issue");
  it.todo("still upserts a shell for an externally picked issue");
});
