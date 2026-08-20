// Wave 0 structural scaffold for HYG-01's read-side containment gate.
// Plan 23-08 converts the five placeholder titles below into real
// assertions; this file's job right now is to give them a permanent,
// byte-stable home on the unit lane and to record why the gate must be
// built the way it is.
//
// This is the read-side mirror of PROV-06's write-side containment gate
// (lib/services/linkedIssueUpsert.containment.test.ts) — same technique (a
// repo-wide structural search over tracked source, a reviewed allowlist
// with a written reason per entry, a throw-with-actionable-message before
// the final empty-array assertion), applied to reads instead of writes.
// It is co-located under lib/services/ specifically so it runs inside
// `pnpm precommit`, the always-on unit lane, rather than only a separate
// CI database lane — the read-side leak this gate defends against has no
// live-DB precondition, so gating it behind the slower lane would let a
// regression sit uncaught for an entire review cycle.
//
// THE PATTERN TRAP (read before writing this gate in 23-08): an earlier
// research pass grepped a flattened symbol name for the generated
// per-model list hook and found it nowhere in this codebase — that symbol
// does not exist here. The real shape is a dynamic property access: a
// shared client-queries object is indexed by the issue model's name at
// runtime, and a specific query method is called off that property. A
// grep pattern built against the flattened symbol silently matches zero of
// the real call sites and reports a false "clean" result while every real
// consumer keeps leaking. 23-08's gate must be built and proven against the
// real call shape, confirmed by direct reads of the actual consumer files,
// not against the stale symbol name.
//
// THE COMMENT-TEXT TRAP (this file's own hazard): `git grep` cannot tell
// code from comment. A structural gate whose own explanatory comment
// reproduces the literal substring it greps for becomes a self-inflicted
// false positive — this happened for real on an earlier phase's write-side
// gate. This file, and every file 23-08 touches, must describe forbidden
// call shapes in prose (as done above) and must never paste the literal
// matched text.

import { describe, it } from "vitest";

describe("Issue read-scope containment (HYG-01, structural)", () => {
  it.todo(
    "every issue read call site is either scoped, opt-in, or exempt with a written reason"
  );
  it.todo("the grep patterns match the real ZenStack hook call shape");
  it.todo("every scoped consumer carries the shared defect-scope predicate");
  it.todo("the raw-SQL coverage query mirrors the shared predicate literally");
  it.todo(
    "both Elasticsearch document call sites write the requirement role"
  );
});
