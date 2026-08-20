// Wave 0 scaffold for HYG-01's linked-defect list. Plan 23-03 converts the
// two placeholder titles below into real assertions once it imports
// getMilestoneLinkedIssues from ./milestoneSummary (that import is added by
// 23-03, in the same commit as the implementation change — this file stays
// import-light until then, per this repo's Wave-0 RED-avoidance
// convention).
//
// This is the milestone page's LINKED-DEFECT list, not MilestoneIssue
// membership — a different axis entirely. Membership legitimately includes
// requirement rows (an Epic can be both a milestone member on the
// execution axis and a requirement on the capability axis, per the
// perpendicular-axes design from #501); this linked-defect list does not,
// and should exclude them. MemberIssuesColumns.tsx carries its own header
// comment flagging this exact naming collision between the two concepts —
// do not "unify" the two lists into one predicate.

import { describe, it } from "vitest";

describe("getMilestoneLinkedIssues", () => {
  it.todo("excludes requirement-typed rows from the linked-defect list");
  it.todo("still returns non-requirement rows for the ids it collected");
});
