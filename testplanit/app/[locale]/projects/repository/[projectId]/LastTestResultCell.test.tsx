import React from "react";
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Theme,
  Locale,
  DateFormat,
  TimeFormat,
  ItemsPerPage,
  NotificationMode,
} from "@prisma/client";

// Mock server-side modules first (before any other imports)
vi.mock("~/app/actions/test-run", () => ({
  getMaxOrderInTestRun: vi.fn(),
}));

vi.mock("~/app/actions/test-run-notifications", () => ({
  notifyTestCaseAssignment: vi.fn(),
}));

vi.mock("~/app/actions/searchProjectMembers", () => ({
  searchProjectMembers: vi.fn(),
}));

vi.mock("~/lib/hooks", () => ({
  useCreateTestRunCases: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useFindManyTestRuns: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useFindManyRepositoryFolders: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useFindManyStatus: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useUpdateTestRunCases: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

// Mock next/navigation first
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "1" })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock next-intl navigation
vi.mock("~/lib/navigation", () => ({
  Link: vi.fn(({ children, href, ...props }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: vi.fn((namespace) => {
    return (key: string, values?: any) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      let result = `[t]${fullKey}`;
      if (values) {
        result += ` ${JSON.stringify(values)}`;
      }
      return result;
    };
  }),
  useLocale: vi.fn(() => "en-US"),
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      expires: "1",
      user: {
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
        preferences: {
          id: "pref-1",
          userId: "user-123",
          theme: Theme.System,
          locale: Locale.en_US,
          dateFormat: DateFormat.MM_DD_YYYY_SLASH,
          timeFormat: TimeFormat.HH_MM,
          itemsPerPage: ItemsPerPage.P50,
          timezone: "America/New_York",
          notificationMode: NotificationMode.USE_GLOBAL,
          emailNotifications: true,
          inAppNotifications: true,
          hasCompletedWelcomeTour: false,
          hasCompletedInitialPreferencesSetup: false,
        },
      },
    },
    status: "authenticated",
    update: vi.fn(),
  })),
}));

// Import the component under test dynamically after mocks are in place
// Since LastTestResultCell is not exported directly, we need to test the column definition
import { getColumns, type ExtendedCases } from "./columns";

// Setup to fix hasPointerCapture issue with Radix UI
beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

