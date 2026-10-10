import { ORMError } from "@zenstackhq/orm";
import { describe, expect, it, vi } from "vitest";
import {
  assertValidMilestoneParent,
  REOPEN_UNDER_COMPLETED_PARENT_MESSAGE,
  type MilestoneReader,
} from "./milestoneParentGuard";

// Project 1:  1 ─┬─ 2 ── 3
//                ├─ 4 (deleted)
//                └─ 6 (completed) ── 7 (completed)
// Project 2:  10
const MILESTONES = [
  { id: 1, parentId: null, projectId: 1, isDeleted: false, isCompleted: false },
  { id: 2, parentId: 1, projectId: 1, isDeleted: false, isCompleted: false },
  { id: 3, parentId: 2, projectId: 1, isDeleted: false, isCompleted: false },
  { id: 4, parentId: 1, projectId: 1, isDeleted: true, isCompleted: false },
  { id: 6, parentId: 1, projectId: 1, isDeleted: false, isCompleted: true },
  { id: 7, parentId: 6, projectId: 1, isDeleted: false, isCompleted: true },
  {
    id: 10,
    parentId: null,
    projectId: 2,
    isDeleted: false,
    isCompleted: false,
  },
];

const reader = () =>
  ({
    milestones: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: number } }) =>
          MILESTONES.find((m) => m.id === where.id) ?? null
      ),
    },
  }) as unknown as MilestoneReader;

const update = (milestoneId: number, data: Record<string, unknown>) =>
  assertValidMilestoneParent(
    "Milestones",
    "update",
    { where: { id: milestoneId }, data },
    reader()
  );

const create = (data: Record<string, unknown>) =>
  assertValidMilestoneParent("Milestones", "create", { data }, reader());

describe("assertValidMilestoneParent", () => {
  it("allows a move under another milestone of the same project", async () => {
    await expect(update(3, { parentId: 1 })).resolves.toBeUndefined();
    await expect(
      update(3, { parent: { connect: { id: 1 } } })
    ).resolves.toBeUndefined();
  });

  it("allows a move to the top level", async () => {
    await expect(update(3, { parentId: null })).resolves.toBeUndefined();
    await expect(
      update(3, { parent: { disconnect: true } })
    ).resolves.toBeUndefined();
  });

  it("rejects a milestone as its own parent", async () => {
    await expect(update(2, { parentId: 2 })).rejects.toBeInstanceOf(ORMError);
  });

  it("rejects a move under one of the milestone's descendants", async () => {
    await expect(update(1, { parent: { connect: { id: 3 } } })).rejects.toThrow(
      /itself or one of its child milestones/
    );
  });

  it("rejects a deleted or missing parent", async () => {
    await expect(update(3, { parentId: 4 })).rejects.toThrow(/does not exist/);
    await expect(update(3, { parentId: 99 })).rejects.toThrow(/does not exist/);
  });

  it("rejects a parent in another project", async () => {
    await expect(update(3, { parentId: 10 })).rejects.toThrow(
      /another project/
    );
  });

  it("checks the scope of a new milestone's parent", async () => {
    await expect(
      create({
        name: "New",
        project: { connect: { id: 1 } },
        parent: { connect: { id: 2 } },
      })
    ).resolves.toBeUndefined();
    await expect(
      create({ name: "New", projectId: 1, parentId: 10 })
    ).rejects.toThrow(/another project/);
    await expect(
      create({ name: "New", projectId: 1, parentId: 4 })
    ).rejects.toThrow(/does not exist/);
  });

  it("rejects reopening a milestone whose parent is completed", async () => {
    await expect(update(7, { isCompleted: false })).rejects.toThrow(
      REOPEN_UNDER_COMPLETED_PARENT_MESSAGE
    );
    // Reopening and moving out from under the completed parent in one write
    // is fine: the new parent is open.
    await expect(
      update(7, { isCompleted: false, parentId: 1 })
    ).resolves.toBeUndefined();
  });

  it("allows reopening when the parent is open or the milestone is top-level", async () => {
    await expect(update(6, { isCompleted: false })).resolves.toBeUndefined();
    await expect(update(3, { isCompleted: false })).resolves.toBeUndefined();
  });

  it("does not look anything up when neither the parent nor completion changes", async () => {
    const r = reader();
    await assertValidMilestoneParent(
      "Milestones",
      "update",
      { where: { id: 3 }, data: { name: "Renamed", isCompleted: true } },
      r
    );
    expect(r.milestones.findUnique).not.toHaveBeenCalled();
  });
});
