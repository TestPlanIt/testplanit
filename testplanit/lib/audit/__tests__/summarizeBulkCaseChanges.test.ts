import { describe, expect, it } from "vitest";
import {
  summarizeBulkCaseChanges,
  type MaterializedRow,
} from "~/lib/audit/correlation";

/**
 * Bulk "add/remove cases on a run" lands as N TestRunCases rows that
 * mergeByIdentity collapses into ONE row whose columns are comma-joined. This
 * pass rewrites that noisy row into a single readable line — "N test cases
 * added/removed: <case names>" — so the run history shows a count + the named
 * list instead of raw ids and iteration counters. Adds are CREATE rows; removes
 * are soft-deletes (UPDATE isDeleted → DELETE action) that carry repositoryCaseId
 * only because the trigger registry lists it in captureCols.
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

describe("summarizeBulkCaseChanges", () => {
  it("collapses a bulk TestRunCases CREATE to 'N test cases added' with the named list", () => {
    const [out] = summarizeBulkCaseChanges([
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
    const [out] = summarizeBulkCaseChanges([
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
    const [out] = summarizeBulkCaseChanges([
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

  it("collapses a bulk soft-delete to 'N test cases removed' with the named list", () => {
    // A soft-delete UPDATE flips isDeleted and (via captureCols) re-records the
    // unchanged repositoryCaseId, so old === new for the case column.
    const [out] = summarizeBulkCaseChanges([
      row({
        action: "DELETE",
        changes: {
          isDeleted: { old: "false", new: "true" },
          testRunId: { old: "68344", new: "68344" },
          repositoryCaseId: {
            old: "100, 101, 102",
            new: "100, 101, 102",
            oldName: "Login, Logout, Signup",
            newName: "Login, Logout, Signup",
          },
        },
      }),
    ]);
    expect(out.changes).toEqual({
      "3 test cases removed": { old: "Login, Logout, Signup", new: null },
    });
  });

  it("uses the singular for a single removed case", () => {
    const [out] = summarizeBulkCaseChanges([
      row({
        action: "DELETE",
        changes: {
          isDeleted: { old: "false", new: "true" },
          repositoryCaseId: {
            old: "100",
            new: "100",
            oldName: "Login",
            newName: "Login",
          },
        },
      }),
    ]);
    expect(out.changes).toEqual({
      "1 test case removed": { old: "Login", new: null },
    });
  });

  it("handles a hard delete that carries the case only on the old side", () => {
    const [out] = summarizeBulkCaseChanges([
      row({
        action: "DELETE",
        changes: {
          repositoryCaseId: {
            old: "100, 101",
            new: null,
            oldName: "Login, Logout",
          },
        },
      }),
    ]);
    expect(out.changes).toEqual({
      "2 test cases removed": { old: "Login, Logout", new: null },
    });
  });

  it("passes through UPDATE and non-TestRunCases rows untouched", () => {
    const update = row({
      action: "UPDATE",
      changes: { stateId: { old: "1", new: "2" } },
    });
    const result = row({
      sourceTable: "TestRunResults",
      action: "CREATE",
      changes: { x: { old: null, new: "y" } },
    });
    const out = summarizeBulkCaseChanges([update, result]);
    expect(out[0]).toBe(update);
    expect(out[1]).toBe(result);
  });

  it("leaves a row without repositoryCaseId untouched", () => {
    const r = row({ changes: { id: { old: null, new: "1" } } });
    const [out] = summarizeBulkCaseChanges([r]);
    expect(out).toBe(r);
  });
});
