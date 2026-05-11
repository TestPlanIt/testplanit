import { describe, expect, it } from "vitest";
import { sortSummaryItems } from "./summarySort";

const UNTESTED_ID = 1;
const UNTESTED_ORDER = 0;

describe("sortSummaryItems", () => {
  describe("date mode – untested items go to end", () => {
    it("pushes null-statusId items to end", () => {
      const items = [
        { id: "a", statusId: null, statusOrder: null },
        { id: "b", statusId: 2, statusOrder: 1 },
        { id: "c", statusId: 3, statusOrder: 2 },
      ];
      const result = sortSummaryItems(
        items,
        "date",
        UNTESTED_ID,
        UNTESTED_ORDER
      );
      expect(result[2].id).toBe("a");
    });

    it("pushes untestedStatusId items to end", () => {
      const items = [
        { id: "a", statusId: UNTESTED_ID, statusOrder: 0 },
        { id: "b", statusId: 2, statusOrder: 1 },
      ];
      const result = sortSummaryItems(
        items,
        "date",
        UNTESTED_ID,
        UNTESTED_ORDER
      );
      expect(result[0].id).toBe("b");
      expect(result[1].id).toBe("a");
    });

    it("treats both null statusId and untestedStatusId as untested", () => {
      const items = [
        { id: "a", statusId: null, statusOrder: null },
        { id: "b", statusId: UNTESTED_ID, statusOrder: 0 },
        { id: "c", statusId: 2, statusOrder: 1 },
        { id: "d", statusId: 3, statusOrder: 2 },
      ];
      const result = sortSummaryItems(
        items,
        "date",
        UNTESTED_ID,
        UNTESTED_ORDER
      );
      const ids = result.map((i) => i.id);
      expect(ids.slice(0, 2)).toEqual(["c", "d"]);
      expect(ids.slice(2)).toEqual(expect.arrayContaining(["a", "b"]));
    });

    it("preserves relative order among non-untested items", () => {
      const items = [
        { id: "a", statusId: 3, statusOrder: 2 },
        { id: "b", statusId: 2, statusOrder: 1 },
        { id: "c", statusId: 4, statusOrder: 3 },
      ];
      const result = sortSummaryItems(
        items,
        "date",
        UNTESTED_ID,
        UNTESTED_ORDER
      );
      expect(result.map((i) => i.id)).toEqual(["a", "b", "c"]);
    });

    it("preserves relative order among multiple untested items", () => {
      const items = [
        { id: "a", statusId: null, statusOrder: null },
        { id: "b", statusId: null, statusOrder: null },
        { id: "c", statusId: 2, statusOrder: 1 },
      ];
      const result = sortSummaryItems(
        items,
        "date",
        UNTESTED_ID,
        UNTESTED_ORDER
      );
      expect(result[0].id).toBe("c");
      expect(result.slice(1).map((i) => i.id)).toEqual(["a", "b"]);
    });

    it("does not mutate the original array", () => {
      const items = [
        { id: "a", statusId: null, statusOrder: null },
        { id: "b", statusId: 2, statusOrder: 1 },
      ];
      const snapshot = items.map((i) => ({ ...i }));
      sortSummaryItems(items, "date", UNTESTED_ID, UNTESTED_ORDER);
      expect(items).toEqual(snapshot);
    });

    it("handles an empty array", () => {
      expect(sortSummaryItems([], "date", UNTESTED_ID, UNTESTED_ORDER)).toEqual(
        []
      );
    });
  });

  describe("status mode – sort by statusOrder ascending", () => {
    it("sorts by statusOrder ascending", () => {
      const items = [
        { id: "a", statusId: 3, statusOrder: 3 },
        { id: "b", statusId: 2, statusOrder: 1 },
        { id: "c", statusId: 4, statusOrder: 2 },
      ];
      const result = sortSummaryItems(
        items,
        "status",
        UNTESTED_ID,
        UNTESTED_ORDER
      );
      expect(result.map((i) => i.id)).toEqual(["b", "c", "a"]);
    });

    it("uses untestedOrder as fallback for null statusOrder", () => {
      const items = [
        { id: "a", statusId: null, statusOrder: null },
        { id: "b", statusId: 2, statusOrder: 2 },
      ];
      const result = sortSummaryItems(items, "status", UNTESTED_ID, 0);
      expect(result[0].id).toBe("a");
    });

    it("positions null-statusOrder items per untestedOrder relative to others", () => {
      const items = [
        { id: "a", statusId: 2, statusOrder: 5 },
        { id: "b", statusId: null, statusOrder: null },
        { id: "c", statusId: 3, statusOrder: 2 },
      ];
      // untestedOrder = 3 → b sorts between c (2) and a (5)
      const result = sortSummaryItems(items, "status", UNTESTED_ID, 3);
      expect(result.map((i) => i.id)).toEqual(["c", "b", "a"]);
    });

    it("sorts explicit untestedStatusId items by their statusOrder", () => {
      const items = [
        { id: "a", statusId: UNTESTED_ID, statusOrder: 0 },
        { id: "b", statusId: 2, statusOrder: 5 },
        { id: "c", statusId: 3, statusOrder: 2 },
      ];
      const result = sortSummaryItems(
        items,
        "status",
        UNTESTED_ID,
        UNTESTED_ORDER
      );
      expect(result.map((i) => i.id)).toEqual(["a", "c", "b"]);
    });

    it("does not mutate the original array", () => {
      const items = [
        { id: "b", statusId: 2, statusOrder: 2 },
        { id: "a", statusId: 3, statusOrder: 1 },
      ];
      const snapshot = items.map((i) => ({ ...i }));
      sortSummaryItems(items, "status", UNTESTED_ID, UNTESTED_ORDER);
      expect(items).toEqual(snapshot);
    });

    it("handles an empty array", () => {
      expect(
        sortSummaryItems([], "status", UNTESTED_ID, UNTESTED_ORDER)
      ).toEqual([]);
    });
  });
});
