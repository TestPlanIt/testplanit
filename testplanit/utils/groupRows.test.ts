import { describe, it, expect } from "vitest";
import { groupRowsByKeys, flattenGroupedRows } from "./groupRows";

describe("groupRowsByKeys", () => {
  describe("basic grouping", () => {
    it("should return data unchanged when no keys provided", () => {
      const data = [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ];
      expect(groupRowsByKeys(data, [])).toEqual(data);
    });

    it("should group by single key", () => {
      const data = [
        { id: 1, category: "A", value: 10 },
        { id: 2, category: "A", value: 20 },
        { id: 3, category: "B", value: 30 },
      ];

      const result = groupRowsByKeys(data, ["category"]);

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe("A");
      expect(result[0].rows).toHaveLength(2);
      expect(result[1].key).toBe("B");
      expect(result[1].rows).toHaveLength(1);
    });

    it("should group by multiple keys (nested)", () => {
      const data = [
        { id: 1, category: "A", status: "open", value: 10 },
        { id: 2, category: "A", status: "closed", value: 20 },
        { id: 3, category: "B", status: "open", value: 30 },
      ];

      const result = groupRowsByKeys(data, ["category", "status"]);

      expect(result).toHaveLength(2);
      expect(result[0].key).toBe("A");
      expect(result[0].rows).toHaveLength(2);
      expect(result[0].rows[0].key).toBe("open");
      expect(result[0].rows[1].key).toBe("closed");
      expect(result[1].key).toBe("B");
      expect(result[1].rows).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("should handle empty data array", () => {
      expect(groupRowsByKeys([], ["category"])).toEqual([]);
    });

    it("should handle missing key values with (none)", () => {
      const data = [
        { id: 1, category: "A" },
        { id: 2 }, // missing category
      ];

      const result = groupRowsByKeys(data, ["category"]);

      expect(result).toHaveLength(2);
      const noneGroup = result.find((g) => g.key === "(none)");
      expect(noneGroup).toBeDefined();
      expect(noneGroup?.rows).toHaveLength(1);
    });

    it("should handle case-insensitive key matching when lowercase key exists", () => {
      // The implementation tries: r[first], r[first?.toLowerCase()], r[first with spaces removed and lowercase]
      const data = [{ id: 1, category: "A" }]; // lowercase key

      const result = groupRowsByKeys(data, ["Category"]); // uppercase search key

      // Should try lowercase version of search key
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("A");
    });

    it("should use (none) when key is not found in any case", () => {
      const data = [{ id: 1, Category: "A" }]; // uppercase in data

      const result = groupRowsByKeys(data, ["category"]); // lowercase search key

      // Won't find it because the fallback tries lowercase of the search key, not the data key
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe("(none)");
    });
  });
});

describe("flattenGroupedRows", () => {
  describe("basic flattening", () => {
    it("should return data unchanged when no keys provided", () => {
      const data = [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ];
      expect(flattenGroupedRows(data, [])).toEqual(data);
    });

    it("should flatten single-level grouped data", () => {
      const grouped = [
        {
          key: "A",
          rows: [
            { id: 1, value: 10 },
            { id: 2, value: 20 },
          ],
        },
        { key: "B", rows: [{ id: 3, value: 30 }] },
      ];

      const result = flattenGroupedRows(grouped, ["category"]);

      expect(result).toHaveLength(5); // 2 group headers + 3 data rows

      // First group header
      expect(result[0].__isGroup).toBe(true);
      expect(result[0].__groupLevel).toBe(0);
      expect(result[0].__groupKey).toBe("A");
      expect(result[0].category).toBe("A");

      // First group's data rows
      expect(result[1].__isGroup).toBe(false);
      expect(result[1].__groupLevel).toBe(1);
      expect(result[1].id).toBe(1);

      expect(result[2].__isGroup).toBe(false);
      expect(result[2].id).toBe(2);

      // Second group header
      expect(result[3].__isGroup).toBe(true);
      expect(result[3].__groupKey).toBe("B");
    });

    it("should flatten nested grouped data", () => {
      const grouped = [
        {
          key: "A",
          rows: [
            {
              key: "open",
              rows: [{ id: 1, value: 10 }],
            },
            {
              key: "closed",
              rows: [{ id: 2, value: 20 }],
            },
          ],
        },
      ];

      const result = flattenGroupedRows(grouped, ["category", "status"]);

      expect(result).toHaveLength(5); // 1 category header + 2 status headers + 2 data rows

      // Category header
      expect(result[0].__isGroup).toBe(true);
      expect(result[0].__groupLevel).toBe(0);
      expect(result[0].__groupKey).toBe("A");
      expect(result[0].__parentKeys).toEqual([]);

      // Status header (nested under category)
      expect(result[1].__isGroup).toBe(true);
      expect(result[1].__groupLevel).toBe(1);
      expect(result[1].__groupKey).toBe("open");
      expect(result[1].__parentKeys).toEqual(["A"]);

      // Data row under "open" status
      expect(result[2].__isGroup).toBe(false);
      expect(result[2].__groupLevel).toBe(2);
      expect(result[2].__parentKeys).toEqual(["A", "open"]);
    });
  });

  describe("parent key tracking", () => {
    it("should correctly track parent keys through nesting levels", () => {
      const grouped = [
        {
          key: "Region1",
          rows: [
            {
              key: "Team1",
              rows: [{ id: 1, name: "Item 1" }],
            },
          ],
        },
      ];

      const result = flattenGroupedRows(grouped, ["region", "team"]);

      // Data row should have all parent keys
      const dataRow = result.find((r) => !r.__isGroup);
      expect(dataRow?.__parentKeys).toEqual(["Region1", "Team1"]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty grouped data", () => {
      expect(flattenGroupedRows([], ["category"])).toEqual([]);
    });

    it("should handle groups with empty rows", () => {
      const grouped = [{ key: "Empty", rows: [] }];

      const result = flattenGroupedRows(grouped, ["category"]);

      expect(result).toHaveLength(1);
      expect(result[0].__isGroup).toBe(true);
      expect(result[0].__groupKey).toBe("Empty");
    });
  });
});
