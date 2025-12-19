import { describe, it, expect } from "vitest";
import {
  getReportSummary,
  getUserIdFromRow,
  dimensionToDraggableField,
  draggableFieldToDimension,
  getSortValue,
  getSourceDisplayInfo,
  buildDateFilter,
} from "./reportUtils";

describe("reportUtils", () => {
  describe("getReportSummary", () => {
    it("should return null for empty dimensions", () => {
      const result = getReportSummary([], [{ label: "Count" }]);
      expect(result).toBeNull();
    });

    it("should return null for empty metrics", () => {
      const result = getReportSummary([{ label: "Status" }], []);
      expect(result).toBeNull();
    });

    it("should return null for both empty", () => {
      const result = getReportSummary([], []);
      expect(result).toBeNull();
    });

    it("should generate summary for single dimension and metric", () => {
      const dimensions = [{ label: "Status" }];
      const metrics = [{ label: "Test Count" }];
      const result = getReportSummary(dimensions, metrics);
      expect(result).toBe("Test Count grouped by Status");
    });

    it("should generate summary for multiple dimensions", () => {
      const dimensions = [{ label: "Status" }, { label: "User" }];
      const metrics = [{ label: "Count" }];
      const result = getReportSummary(dimensions, metrics);
      expect(result).toBe("Count grouped by Status and User");
    });

    it("should generate summary for multiple metrics", () => {
      const dimensions = [{ label: "Status" }];
      const metrics = [{ label: "Count" }, { label: "Pass Rate" }];
      const result = getReportSummary(dimensions, metrics);
      expect(result).toBe("Count and Pass Rate grouped by Status");
    });

    it("should generate summary for multiple dimensions and metrics", () => {
      const dimensions = [
        { label: "Status" },
        { label: "User" },
        { label: "Date" },
      ];
      const metrics = [
        { label: "Count" },
        { label: "Pass Rate" },
        { label: "Duration" },
      ];
      const result = getReportSummary(dimensions, metrics);
      expect(result).toBe(
        "Count, Pass Rate and Duration grouped by Status, User and Date"
      );
    });

    it("should use translation function when provided", () => {
      const mockT = (key: string) => {
        const translations: Record<string, string> = {
          "common.and": "y",
          "common.groupedBy": "agrupado por",
        };
        return translations[key] || key;
      };

      const dimensions = [{ label: "Estado" }, { label: "Usuario" }];
      const metrics = [{ label: "Cantidad" }];
      const result = getReportSummary(dimensions, metrics, mockT);
      expect(result).toBe("Cantidad agrupado por Estado y Usuario");
    });
  });

  describe("getUserIdFromRow", () => {
    it("should return userId from original object", () => {
      const row = { original: { userId: "user-123" } };
      expect(getUserIdFromRow(row)).toBe("user-123");
    });

    it("should return UserId with capital U", () => {
      const row = { original: { UserId: "user-456" } };
      expect(getUserIdFromRow(row)).toBe("user-456");
    });

    it("should return id as fallback", () => {
      const row = { original: { id: "user-789" } };
      expect(getUserIdFromRow(row)).toBe("user-789");
    });

    it("should return user.id from nested object", () => {
      const row = { original: { user: { id: "nested-user-id" } } };
      expect(getUserIdFromRow(row)).toBe("nested-user-id");
    });

    it("should return user string directly", () => {
      const row = { original: { user: "string-user-id" } };
      expect(getUserIdFromRow(row)).toBe("string-user-id");
    });

    it("should return User.id with capital U", () => {
      const row = { original: { User: { id: "capital-user-id" } } };
      expect(getUserIdFromRow(row)).toBe("capital-user-id");
    });

    it("should return name as last fallback", () => {
      const row = { original: { name: "John Doe" } };
      expect(getUserIdFromRow(row)).toBe("John Doe");
    });

    it("should return Name with capital N", () => {
      const row = { original: { Name: "Jane Doe" } };
      expect(getUserIdFromRow(row)).toBe("Jane Doe");
    });

    it("should return undefined for empty row", () => {
      const row = { original: {} };
      expect(getUserIdFromRow(row)).toBeUndefined();
    });

    it("should handle null row", () => {
      expect(getUserIdFromRow(null)).toBeUndefined();
    });
  });

  describe("dimensionToDraggableField", () => {
    it("should convert dimension to draggable field", () => {
      const dim = { value: "status", label: "Status" };
      const result = dimensionToDraggableField(dim);
      expect(result).toEqual({
        id: "status",
        label: "Status",
        apiLabel: undefined,
      });
    });

    it("should include apiLabel when present", () => {
      const dim = { value: "user", label: "User", apiLabel: "userId" };
      const result = dimensionToDraggableField(dim);
      expect(result).toEqual({
        id: "user",
        label: "User",
        apiLabel: "userId",
      });
    });

    it("should convert numeric value to string", () => {
      const dim = { value: 123, label: "Test" };
      const result = dimensionToDraggableField(dim);
      expect(result.id).toBe("123");
    });
  });

  describe("draggableFieldToDimension", () => {
    it("should convert draggable field to dimension", () => {
      const field = { id: "status", label: "Status" };
      const result = draggableFieldToDimension(field);
      expect(result).toEqual({
        value: "status",
        label: "Status",
        apiLabel: undefined,
      });
    });

    it("should include apiLabel when present", () => {
      const field = { id: "user", label: "User", apiLabel: "userId" };
      const result = draggableFieldToDimension(field);
      expect(result).toEqual({
        value: "user",
        label: "User",
        apiLabel: "userId",
      });
    });

    it("should convert numeric id to string", () => {
      const field = { id: 456, label: "Test" };
      const result = draggableFieldToDimension(field);
      expect(result.value).toBe("456");
    });
  });

  describe("getSortValue", () => {
    it("should return primitive value directly", () => {
      const row = { count: 42 };
      expect(getSortValue(row, "count")).toBe(42);
    });

    it("should extract name from object", () => {
      const row = { status: { name: "Passed", id: 1 } };
      expect(getSortValue(row, "status")).toBe("passed");
    });

    it("should extract id from object when no name", () => {
      const row = { item: { id: 123 } };
      expect(getSortValue(row, "item")).toBe(123);
    });

    it("should convert object to string as fallback", () => {
      const row = { data: { foo: "bar" } };
      // The function converts to lowercase, so [object Object] becomes [object object]
      expect(getSortValue(row, "data")).toBe("[object object]");
    });

    it("should convert date columns to timestamp", () => {
      const row = { createdAt: "2024-01-15T10:30:00Z" };
      const result = getSortValue(row, "createdAt");
      expect(typeof result).toBe("number");
      expect(result).toBe(new Date("2024-01-15T10:30:00Z").getTime());
    });

    it("should handle date column names with 'date' (lowercase)", () => {
      // The function checks column.includes("date") - lowercase only
      const row = { enddate: "2024-06-01" };
      const result = getSortValue(row, "enddate");
      expect(typeof result).toBe("number");
    });

    it("should return lowercase string for text values", () => {
      const row = { name: "Test Case" };
      expect(getSortValue(row, "name")).toBe("test case");
    });

    it("should handle null values", () => {
      const row = { value: null };
      expect(getSortValue(row, "value")).toBe("");
    });

    it("should handle undefined values", () => {
      const row = { other: "test" };
      expect(getSortValue(row, "missing")).toBe("");
    });
  });

  describe("getSourceDisplayInfo", () => {
    it("should return correct info for MANUAL", () => {
      const result = getSourceDisplayInfo("MANUAL");
      expect(result).toEqual({ icon: "user", color: "#3b82f6" });
    });

    it("should return correct info for API", () => {
      const result = getSourceDisplayInfo("API");
      expect(result).toEqual({ icon: "globe", color: "#10b981" });
    });

    it("should return correct info for IMPORT", () => {
      const result = getSourceDisplayInfo("IMPORT");
      expect(result).toEqual({ icon: "upload", color: "#f59e0b" });
    });

    it("should return correct info for JUNIT", () => {
      const result = getSourceDisplayInfo("JUNIT");
      expect(result).toEqual({ icon: "beaker", color: "#8b5cf6" });
    });

    it("should return default info for unknown source", () => {
      const result = getSourceDisplayInfo("UNKNOWN");
      expect(result).toEqual({ icon: "help-circle", color: "#6b7280" });
    });
  });

  describe("buildDateFilter", () => {
    it("should return empty object when no filters", () => {
      const result = buildDateFilter();
      expect(result).toEqual({});
    });

    it("should return empty object when filters are undefined", () => {
      const result = buildDateFilter(undefined);
      expect(result).toEqual({});
    });

    it("should build filter with only startDate", () => {
      const result = buildDateFilter({ startDate: "2024-01-15" });
      expect(result).toHaveProperty("executedAt");
      expect(result.executedAt).toHaveProperty("gte");
      const gteDate = result.executedAt.gte as Date;
      expect(gteDate.getUTCHours()).toBe(0);
      expect(gteDate.getUTCMinutes()).toBe(0);
    });

    it("should build filter with only endDate", () => {
      const result = buildDateFilter({ endDate: "2024-01-20" });
      expect(result).toHaveProperty("executedAt");
      expect(result.executedAt).toHaveProperty("lt");
      // End date should be next day at midnight
      const ltDate = result.executedAt.lt as Date;
      expect(ltDate.getUTCHours()).toBe(0);
    });

    it("should build filter with both startDate and endDate", () => {
      const result = buildDateFilter({
        startDate: "2024-01-15",
        endDate: "2024-01-20",
      });
      expect(result.executedAt).toHaveProperty("gte");
      expect(result.executedAt).toHaveProperty("lt");
    });

    it("should use custom date field", () => {
      const result = buildDateFilter(
        { startDate: "2024-01-15" },
        "createdAt"
      );
      expect(result).toHaveProperty("createdAt");
      expect(result.createdAt).toHaveProperty("gte");
    });

    it("should set end date to next day for inclusive range", () => {
      const result = buildDateFilter({ endDate: "2024-01-20" });
      const ltDate = result.executedAt.lt as Date;
      // Should be Jan 21, not Jan 20
      expect(ltDate.getUTCDate()).toBe(21);
    });
  });
});
