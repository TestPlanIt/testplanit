/* eslint-disable react/jsx-no-literals */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { useReportColumns } from "./useReportColumns";
import { renderHook } from "@testing-library/react";

// Mock next/navigation first
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
  usePathname: () => "/test",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

// Mock lib/navigation
vi.mock("~/lib/navigation", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/test",
  redirect: vi.fn(),
}));

// Mock dependencies
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    // Return proper capitalization for the "unknown" key
    if (key === "unknown") return "Unknown";
    return key;
  },
  useLocale: () => "en",
}));

vi.mock("@tanstack/react-table", () => ({
  createColumnHelper: () => ({
    accessor: (accessor: any, config: any) => ({ accessor, ...config }),
  }),
}));

// Mock components
vi.mock("~/components/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => <span>User: {userId}</span>,
}));

vi.mock("~/components/StatusDotDisplay", () => ({
  default: ({ name, color }: { name: string; color?: string }) => (
    <span>
      Status: {name} ({color})
    </span>
  ),
}));

vi.mock("~/components/TemplateNameDisplay", () => ({
  TemplateNameDisplay: ({ name }: { name: string }) => (
    <span>Template: {name}</span>
  ),
}));

vi.mock("~/components/WorkflowStateDisplay", () => ({
  WorkflowStateDisplay: ({ state }: { state: any }) => (
    <span>State: {state.name}</span>
  ),
}));

// Mock HelpPopover component
vi.mock("~/components/ui/help-popover", () => ({
  HelpPopover: ({ helpKey }: { helpKey: string }) => (
    <span>Help: {helpKey}</span>
  ),
}));

