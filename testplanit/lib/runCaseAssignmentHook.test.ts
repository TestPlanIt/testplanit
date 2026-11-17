import { describe, expect, it, vi } from "vitest";
import {
  prepareRunCaseAssignment,
  type AssigneeReader,
} from "./runCaseAssignmentHook";

const ROWS = [
  { id: 1, assignedToId: "alice", isDeleted: false },
  { id: 2, assignedToId: null, isDeleted: false },
  { id: 3, assignedToId: "bob", isDeleted: false },
];

const reader = () =>
  ({
    testRunCases: {
      findMany: vi.fn(async ({ where }: any) => {
        const ids =
          where.AND?.[0]?.id?.in ??
          (where.AND?.[0]?.id !== undefined ? [where.AND[0].id] : null);
        return ROWS.filter((r) => ids === null || ids.includes(r.id)).map(
          ({ id, assignedToId }) => ({ id, assignedToId })
        );
      }),
    },
  }) as unknown as AssigneeReader;

describe("prepareRunCaseAssignment", () => {
  it("returns the rows whose assignee changes", async () => {
    const pending = await prepareRunCaseAssignment(
      "TestRunCases",
      "updateMany",
      { where: { id: { in: [1, 2, 3] } }, data: { assignedToId: "alice" } },
      reader()
    );
    expect(pending).toEqual({ assignedToId: "alice", testRunCaseIds: [2, 3] });
  });

  it("returns null when nothing changes, on unassign, and for other writes", async () => {
    const r = reader();
    expect(
      await prepareRunCaseAssignment(
        "TestRunCases",
        "update",
        { where: { id: 1 }, data: { assignedToId: "alice" } },
        r
      )
    ).toBeNull();
    expect(
      await prepareRunCaseAssignment(
        "TestRunCases",
        "update",
        { where: { id: 1 }, data: { assignedToId: null } },
        r
      )
    ).toBeNull();
    expect(
      await prepareRunCaseAssignment(
        "TestRunCases",
        "update",
        { where: { id: 1 }, data: { order: 2 } },
        r
      )
    ).toBeNull();
    expect(
      await prepareRunCaseAssignment(
        "Sessions",
        "update",
        { where: { id: 1 }, data: { assignedToId: "bob" } },
        r
      )
    ).toBeNull();
  });

  it("reads the upsert's update branch", async () => {
    const pending = await prepareRunCaseAssignment(
      "TestRunCases",
      "upsert",
      { where: { id: 2 }, create: {}, update: { assignedToId: "carol" } },
      reader()
    );
    expect(pending).toEqual({ assignedToId: "carol", testRunCaseIds: [2] });
  });
});
