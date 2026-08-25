// Wave 0 scaffold, owner 27-05. Proves D-03/D-04/D-05 (CONTEXT.md): a
// case<->requirement linkage is suspect iff the case HAS a latest
// execution AND contentUpdatedAt > executed_at AND (suspectDismissedAt IS
// NULL OR contentUpdatedAt > suspectDismissedAt). `executed_at` comes from
// the shared latestCaseResultsCte() union of manual + JUnit results — this
// predicate never re-derives "latest execution" itself.
//
// Todo-only in this plan (27-01) — 27-05 converts each title into a
// real assertion against isLinkageSuspect() once that function exists.

import { describe, it } from "vitest";

describe("isLinkageSuspect", () => {
  it.todo("returns false when the case has never been executed");
  it.todo("returns false when the requirement has never had a content edit");
  it.todo(
    "returns true when contentUpdatedAt is newer than the case's last execution"
  );
  it.todo("returns false when the case was re-executed after the content edit");
  it.todo("returns false when the flag was dismissed after the content edit");
  it.todo("returns true again when a newer content edit follows a dismissal");
  it.todo("returns false for an unparseable timestamp rather than throwing");
});