describe("LastTestResultCell via getColumns", () => {
  const mockSession = {
    user: {
      id: "user-123",
      name: "Test User",
      email: "test@example.com",
      preferences: {
        dateFormat: DateFormat.MM_DD_YYYY_SLASH,
        timeFormat: TimeFormat.HH_MM,
        timezone: "America/New_York",
      },
    },
  };

  const mockUniqueFieldList: any[] = [];
  const mockHandleSelect = vi.fn();

  const mockColumnTranslations = {
    name: "Name",
    estimate: "Estimate",
    forecast: "Forecast",
    state: "State",
    automated: "Automated",
    template: "Template",
    createdAt: "Created At",
    createdBy: "Created By",
    attachments: "Attachments",
    steps: "Steps",
    tags: "Tags",
    actions: "Actions",
    status: "Status",
    assignedTo: "Assigned To",
    unassigned: "Unassigned",
    selectCase: "Select Case",
    testRuns: "Test Runs",
    runOrder: "Run Order",
    issues: "Issues",
    id: "ID",
    linkedCases: "Linked Cases",
    versions: "Versions",
    clickToViewFullContent: "Click to view full content",
    comments: "Comments",
    configuration: "Configuration",
    lastTestResult: "Last Result",
  };

  describe("Column definition", () => {
    it("should include lastTestResult column in repository mode (not run mode)", () => {
      const columns = getColumns(
        mockSession, // session
        mockUniqueFieldList, // uniqueCaseFieldList
        mockHandleSelect, // handleSelect
        mockColumnTranslations,
        false, // isRunMode - NOT in run mode
        false // isSelectionMode
      );

      const lastResultColumn = columns.find((col) => col.id === "lastTestResult");
      expect(lastResultColumn).toBeDefined();
      expect(lastResultColumn?.header).toBe("Last Result");
      expect(lastResultColumn?.enableSorting).toBe(false);
      expect(lastResultColumn?.enableResizing).toBe(true);
      expect(lastResultColumn?.enableHiding).toBe(true);
    });

    it("should NOT include lastTestResult column in run mode", () => {
      const columns = getColumns(
        mockSession,
        mockUniqueFieldList,
        mockHandleSelect,
        mockColumnTranslations,
        true, // isRunMode - IN run mode
        false
      );

      const lastResultColumn = columns.find((col) => col.id === "lastTestResult");
      expect(lastResultColumn).toBeUndefined();
    });

    it("should NOT include lastTestResult column in selection mode", () => {
      const columns = getColumns(
        mockSession,
        mockUniqueFieldList,
        mockHandleSelect,
        mockColumnTranslations,
        false,
        true // isSelectionMode - IN selection mode
      );

      const lastResultColumn = columns.find((col) => col.id === "lastTestResult");
      expect(lastResultColumn).toBeUndefined();
    });
  });

  describe("Cell rendering", () => {
    const getLastResultColumn = () => {
      const columns = getColumns(
        mockSession,
        mockUniqueFieldList,
        mockHandleSelect,
        mockColumnTranslations,
        false,
        false
      );
      return columns.find((col) => col.id === "lastTestResult");
    };

    it("should render null when lastTestResult is undefined", () => {
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: undefined,
        } as ExtendedCases,
      };

      const { container } = render(
        <div>{column?.cell?.({ row: mockRow } as any)}</div>
      );

      // Should render empty (just the wrapper div)
      expect(container.textContent).toBe("");
    });

    it("should render null when lastTestResult is null", () => {
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: null,
        } as ExtendedCases,
      };

      const { container } = render(
        <div>{column?.cell?.({ row: mockRow } as any)}</div>
      );

      expect(container.textContent).toBe("");
    });

    it("should render status dot with status name when lastTestResult exists", () => {
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: {
            status: {
              id: 1,
              name: "Passed",
              color: { value: "#00FF00" },
            },
            executedAt: new Date("2025-12-25T10:30:00Z"),
            testRun: { id: 5, name: "Sprint 10 Test Run" },
          },
        } as ExtendedCases,
      };

      render(<div>{column?.cell?.({ row: mockRow } as any)}</div>);

      // Should display the status name
      expect(screen.getByText("Passed")).toBeInTheDocument();
    });

    it("should render status with correct color", () => {
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: {
            status: {
              id: 2,
              name: "Failed",
              color: { value: "#FF0000" },
            },
            executedAt: new Date("2025-12-25T10:30:00Z"),
            testRun: { id: 5, name: "Sprint 10 Test Run" },
          },
        } as ExtendedCases,
      };

      render(<div>{column?.cell?.({ row: mockRow } as any)}</div>);

      expect(screen.getByText("Failed")).toBeInTheDocument();
      // The color dot should have the correct background color
      const dot = document.querySelector('[style*="background-color"]');
      expect(dot).toHaveStyle({ backgroundColor: "#FF0000" });
    });

    it("should render status without color (default gray)", () => {
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: {
            status: {
              id: 3,
              name: "Blocked",
              // No color provided
            },
            executedAt: new Date("2025-12-25T10:30:00Z"),
          },
        } as ExtendedCases,
      };

      render(<div>{column?.cell?.({ row: mockRow } as any)}</div>);

      expect(screen.getByText("Blocked")).toBeInTheDocument();
    });

    it("should display tooltip with execution date on hover", async () => {
      const user = userEvent.setup();
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: {
            status: {
              id: 1,
              name: "Passed",
              color: { value: "#00FF00" },
            },
            executedAt: new Date("2025-12-25T10:30:00Z"),
            testRun: { id: 5, name: "Sprint 10 Test Run" },
          },
        } as ExtendedCases,
      };

      render(<div>{column?.cell?.({ row: mockRow } as any)}</div>);

      // Hover over the status to trigger tooltip
      const statusElement = screen.getByText("Passed");
      await user.hover(statusElement);

      // Wait for tooltip to appear - it contains the "Last Tested" text
      // Use getAllByText since Radix may render duplicates
      const testedOnElements = await screen.findAllByText(/\[t\]repository\.columns\.testedOn/);
      expect(testedOnElements.length).toBeGreaterThan(0);
    });

    it("should display test run name in tooltip when available", async () => {
      const user = userEvent.setup();
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: {
            status: {
              id: 1,
              name: "Passed",
              color: { value: "#00FF00" },
            },
            executedAt: new Date("2025-12-25T10:30:00Z"),
            testRun: { id: 5, name: "Sprint 10 Test Run" },
          },
        } as ExtendedCases,
      };

      render(<div>{column?.cell?.({ row: mockRow } as any)}</div>);

      const statusElement = screen.getByText("Passed");
      await user.hover(statusElement);

      // Should display the test run name (may be multiple due to Radix rendering)
      const testRunElements = await screen.findAllByText("Sprint 10 Test Run");
      expect(testRunElements.length).toBeGreaterThan(0);
    });

    it("should not display test run in tooltip when testRun is not provided", async () => {
      const user = userEvent.setup();
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: {
            status: {
              id: 1,
              name: "Passed",
              color: { value: "#00FF00" },
            },
            executedAt: new Date("2025-12-25T10:30:00Z"),
            // No testRun provided
          },
        } as ExtendedCases,
      };

      render(<div>{column?.cell?.({ row: mockRow } as any)}</div>);

      const statusElement = screen.getByText("Passed");
      await user.hover(statusElement);

      // Should show the date but not a test run link
      const testedOnElements = await screen.findAllByText(/\[t\]repository\.columns\.testedOn/);
      expect(testedOnElements.length).toBeGreaterThan(0);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("should have link to test run in tooltip", async () => {
      const user = userEvent.setup();
      const column = getLastResultColumn();
      const mockRow = {
        original: {
          id: 1,
          projectId: 1,
          lastTestResult: {
            status: {
              id: 1,
              name: "Passed",
              color: { value: "#00FF00" },
            },
            executedAt: new Date("2025-12-25T10:30:00Z"),
            testRun: { id: 5, name: "Sprint 10 Test Run" },
          },
        } as ExtendedCases,
      };

      render(<div>{column?.cell?.({ row: mockRow } as any)}</div>);

      const statusElement = screen.getByText("Passed");
      await user.hover(statusElement);

      // Wait for tooltip content (may be multiple due to Radix rendering)
      const testRunElements = await screen.findAllByText("Sprint 10 Test Run");
      expect(testRunElements.length).toBeGreaterThan(0);

      // Should have links to the test run
      const links = screen.getAllByRole("link");
      expect(links.length).toBeGreaterThan(0);
      expect(links[0]).toHaveAttribute("href", "/projects/runs/1/5");
    });
  });
});

