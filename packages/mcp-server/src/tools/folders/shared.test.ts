import { describe, it, expect } from "vitest";
import { mapFolderTreeNode } from "./shared.js";

// NOTE: fetchFolderDetail is tested indirectly through list/get tests.
// Direct tests of mapFolderTreeNode (pure function) go here.

describe("mapFolderTreeNode", () => {
  it("flat node with no children and zero count", () => {
    const raw = { id: 1, name: "x", parentId: null, _count: { cases: 0 }, children: [] };
    const result = mapFolderTreeNode(raw);
    expect(result).toEqual({ id: 1, name: "x", parentId: null, caseCount: 0, children: [] });
  });

  it("2-level recursion: preserves children with their own caseCount", () => {
    const raw = {
      id: 1,
      name: "root",
      parentId: null,
      _count: { cases: 3 },
      children: [
        {
          id: 2,
          name: "child",
          parentId: 1,
          _count: { cases: 5 },
          children: [
            { id: 3, name: "grandchild", parentId: 2, _count: { cases: 2 }, children: [] },
          ],
        },
      ],
    };
    const result = mapFolderTreeNode(raw);
    expect(result.id).toBe(1);
    expect(result.caseCount).toBe(3);
    expect(result.children).toHaveLength(1);
    expect(result.children[0]!.id).toBe(2);
    expect(result.children[0]!.caseCount).toBe(5);
    expect(result.children[0]!.children).toHaveLength(1);
    expect(result.children[0]!.children[0]!.id).toBe(3);
    expect(result.children[0]!.children[0]!.caseCount).toBe(2);
  });

  it("missing _count → caseCount: 0", () => {
    const raw = { id: 10, name: "no-count", parentId: null } as {
      id: number;
      name: string;
      parentId: number | null;
      _count?: { cases?: number };
      children?: never[];
    };
    const result = mapFolderTreeNode(raw);
    expect(result.caseCount).toBe(0);
    expect(result.children).toEqual([]);
  });
});
