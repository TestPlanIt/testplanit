import { describe, it, expect } from "vitest";
import { ColumnDef } from "@tanstack/react-table";

interface TestData {
  id: number;
  name: string;
  description: string;
  customField: string;
}

interface CustomColumnMeta {
  isVisible?: boolean;
  isPinned?: "left" | "right";
}

// Extract the column visibility logic from DataTable for testing
function getVisibleColumns<TData>(
  columns: ColumnDef<TData>[], 
  columnVisibility: Record<string, boolean>,
  effectiveColumnVisibility: Record<string, boolean>
): ColumnDef<TData>[] {
  // This mirrors the visibleColumns logic from DataTable.tsx lines 229-265
  
  // If we have effectiveColumnVisibility set, use it but still respect enableHiding: false
  if (Object.keys(effectiveColumnVisibility).length > 0) {
    return columns.filter((column) => {
      // Always show columns that cannot be hidden
      if (column.enableHiding === false) {
        return true;
      }
      return effectiveColumnVisibility[column.id as string] === true;
    });
  }

  // If columnVisibility from parent is empty, we're still initializing
  // Use column meta as default visibility
  if (Object.keys(columnVisibility).length === 0) {
    return columns.filter((column) => {
      // Always show columns that cannot be hidden
      if (column.enableHiding === false) {
        return true;
      }
      // Always show first and last columns
      if (
        column.id === columns[0]?.id ||
        column.id === columns[columns.length - 1]?.id
      ) {
        return true;
      }
      // Check meta visibility - if explicitly set to false, hide the column
      const metaVisible = (column.meta as CustomColumnMeta)?.isVisible;
      if (metaVisible === false) {
        return false;
      }
      // Default to showing columns that don't have isVisible set
      return true;
    });
  }

  // This shouldn't happen, but fallback to showing all columns
  return columns;
}

describe("DataTable Column Visibility Logic", () => {
  const staticColumns: ColumnDef<TestData>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      enableHiding: false, // Cannot be hidden
    },
    {
      id: "description",
      header: "Description", 
      accessorKey: "description",
      meta: { isVisible: true },
    },
    {
      id: "actions",
      header: "Actions",
      cell: () => {"Edit"},
      enableHiding: false, // Cannot be hidden
    },
  ];

  const dynamicColumns: ColumnDef<TestData>[] = [
    {
      id: "name",
      header: "Name",
      accessorKey: "name",
      enableHiding: false,
    },
    {
      id: "description",
      header: "Description",
      accessorKey: "description", 
      meta: { isVisible: true },
    },
    {
      id: "customField",
      header: "Custom Field",
      accessorKey: "customField",
      meta: { isVisible: false }, // Hidden by default
    },
    {
      id: "actions",
      header: "Actions",
      cell: () => {"Edit"},
      enableHiding: false,
    },
  ];

  describe("Static columns", () => {
    it("should show all static columns with isVisible: true by default", () => {
      const visible = getVisibleColumns(staticColumns, {}, {});
      
      expect(visible).toHaveLength(3);
      expect(visible.map(col => col.id)).toEqual(["name", "description", "actions"]);
    });

    it("should always show columns with enableHiding: false", () => {
      const visible = getVisibleColumns(
        staticColumns, 
        {}, 
        { name: false, description: false, actions: false }
      );
      
      // name and actions should still be visible because enableHiding: false
      expect(visible).toHaveLength(2);
      expect(visible.map(col => col.id)).toEqual(["name", "actions"]);
    });

    it("should hide columns when effectiveColumnVisibility is explicitly false", () => {
      const visible = getVisibleColumns(
        staticColumns,
        {},
        { name: true, description: false, actions: true }
      );

      expect(visible).toHaveLength(2);
      expect(visible.map(col => col.id)).toEqual(["name", "actions"]);
    });
  });

  describe("Dynamic columns", () => {
    it("should hide dynamic columns with isVisible: false by default", () => {
      const visible = getVisibleColumns(dynamicColumns, {}, {});
      
      // customField should be hidden due to meta: { isVisible: false }
      expect(visible).toHaveLength(3);
      expect(visible.map(col => col.id)).toEqual(["name", "description", "actions"]);
    });

    it("should show dynamic columns when explicitly set to visible", () => {
      const visible = getVisibleColumns(
        dynamicColumns,
        {},
        { name: true, description: true, customField: true, actions: true }
      );

      expect(visible).toHaveLength(4);
      expect(visible.map(col => col.id)).toEqual(["name", "description", "customField", "actions"]);
    });

    it("should keep dynamic columns hidden when explicitly set to false", () => {
      const visible = getVisibleColumns(
        dynamicColumns,
        {},
        { name: true, description: true, customField: false, actions: true }
      );

      expect(visible).toHaveLength(3);
      expect(visible.map(col => col.id)).toEqual(["name", "description", "actions"]);
    });
  });

  describe("First and last column logic", () => {
    const orderedColumns: ColumnDef<TestData>[] = [
      {
        id: "first",
        header: "First Column",
        accessorKey: "name",
        meta: { isVisible: false }, // Should still show because it's first
      },
      {
        id: "middle",
        header: "Middle Column",
        accessorKey: "description",
        meta: { isVisible: false }, // Should be hidden
      },
      {
        id: "last",
        header: "Last Column",
        accessorKey: "customField", 
        meta: { isVisible: false }, // Should still show because it's last
      },
    ];

    it("should always show first and last columns even with isVisible: false", () => {
      const visible = getVisibleColumns(orderedColumns, {}, {});

      expect(visible).toHaveLength(2);
      expect(visible.map(col => col.id)).toEqual(["first", "last"]);
    });
  });

  describe("Mixed column scenarios", () => {
    const mixedColumns: ColumnDef<TestData>[] = [
      {
        id: "name",
        header: "Name",
        accessorKey: "name",
        enableHiding: false, // Always visible
      },
      {
        id: "description",
        header: "Description",
        accessorKey: "description",
        meta: { isVisible: true }, // Visible by default
      },
      {
        id: "customField",
        header: "Custom Field",
        accessorKey: "customField",
        meta: { isVisible: false }, // Hidden by default
      },
      {
        id: "actions",
        header: "Actions",
        cell: () => {"Edit"},
        enableHiding: false, // Always visible
      },
    ];

    it("should handle mixed visibility states correctly", () => {
      const visible = getVisibleColumns(mixedColumns, {}, {});

      // Should show: name (enableHiding: false), description (isVisible: true), actions (enableHiding: false)
      // Should hide: customField (isVisible: false)
      expect(visible).toHaveLength(3);
      expect(visible.map(col => col.id)).toEqual(["name", "description", "actions"]);
    });

    it("should respect effectiveColumnVisibility over meta properties", () => {
      const visible = getVisibleColumns(
        mixedColumns,
        {},
        { name: true, description: false, customField: true, actions: true }
      );

      // effectiveColumnVisibility should override meta properties
      expect(visible).toHaveLength(3);
      expect(visible.map(col => col.id)).toEqual(["name", "customField", "actions"]);
    });
  });
});