describe("useReportColumns", () => {
  const mockData = [
    {
      status: { id: 1, name: "Passed", color: "#10b981" },
      template: {
        id: 2,
        name: "Regression Tests",
        templateName: "Regression Tests",
      },
      project: { id: 3, name: "Test Project", title: "Test Project" },
      state: { id: 4, name: "Active", icon: "play", color: "#3b82f6" },
      configuration: { id: 5, name: "Chrome on Windows" },
      folder: { id: 6, name: "Integration Tests" },
      role: { id: 7, name: "QA Engineer" },
      milestone: { id: 8, name: "Release 2.0" },
      session: { id: 9, name: "Exploratory Session #1" },
      issueType: { id: 10, name: "Bug" },
      testRun: { id: 11, name: "Nightly Run #123" },
      testCase: { id: 12, name: "Login Test Case" },
      testResults: 100,
    },
  ];

  describe("Dimension Display", () => {
    it("should display status dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["status"], ["testResults"])
      );

      const columns = result.current;
      const statusColumn = columns.find((col: any) => col.id === "status");

      // Create a mock info object
      const mockInfo = {
        getValue: () => 1, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      // Render the cell
      const cellContent = statusColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Status: Passed (#10b981)")).toBeTruthy();
    });

    it("should display template dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["template"], ["testResults"])
      );

      const columns = result.current;
      const templateColumn = columns.find((col: any) => col.id === "template");

      const mockInfo = {
        getValue: () => 2, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = templateColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Template: Regression Tests")).toBeTruthy();
    });

    it("should display project dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["project"], ["testResults"])
      );

      const columns = result.current;
      const projectColumn = columns.find((col: any) => col.id === "project");

      const mockInfo = {
        getValue: () => 3, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = projectColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Test Project")).toBeTruthy();
    });

    it("should display state dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["state"], ["testResults"])
      );

      const columns = result.current;
      const stateColumn = columns.find((col: any) => col.id === "state");

      const mockInfo = {
        getValue: () => 4, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = stateColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("State: Active")).toBeTruthy();
    });

    it("should handle missing dimension data gracefully", () => {
      const { result } = renderHook(() =>
        useReportColumns(["status"], ["testResults"])
      );

      const columns = result.current;
      const statusColumn = columns.find((col: any) => col.id === "status");

      const mockInfo = {
        getValue: () => null,
        row: {
          original: { status: null, testResults: 0 },
        },
      };

      const cellContent = statusColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Status: labels.unknown ()")).toBeTruthy();
    });

    // Tests for dimensions that were showing IDs instead of names
    it("should display configuration dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["configuration"], ["testResults"])
      );

      const columns = result.current;
      const configColumn = columns.find(
        (col: any) => col.id === "configuration"
      );

      const mockInfo = {
        getValue: () => 5, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = configColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Chrome on Windows")).toBeTruthy();
    });

    it("should display folder dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["folder"], ["testResults"])
      );

      const columns = result.current;
      const folderColumn = columns.find((col: any) => col.id === "folder");

      const mockInfo = {
        getValue: () => 6, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = folderColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Integration Tests")).toBeTruthy();
    });

    it("should display role dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["role"], ["testResults"])
      );

      const columns = result.current;
      const roleColumn = columns.find((col: any) => col.id === "role");

      const mockInfo = {
        getValue: () => 7, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = roleColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("QA Engineer")).toBeTruthy();
    });

    it("should display milestone dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["milestone"], ["testResults"])
      );

      const columns = result.current;
      const milestoneColumn = columns.find(
        (col: any) => col.id === "milestone"
      );

      const mockInfo = {
        getValue: () => 8, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = milestoneColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Release 2.0")).toBeTruthy();
    });

    it("should display session dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["session"], ["testResults"])
      );

      const columns = result.current;
      const sessionColumn = columns.find((col: any) => col.id === "session");

      const mockInfo = {
        getValue: () => 9, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = sessionColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Exploratory Session #1")).toBeTruthy();
    });

    it("should display issueType dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["issueType"], ["testResults"])
      );

      const columns = result.current;
      const issueTypeColumn = columns.find(
        (col: any) => col.id === "issueType"
      );

      const mockInfo = {
        getValue: () => 10, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = issueTypeColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Bug")).toBeTruthy();
    });

    it("should display testRun dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["testRun"], ["testResults"])
      );

      const columns = result.current;
      const testRunColumn = columns.find((col: any) => col.id === "testRun");

      const mockInfo = {
        getValue: () => 11, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = testRunColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Nightly Run #123")).toBeTruthy();
    });

    it("should display testCase dimension correctly", () => {
      const { result } = renderHook(() =>
        useReportColumns(["testCase"], ["testResults"])
      );

      const columns = result.current;
      const testCaseColumn = columns.find((col: any) => col.id === "testCase");

      const mockInfo = {
        getValue: () => 12, // Accessor returns just the ID
        row: {
          original: mockData[0],
        },
      };

      const cellContent = testCaseColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("Login Test Case")).toBeTruthy();
    });

    it("should handle missing data for generic dimensions", () => {
      const { result } = renderHook(() =>
        useReportColumns(["configuration"], ["testResults"])
      );

      const columns = result.current;
      const configColumn = columns.find(
        (col: any) => col.id === "configuration"
      );

      const mockInfo = {
        getValue: () => 99, // Non-existent ID
        row: {
          original: { configuration: null, testResults: 0 },
        },
      };

      const cellContent = configColumn.cell(mockInfo);
      const { getByText } = render(cellContent);

      expect(getByText("access.none")).toBeTruthy();
    });
  });

  describe("Accessor Function", () => {
    it("should return ID for object dimensions to enable proper grouping", () => {
      const { result } = renderHook(() =>
        useReportColumns(
          ["status", "template", "configuration", "milestone"],
          ["testResults"]
        )
      );

      const columns = result.current;
      const statusColumn = columns.find((col: any) => col.id === "status");
      const templateColumn = columns.find((col: any) => col.id === "template");
      const configColumn = columns.find(
        (col: any) => col.id === "configuration"
      );
      const milestoneColumn = columns.find(
        (col: any) => col.id === "milestone"
      );

      // Test that accessor returns IDs for grouping
      expect(statusColumn.accessor(mockData[0])).toBe(1);
      expect(templateColumn.accessor(mockData[0])).toBe(2);
      expect(configColumn.accessor(mockData[0])).toBe(5);
      expect(milestoneColumn.accessor(mockData[0])).toBe(8);
    });

    it("should return ID for all dimension types that are objects", () => {
      const allObjectDimensions = [
        "status",
        "template",
        "project",
        "state",
        "configuration",
        "folder",
        "role",
        "milestone",
        "session",
        "issueType",
        "testRun",
        "testCase",
      ];

      const { result } = renderHook(() =>
        useReportColumns(allObjectDimensions, ["testResults"])
      );

      const columns = result.current;

      // Verify each dimension's accessor returns the ID
      allObjectDimensions.forEach((dimId) => {
        const column = columns.find((col: any) => col.id === dimId);
        const dimData = mockData[0][dimId as keyof (typeof mockData)[0]];

        if (dimData && typeof dimData === "object" && "id" in dimData) {
          expect(column.accessor(mockData[0])).toBe(dimData.id);
        }
      });
    });

    it("should handle primitive values in accessor", () => {
      const { result } = renderHook(() =>
        useReportColumns(["status"], ["testResults"])
      );

      const columns = result.current;
      const statusColumn = columns.find((col: any) => col.id === "status");

      // Test string value
      expect(statusColumn.accessor({ status: "passed" })).toBe("passed");

      // Test number value
      expect(statusColumn.accessor({ status: 123 })).toBe(123);
    });
  });

  describe("Critical Behavior: Accessor vs Cell Display", () => {
    it("should ensure accessor returns ID while cell displays name from row.original", () => {
      const dimensionsToTest = [
        "status",
        "template",
        "configuration",
        "milestone",
      ];

      const { result } = renderHook(() =>
        useReportColumns(dimensionsToTest, ["testResults"])
      );

      const columns = result.current;

      dimensionsToTest.forEach((dimId) => {
        const column = columns.find((col: any) => col.id === dimId);
        const mockRowData = mockData[0];

        // Accessor should return just the ID for grouping
        const accessorValue = column.accessor(mockRowData);
        expect(typeof accessorValue).toBe("number");

        // Cell should display the name from row.original
        const mockInfo = {
          getValue: () => accessorValue, // Returns just the ID
          row: {
            original: mockRowData, // Contains full object
          },
        };

        const cellContent = column.cell(mockInfo);
        const { container } = render(cellContent);
        const displayText = container.textContent;

        // Verify the display shows the name, not the ID
        const dimData = mockRowData[dimId as keyof typeof mockRowData];
        if (dimData && typeof dimData === "object" && "name" in dimData) {
          expect(displayText).toContain(dimData.name);
          expect(displayText).not.toBe(String(accessorValue));
        }
      });
    });

    it("should handle grouped rows correctly using original data", () => {
      const { result } = renderHook(() =>
        useReportColumns(["status"], ["testResults"])
      );

      const columns = result.current;
      const statusColumn = columns.find((col: any) => col.id === "status");

      // Mock grouped row with subRows
      const mockGroupedInfo = {
        row: {
          subRows: [
            {
              original: { status: { id: 1, name: "Passed", color: "#10b981" } },
              getValue: () => 1,
            },
            {
              original: { status: { id: 2, name: "Failed", color: "#ef4444" } },
              getValue: () => 2,
            },
          ],
        },
      };

      // The aggregatedCell should use original data, not getValue
      const aggregatedContent = statusColumn.aggregatedCell(mockGroupedInfo);
      expect(aggregatedContent).toBeTruthy();
    });
  });
});
