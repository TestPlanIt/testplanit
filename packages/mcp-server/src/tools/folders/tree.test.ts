import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../api.js", () => ({
  zenstack: vi.fn(),
}));

import * as apiModule from "../../api.js";
import {
  buildFolderIndex,
  buildPathInfo,
  collectSubtreeIds,
  computeRecursiveCounts,
  fetchAutomatedCaseCounts,
  fetchProjectFolders,
  type FlatFolder,
} from "./tree.js";

const zenstackMock = vi.mocked(apiModule.zenstack);

const env = { apiUrl: "https://host.example.com", apiToken: "tpi_testtoken" };

function f(
  id: number,
  parentId: number | null,
  caseCount = 0,
  name = `Folder ${id}`,
): FlatFolder {
  return { id, name, parentId, order: 0, caseCount };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchProjectFolders", () => {
  it("one flat findMany: whole project, live rows only, _count.cases live-filtered, (order, id) ordering", async () => {
    zenstackMock.mockResolvedValueOnce([
      { id: 1, name: "Root", parentId: null, order: 0, _count: { cases: 4 } },
      { id: 2, name: "Child", parentId: 1, order: 1 }, // _count absent → 0
    ]);

    const rows = await fetchProjectFolders(7, env);

    const [model, op, body] = zenstackMock.mock.calls[0]!;
    expect(model).toBe("repositoryFolders");
    expect(op).toBe("findMany");
    expect(body).toMatchObject({
      where: { projectId: 7, isDeleted: false },
      orderBy: [{ order: "asc" }, { id: "asc" }],
    });
    const select = (body as { select: Record<string, unknown> }).select;
    const countCases = ((select["_count"] as Record<string, unknown>)["select"] as Record<string, unknown>)["cases"];
    expect(countCases).toMatchObject({ where: { isDeleted: false } });
    expect(rows).toEqual([
      { id: 1, name: "Root", parentId: null, order: 0, caseCount: 4 },
      { id: 2, name: "Child", parentId: 1, order: 1, caseCount: 0 },
    ]);
  });

  it("null response → []", async () => {
    zenstackMock.mockResolvedValueOnce(null);
    expect(await fetchProjectFolders(7, env)).toEqual([]);
  });
});

describe("fetchAutomatedCaseCounts", () => {
  it("one batched groupBy on folderId scoped to live automated cases", async () => {
    zenstackMock.mockResolvedValueOnce([
      { folderId: 3, _count: { id: 12 } },
      { folderId: 9, _count: { id: 5 } },
    ]);

    const counts = await fetchAutomatedCaseCounts(7, env);

    const [model, op, body] = zenstackMock.mock.calls[0]!;
    expect(model).toBe("repositoryCases");
    expect(op).toBe("groupBy");
    expect(body).toEqual({
      by: ["folderId"],
      where: { projectId: 7, isDeleted: false, automated: true },
      _count: { id: true },
    });
    expect(counts.get(3)).toBe(12);
    expect(counts.get(9)).toBe(5);
    expect(counts.get(1)).toBeUndefined();
  });
});

describe("buildFolderIndex / collectSubtreeIds", () => {
  it("subtree includes the root itself and every descendant, not siblings", () => {
    const index = buildFolderIndex([
      f(1, null),
      f(2, 1),
      f(3, 2),
      f(4, 2),
      f(5, null), // sibling root — must not appear
      f(6, 5),
    ]);

    const ids = collectSubtreeIds(index, 1).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4]);
    expect(collectSubtreeIds(index, 3)).toEqual([3]);
  });

  it("cycle-safe: corrupted parent chain terminates", () => {
    // 2 ↔ 3 point at each other.
    const index = buildFolderIndex([f(2, 3), f(3, 2)]);
    const ids = collectSubtreeIds(index, 2).sort((a, b) => a - b);
    expect(ids).toEqual([2, 3]);
  });
});

describe("computeRecursiveCounts", () => {
  it("recursive(f) = direct(f) + Σ direct(descendants); every folder gets an entry", () => {
    const index = buildFolderIndex([
      f(1, null, 2),
      f(2, 1, 5),
      f(3, 2, 17),
      f(4, 1, 0),
      f(5, null, 9),
    ]);
    const direct = new Map([
      [1, 2],
      [2, 5],
      [3, 17],
      [5, 9],
    ]);

    const rec = computeRecursiveCounts(index, direct);

    expect(rec.get(1)).toBe(24);
    expect(rec.get(2)).toBe(22);
    expect(rec.get(3)).toBe(17);
    expect(rec.get(4)).toBe(0);
    expect(rec.get(5)).toBe(9);
  });

  it("sparse direct map (groupBy output): folders absent from the map count 0", () => {
    const index = buildFolderIndex([f(1, null), f(2, 1), f(3, 2)]);
    const rec = computeRecursiveCounts(index, new Map([[3, 7]]));
    expect(rec.get(1)).toBe(7);
    expect(rec.get(2)).toBe(7);
    expect(rec.get(3)).toBe(7);
  });
});

describe("buildPathInfo", () => {
  it("root-to-leaf path with ' / ' separator, ancestors root-first, root identity", () => {
    const index = buildFolderIndex([
      f(1, null, 0, "Content"),
      f(2, 1, 0, "Documents"),
      f(3, 2, 0, "Commenting"),
    ]);

    const info = buildPathInfo(index);

    expect(info.get(3)).toEqual({
      path: "Content / Documents / Commenting",
      ancestorIds: [1, 2],
      rootId: 1,
      rootName: "Content",
    });
    expect(info.get(1)).toEqual({
      path: "Content",
      ancestorIds: [],
      rootId: 1,
      rootName: "Content",
    });
  });

  it("dangling parentId: folder becomes its own root instead of throwing", () => {
    const index = buildFolderIndex([f(9, 999, 0, "Orphan")]);
    expect(buildPathInfo(index).get(9)).toEqual({
      path: "Orphan",
      ancestorIds: [],
      rootId: 9,
      rootName: "Orphan",
    });
  });
});
