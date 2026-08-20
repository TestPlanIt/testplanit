// Wave 0 scaffold for HYG-02's Elasticsearch indexer fix. Plan 23-06
// converts the four placeholder titles below into real assertions,
// importing indexIssue and syncProjectIssuesToElasticsearch from this
// directory's issueSearch module in the same commit that adds the
// requirement-role field to both document literals — this file stays
// import-light of that module until then.
//
// issueSearch.ts has zero test coverage today; this is a real Wave 0
// collection gap, not a refactor of an existing suite.
//
// The second placeholder below is worded against indexIssue's REAL failure
// semantics, not the sibling elasticsearchIndexing.test.ts's wording:
// indexIssue throws when the search client is unavailable, it does not
// return a boolean. 23-06 should read the function before implementing
// that assertion rather than copy the sibling file's "return false" shape.
//
// The fourth placeholder below is the phase's structural defence against
// the two-call-site trap: the single-issue writer and the bulk writer
// build near-identical document literals in the same file, and a
// discarded 2026-04 attempt at this exact fix already updated one without
// the other once — shipping a search index whose contents silently depend
// on which code path last touched a row. 23-06 must add the new field to
// both literals in the same change, and this placeholder is the test that
// would have caught the 2026-04 regression.

import { describe, it } from "vitest";

describe("issueSearch document construction", () => {
  it.todo("indexIssue writes the requirement role onto the document");
  it.todo("indexIssue throws when the search client is unavailable");
  it.todo(
    "syncProjectIssuesToElasticsearch writes the requirement role on every bulk document"
  );
  it.todo("both indexer call sites emit the identical document field set");
});
