import { describe, expect, it } from "vitest";

import {
  buildFolderAncestorMap,
  groupResults,
  type GroupAccumulator,
} from "./reportGrouping";

// Simple count accumulator used across the grouping tests.
const countAcc: GroupAccumulator<{ n: number }> = {
  create: () => ({ n: 0 }),
  add: (acc) => {
    acc.n++;
  },
  finalize: (acc) => ({ count: acc.n }),
};

describe("reportGrouping", () => {
  describe("groupResults", () => {
    it("groups single-valued dimensions and counts each group", () => {
      const results = [{ statusId: 1 }, { statusId: 1 }, { statusId: 2 }];
      const rows = groupResults(results, ["statusId"], countAcc);
      expect(rows).toContainEqual({ statusId: 1, count: 2 });
      expect(rows).toContainEqual({ statusId: 2, count: 1 });
      expect(rows).toHaveLength(2);
    });

    it("normalizes executedAt to the UTC day", () => {
      const results = [
        { executedAt: "2026-05-26T09:00:00.000Z" },
        { executedAt: "2026-05-26T23:30:00.000Z" },
        { executedAt: "2026-05-27T01:00:00.000Z" },
      ];
      const rows = groupResults(results, ["executedAt"], countAcc);
      expect(rows).toContainEqual({
        executedAt: "2026-05-26T00:00:00.000Z",
        count: 2,
      });
      expect(rows).toContainEqual({
        executedAt: "2026-05-27T00:00:00.000Z",
        count: 1,
      });
    });

    it("fans a multi-tag case out into one group per tag", () => {
      const results = [
        {
          testRunCase: {
            repositoryCase: { caseTags: [{ tagId: 10 }, { tagId: 20 }] },
          },
        },
        { testRunCase: { repositoryCase: { caseTags: [{ tagId: 10 }] } } },
        { testRunCase: { repositoryCase: { caseTags: [] } } },
      ];
      const rows = groupResults(results, ["tagId"], countAcc);
      // Tag 10 appears on the first two results, tag 20 only on the first,
      // and the untagged case lands in a null group.
      expect(rows).toContainEqual({ tagId: 10, count: 2 });
      expect(rows).toContainEqual({ tagId: 20, count: 1 });
      expect(rows).toContainEqual({ tagId: null, count: 1 });
    });

    it("groups folders flat by the case's own folder without ancestors", () => {
      const results = [
        { testRunCase: { repositoryCase: { folderId: 3 } } },
        { testRunCase: { repositoryCase: { folderId: 2 } } },
      ];
      const rows = groupResults(results, ["folderId"], countAcc);
      expect(rows).toContainEqual({ folderId: 3, count: 1 });
      expect(rows).toContainEqual({ folderId: 2, count: 1 });
      expect(rows).toHaveLength(2);
    });

    it("rolls a case up into every ancestor folder when descendants are enabled", () => {
      const results = [{ testRunCase: { repositoryCase: { folderId: 3 } } }];
      const folderAncestors = new Map<number, number[]>([[3, [3, 2, 1]]]);
      const rows = groupResults(results, ["folderId"], countAcc, {
        folderAncestors,
      });
      // The single result counts toward its folder and both ancestors.
      expect(rows).toContainEqual({ folderId: 3, count: 1 });
      expect(rows).toContainEqual({ folderId: 2, count: 1 });
      expect(rows).toContainEqual({ folderId: 1, count: 1 });
      expect(rows).toHaveLength(3);
    });

    it("takes the cartesian product across multiple dimensions", () => {
      const results = [
        {
          statusId: 1,
          testRunCase: {
            repositoryCase: { caseTags: [{ tagId: 10 }, { tagId: 20 }] },
          },
        },
      ];
      const rows = groupResults(results, ["statusId", "tagId"], countAcc);
      expect(rows).toContainEqual({ statusId: 1, tagId: 10, count: 1 });
      expect(rows).toContainEqual({ statusId: 1, tagId: 20, count: 1 });
      expect(rows).toHaveLength(2);
    });

    it("supports a unique-set accumulator (distinct case counting)", () => {
      const uniqueCaseAcc: GroupAccumulator<{ ids: Set<number> }> = {
        create: () => ({ ids: new Set<number>() }),
        add: (acc, result: any) => {
          acc.ids.add(result.testRunCase.repositoryCaseId);
        },
        finalize: (acc) => ({ cases: acc.ids.size }),
      };
      const results = [
        { statusId: 1, testRunCase: { repositoryCaseId: 100 } },
        { statusId: 1, testRunCase: { repositoryCaseId: 100 } },
        { statusId: 1, testRunCase: { repositoryCaseId: 200 } },
      ];
      const rows = groupResults(results, ["statusId"], uniqueCaseAcc);
      expect(rows).toEqual([{ statusId: 1, cases: 2 }]);
    });

    it("returns an empty array for no results", () => {
      expect(groupResults([], ["statusId"], countAcc)).toEqual([]);
    });
  });

  describe("buildFolderAncestorMap", () => {
    function fakePrisma(
      folders: Array<{ id: number; parentId: number | null }>
    ) {
      return {
        repositoryFolders: {
          findMany: async () => folders,
        },
      };
    }

    it("returns self plus the ancestor chain for each folder", async () => {
      const prisma = fakePrisma([
        { id: 1, parentId: null },
        { id: 2, parentId: 1 },
        { id: 3, parentId: 2 },
      ]);
      const map = await buildFolderAncestorMap(prisma, 1, true);
      expect(map.get(1)).toEqual([1]);
      expect(map.get(2)).toEqual([2, 1]);
      expect(map.get(3)).toEqual([3, 2, 1]);
    });

    it("guards against cycles", async () => {
      const prisma = fakePrisma([
        { id: 1, parentId: 2 },
        { id: 2, parentId: 1 },
      ]);
      const map = await buildFolderAncestorMap(prisma, 1, true);
      expect(map.get(1)).toEqual([1, 2]);
      expect(map.get(2)).toEqual([2, 1]);
    });
  });
});
