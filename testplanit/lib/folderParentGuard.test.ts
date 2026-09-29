import { ORMError } from "@zenstackhq/orm";
import { describe, expect, it, vi } from "vitest";
import {
  assertValidFolderParent,
  type FolderReader,
} from "./folderParentGuard";

// Project 1 / repository 1:  1 ─┬─ 2 ── 3
//                               └─ 4 (deleted)
// Project 2 / repository 2:  10
const FOLDERS = [
  { id: 1, parentId: null, projectId: 1, repositoryId: 1, isDeleted: false },
  { id: 2, parentId: 1, projectId: 1, repositoryId: 1, isDeleted: false },
  { id: 3, parentId: 2, projectId: 1, repositoryId: 1, isDeleted: false },
  { id: 4, parentId: 1, projectId: 1, repositoryId: 1, isDeleted: true },
  { id: 10, parentId: null, projectId: 2, repositoryId: 2, isDeleted: false },
];

const reader = () =>
  ({
    repositoryFolders: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: number } }) =>
          FOLDERS.find((f) => f.id === where.id) ?? null
      ),
    },
  }) as unknown as FolderReader;

const move = (folderId: number, data: Record<string, unknown>) =>
  assertValidFolderParent(
    "RepositoryFolders",
    "update",
    { where: { id: folderId }, data },
    reader()
  );

describe("assertValidFolderParent", () => {
  it("allows a move to another folder in the same repository", async () => {
    await expect(move(3, { parentId: 1 })).resolves.toBeUndefined();
    await expect(
      move(3, { parent: { connect: { id: 1 } } })
    ).resolves.toBeUndefined();
  });

  it("allows a move to the root", async () => {
    await expect(move(3, { parentId: null })).resolves.toBeUndefined();
    await expect(
      move(3, { parent: { disconnect: true } })
    ).resolves.toBeUndefined();
  });

  it("rejects a folder as its own parent", async () => {
    await expect(move(2, { parentId: 2 })).rejects.toBeInstanceOf(ORMError);
  });

  it("rejects a move under one of the folder's descendants", async () => {
    await expect(move(1, { parent: { connect: { id: 3 } } })).rejects.toThrow(
      /itself or one of its subfolders/
    );
  });

  it("rejects a deleted or missing parent", async () => {
    await expect(move(3, { parentId: 4 })).rejects.toThrow(/does not exist/);
    await expect(move(3, { parentId: 99 })).rejects.toThrow(/does not exist/);
  });

  it("rejects a parent in another project", async () => {
    await expect(move(3, { parentId: 10 })).rejects.toThrow(
      /another repository/
    );
  });

  it("checks the scope of a new folder's parent", async () => {
    const create = (data: Record<string, unknown>) =>
      assertValidFolderParent(
        "RepositoryFolders",
        "create",
        { data },
        reader()
      );
    await expect(
      create({
        name: "New",
        project: { connect: { id: 1 } },
        repository: { connect: { id: 1 } },
        parent: { connect: { id: 2 } },
      })
    ).resolves.toBeUndefined();
    await expect(
      create({ name: "New", projectId: 1, repositoryId: 1, parentId: 10 })
    ).rejects.toThrow(/another repository/);
  });

  it("does not look anything up when the parent is not changing", async () => {
    const r = reader();
    await assertValidFolderParent(
      "RepositoryFolders",
      "update",
      { where: { id: 3 }, data: { name: "Renamed" } },
      r
    );
    expect(r.repositoryFolders.findUnique).not.toHaveBeenCalled();
  });
});
