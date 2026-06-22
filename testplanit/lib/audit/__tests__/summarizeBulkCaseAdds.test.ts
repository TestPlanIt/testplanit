import { describe, expect, it } from "vitest";
import {
  summarizeBulkCaseAdds,
  type MaterializedRow,
} from "~/lib/audit/correlation";

/**
 * Bulk "add cases to a run" lands as N TestRunCases CREATE rows that
 * mergeByIdentity collapses into ONE row whose columns are comma-joined. This
 * pass rewrites that noisy row into a single readable line — "N test cases
 * added: <case names>" — so the run history shows a count + the named list
 * instead of raw ids and iteration counters.
 */

function row(partial: Partial<MaterializedRow>): MaterializedRow {
  return {
    sourceRowId: 1,
    sourceTable: "TestRunCases",
    op: "I",
    entityType: "TestRuns",
    entityId: "68344",
    action: "CREATE",
    actor: "u1",
    userName: "U One",
    userEmail: null,
    entityName: "Run blah",
    projectId: "1",
    operationId: "op1",
    tenant: null,
    changes: {},
    ...partial,
  } as MaterializedRow;
}

describe("summarizeBulkCaseAdds", () => {
  it("collapses a bulk TestRunCases CREATE to 'N test cases added' with the named list", () => {
    const [out] = summarizeBulkCaseAdds([
      row({
        changes: {
          id: { old: null, new: "1, 2, 3" },
          order: { old: null, new: "0, 1, 2" },
          repositoryCaseId: {
            old: null,
            new: "100, 101, 102",
            newName: "Login, Logout, Signup",
          },
          isCompleted: { old: null, new: "false" },
        },
      }),
    ]);
    expect(out.changes).toEqual({
      "3 test cases added": { old: null, new: "Login, Logout, Signup" },
    });
  });

  it("uses the singular for a single added case", () => {
    const [out] = summarizeBulkCaseAdds([
      row({
        changes: {
          id: { old: null, new: "5" },
          repositoryCaseId: { old: null, new: "100", newName: "Login" },
        },
      }),
    ]);
    expect(out.changes).toEqual({
      "1 test case added": { old: null, new: "Login" },
    });
  });

  it("falls back to raw ids when the case name was not resolved", () => {
    const [out] = summarizeBulkCaseAdds([
      row({
        changes: {
          id: { old: null, new: "1, 2" },
          repositoryCaseId: { old: null, new: "100, 101" },
        },
      }),
    ]);
    expect(out.changes).toEqual({
      "2 test cases added": { old: null, new: "100, 101" },
    });
  });

  it("passes through non-CREATE and non-TestRunCases rows untouched", () => {
    const update = row({
      action: "UPDATE",
      changes: { stateId: { old: "1", new: "2" } },
    });
    const result = row({
      sourceTable: "TestRunResults",
      action: "CREATE",
      changes: { x: { old: null, new: "y" } },
    });
    const out = summarizeBulkCaseAdds([update, result]);
    expect(out[0]).toBe(update);
    expect(out[1]).toBe(result);
  });

  it("leaves a row without repositoryCaseId untouched", () => {
    const r = row({ changes: { id: { old: null, new: "1" } } });
    const [out] = summarizeBulkCaseAdds([r]);
    expect(out).toBe(r);
  });
});