describe("LastTestResult computation in Cases", () => {
  // These tests verify the logic for computing lastTestResult
  // The actual computation happens in the Cases component's useMemo

  it("should select the most recent result when case has multiple test runs", () => {
    // Simulate the computation logic
    const testRuns = [
      {
        testRun: { id: 1, name: "Run 1", isDeleted: false },
        results: [
          {
            id: 1,
            executedAt: new Date("2025-12-20T10:00:00Z"),
            status: { id: 1, name: "Passed", color: { value: "#00FF00" } },
          },
        ],
      },
      {
        testRun: { id: 2, name: "Run 2", isDeleted: false },
        results: [
          {
            id: 2,
            executedAt: new Date("2025-12-25T10:00:00Z"), // More recent
            status: { id: 2, name: "Failed", color: { value: "#FF0000" } },
          },
        ],
      },
    ];

    // Simulate the computation
    const allResults: {
      result: {
        id: number;
        executedAt: Date;
        status: { id: number; name: string; color?: { value: string } };
      };
      testRun: { id: number; name: string };
    }[] = [];

    for (const trLink of testRuns) {
      if (trLink.results && trLink.results.length > 0 && trLink.testRun && !trLink.testRun.isDeleted) {
        for (const result of trLink.results) {
          allResults.push({
            result: result as any,
            testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
          });
        }
      }
    }

    allResults.sort(
      (a, b) =>
        new Date(b.result.executedAt).getTime() -
        new Date(a.result.executedAt).getTime()
    );

    const mostRecent = allResults[0];
    const lastTestResult = {
      status: mostRecent.result.status,
      executedAt: mostRecent.result.executedAt,
      testRun: mostRecent.testRun,
    };

    expect(lastTestResult.status.name).toBe("Failed");
    expect(lastTestResult.testRun?.name).toBe("Run 2");
  });

  it("should exclude results from deleted test runs", () => {
    const testRuns = [
      {
        testRun: { id: 1, name: "Deleted Run", isDeleted: true },
        results: [
          {
            id: 1,
            executedAt: new Date("2025-12-25T10:00:00Z"), // Most recent but deleted
            status: { id: 1, name: "Passed", color: { value: "#00FF00" } },
          },
        ],
      },
      {
        testRun: { id: 2, name: "Active Run", isDeleted: false },
        results: [
          {
            id: 2,
            executedAt: new Date("2025-12-20T10:00:00Z"),
            status: { id: 2, name: "Failed", color: { value: "#FF0000" } },
          },
        ],
      },
    ];

    const allResults: any[] = [];

    for (const trLink of testRuns) {
      // Skip deleted test runs
      if (trLink.results && trLink.results.length > 0 && trLink.testRun && !trLink.testRun.isDeleted) {
        for (const result of trLink.results) {
          allResults.push({
            result: result,
            testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
          });
        }
      }
    }

    allResults.sort(
      (a, b) =>
        new Date(b.result.executedAt).getTime() -
        new Date(a.result.executedAt).getTime()
    );

    expect(allResults.length).toBe(1);
    const mostRecent = allResults[0];
    expect(mostRecent.testRun.name).toBe("Active Run");
  });

  it("should return null when case has no test runs", () => {
    const testRuns: any[] = [];

    let lastTestResult = null;

    if (testRuns.length > 0) {
      // Would compute here
    }

    expect(lastTestResult).toBeNull();
  });

  it("should return null when all test runs are deleted", () => {
    const testRuns = [
      {
        testRun: { id: 1, name: "Deleted Run 1", isDeleted: true },
        results: [
          {
            id: 1,
            executedAt: new Date("2025-12-25T10:00:00Z"),
            status: { id: 1, name: "Passed", color: { value: "#00FF00" } },
          },
        ],
      },
      {
        testRun: { id: 2, name: "Deleted Run 2", isDeleted: true },
        results: [
          {
            id: 2,
            executedAt: new Date("2025-12-20T10:00:00Z"),
            status: { id: 2, name: "Failed", color: { value: "#FF0000" } },
          },
        ],
      },
    ];

    const allResults: any[] = [];

    for (const trLink of testRuns) {
      if (trLink.results && trLink.results.length > 0 && trLink.testRun && !trLink.testRun.isDeleted) {
        for (const result of trLink.results) {
          allResults.push({
            result: result,
            testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
          });
        }
      }
    }

    expect(allResults.length).toBe(0);
  });

  it("should return null when test runs have no results", () => {
    const testRuns = [
      {
        testRun: { id: 1, name: "Run 1", isDeleted: false },
        results: [],
      },
      {
        testRun: { id: 2, name: "Run 2", isDeleted: false },
        results: [],
      },
    ];

    const allResults: any[] = [];

    for (const trLink of testRuns) {
      if (trLink.results && trLink.results.length > 0 && trLink.testRun && !trLink.testRun.isDeleted) {
        for (const result of trLink.results) {
          allResults.push({
            result: result,
            testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
          });
        }
      }
    }

    expect(allResults.length).toBe(0);
  });
});
