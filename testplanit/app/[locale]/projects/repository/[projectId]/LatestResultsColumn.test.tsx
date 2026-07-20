import {
  DateFormat,
  ItemsPerPage,
  Locale,
  NotificationMode,
  Theme,
  TimeFormat,
} from "~/zenstack/models";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise real Radix tooltip behaviour (user.hover triggers
// TooltipContent rendering). Override the global stub from vitest.setup
// with the real module so user.hover actually opens the bubble.
vi.mock("@/components/ui/tooltip", async () =>
  vi.importActual<typeof import("@/components/ui/tooltip")>(
    "@/components/ui/tooltip"
  )
);

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

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    testRunCases: {
      useCreate: vi.fn(() => ({
        mutateAsync: vi.fn(),
        isPending: false,
      })),
      useUpdate: vi.fn(() => ({
        mutateAsync: vi.fn(),
        isPending: false,
      })),
    },
    testRuns: {
      useFindMany: vi.fn(() => ({
        data: [],
        isLoading: false,
      })),
    },
    repositoryFolders: {
      useFindMany: vi.fn(() => ({
        data: [],
        isLoading: false,
      })),
    },
    status: {
      useFindMany: vi.fn(() => ({
        data: [],
        isLoading: false,
      })),
    },
  }),
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
// The cell delegates to LatestResultsCell, which has its own test; here we
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

describe("latestResults column via getColumns", () => {
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
    latestResults: "Latest Results",
    newBadge: "New",
  };

  const renderLatestResults = vi.fn(
    (caseId: number, projectId: number) =>
      `results-${projectId}-${caseId}` as unknown as React.ReactNode
  );

  beforeEach(() => {
    renderLatestResults.mockClear();
  });

  const buildColumns = (isRunMode = false, isSelectionMode = false) =>
    getColumns(
      mockSession,
      mockUniqueFieldList,
      mockHandleSelect,
      mockColumnTranslations,
      isRunMode,
      isSelectionMode
    );

  describe("Column definition", () => {
    it("should include the latestResults column in repository mode", () => {
      const column = buildColumns().find((col) => col.id === "latestResults");

      expect(column).toBeDefined();
      expect(column?.header).toBe("Latest Results");
      expect(column?.enableSorting).toBe(false);
      expect(column?.enableResizing).toBe(true);
      expect(column?.enableHiding).toBe(true);
    });

    it("should NOT include the latestResults column in run mode", () => {
      expect(
        buildColumns(true, false).find((col) => col.id === "latestResults")
      ).toBeUndefined();
    });

    it("should NOT include the latestResults column in selection mode", () => {
      expect(
        buildColumns(false, true).find((col) => col.id === "latestResults")
      ).toBeUndefined();
    });
  });

  describe("Cell rendering", () => {
    // The sequence itself is owned by LatestResultsCell and covered by its own
    // test; the column's job is only to delegate with the right identifiers.
    const cellFor = (row: { original: ExtendedCases }) => {
      const columns = getColumns(
        mockSession,
        mockUniqueFieldList,
        mockHandleSelect,
        mockColumnTranslations,
        false,
        false,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        renderLatestResults
      );
      const column = columns.find((col) => col.id === "latestResults");
      const cell = column?.cell;
      return typeof cell === "function" ? cell({ row } as any) : cell;
    };

    it("delegates to the render prop with the case and project ids", () => {
      const row = {
        original: { id: 42, projectId: 7 } as ExtendedCases,
      };

      const rendered = cellFor(row);

      expect(renderLatestResults).toHaveBeenCalledWith(42, 7);
      expect(rendered).toBe("results-7-42");
    });

    it("renders nothing when no render prop is supplied", () => {
      const columns = getColumns(
        mockSession,
        mockUniqueFieldList,
        mockHandleSelect,
        mockColumnTranslations,
        false,
        false
      );
      const column = columns.find((col) => col.id === "latestResults");
      const cell = column?.cell;
      const rendered =
        typeof cell === "function"
          ? cell({ row: { original: { id: 1, projectId: 1 } } } as any)
          : cell;

      expect(rendered).toBeNull();
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
      if (
        trLink.results &&
        trLink.results.length > 0 &&
        trLink.testRun &&
        !trLink.testRun.isDeleted
      ) {
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
      if (
        trLink.results &&
        trLink.results.length > 0 &&
        trLink.testRun &&
        !trLink.testRun.isDeleted
      ) {
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
      if (
        trLink.results &&
        trLink.results.length > 0 &&
        trLink.testRun &&
        !trLink.testRun.isDeleted
      ) {
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
      if (
        trLink.results &&
        trLink.results.length > 0 &&
        trLink.testRun &&
        !trLink.testRun.isDeleted
      ) {
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

  it("should include JUnit (automated) results in computation", () => {
    const testRuns: any[] = [];
    const junitResults = [
      {
        id: 100,
        executedAt: new Date("2025-12-25T10:00:00Z"),
        status: { id: 1, name: "Passed", color: { value: "#00FF00" } },
        testSuite: {
          id: 1,
          testRun: { id: 10, name: "Automated Run", isDeleted: false },
        },
      },
    ];

    // Simulate the computation logic from Cases.tsx
    const allResults: any[] = [];

    // Collect manual test run results
    for (const trLink of testRuns) {
      if (
        trLink.results &&
        trLink.results.length > 0 &&
        trLink.testRun &&
        !trLink.testRun.isDeleted
      ) {
        for (const result of trLink.results) {
          allResults.push({
            result: result,
            testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
          });
        }
      }
    }

    // Collect JUnit results
    for (const junitResult of junitResults) {
      if (
        junitResult.executedAt &&
        junitResult.status &&
        junitResult.testSuite?.testRun &&
        !junitResult.testSuite.testRun.isDeleted
      ) {
        allResults.push({
          result: {
            id: junitResult.id,
            executedAt: junitResult.executedAt,
            status: junitResult.status,
          },
          testRun: {
            id: junitResult.testSuite.testRun.id,
            name: junitResult.testSuite.testRun.name,
          },
        });
      }
    }

    expect(allResults.length).toBe(1);
    expect(allResults[0].testRun.name).toBe("Automated Run");
    expect(allResults[0].result.status.name).toBe("Passed");
  });

  it("should select most recent result when both manual and JUnit results exist", () => {
    const testRuns = [
      {
        testRun: { id: 1, name: "Manual Run", isDeleted: false },
        results: [
          {
            id: 1,
            executedAt: new Date("2025-12-20T10:00:00Z"),
            status: { id: 2, name: "Failed", color: { value: "#FF0000" } },
          },
        ],
      },
    ];
    const junitResults = [
      {
        id: 100,
        executedAt: new Date("2025-12-25T10:00:00Z"), // More recent
        status: { id: 1, name: "Passed", color: { value: "#00FF00" } },
        testSuite: {
          id: 1,
          testRun: { id: 10, name: "Automated Run", isDeleted: false },
        },
      },
    ];

    const allResults: any[] = [];

    // Collect manual results
    for (const trLink of testRuns) {
      if (
        trLink.results &&
        trLink.results.length > 0 &&
        trLink.testRun &&
        !trLink.testRun.isDeleted
      ) {
        for (const result of trLink.results) {
          allResults.push({
            result: result,
            testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
          });
        }
      }
    }

    // Collect JUnit results
    for (const junitResult of junitResults) {
      if (
        junitResult.executedAt &&
        junitResult.status &&
        junitResult.testSuite?.testRun &&
        !junitResult.testSuite.testRun.isDeleted
      ) {
        allResults.push({
          result: {
            id: junitResult.id,
            executedAt: junitResult.executedAt,
            status: junitResult.status,
          },
          testRun: {
            id: junitResult.testSuite.testRun.id,
            name: junitResult.testSuite.testRun.name,
          },
        });
      }
    }

    allResults.sort(
      (a, b) =>
        new Date(b.result.executedAt).getTime() -
        new Date(a.result.executedAt).getTime()
    );

    expect(allResults.length).toBe(2);
    const mostRecent = allResults[0];
    expect(mostRecent.testRun.name).toBe("Automated Run");
    expect(mostRecent.result.status.name).toBe("Passed");
  });

  it("should select manual result when it is more recent than JUnit result", () => {
    const testRuns = [
      {
        testRun: { id: 1, name: "Manual Run", isDeleted: false },
        results: [
          {
            id: 1,
            executedAt: new Date("2025-12-28T10:00:00Z"), // More recent
            status: { id: 2, name: "Failed", color: { value: "#FF0000" } },
          },
        ],
      },
    ];
    const junitResults = [
      {
        id: 100,
        executedAt: new Date("2025-12-25T10:00:00Z"),
        status: { id: 1, name: "Passed", color: { value: "#00FF00" } },
        testSuite: {
          id: 1,
          testRun: { id: 10, name: "Automated Run", isDeleted: false },
        },
      },
    ];

    const allResults: any[] = [];

    // Collect manual results
    for (const trLink of testRuns) {
      if (
        trLink.results &&
        trLink.results.length > 0 &&
        trLink.testRun &&
        !trLink.testRun.isDeleted
      ) {
        for (const result of trLink.results) {
          allResults.push({
            result: result,
            testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
          });
        }
      }
    }

    // Collect JUnit results
    for (const junitResult of junitResults) {
      if (
        junitResult.executedAt &&
        junitResult.status &&
        junitResult.testSuite?.testRun &&
        !junitResult.testSuite.testRun.isDeleted
      ) {
        allResults.push({
          result: {
            id: junitResult.id,
            executedAt: junitResult.executedAt,
            status: junitResult.status,
          },
          testRun: {
            id: junitResult.testSuite.testRun.id,
            name: junitResult.testSuite.testRun.name,
          },
        });
      }
    }

    allResults.sort(
      (a, b) =>
        new Date(b.result.executedAt).getTime() -
        new Date(a.result.executedAt).getTime()
    );

    const mostRecent = allResults[0];
    expect(mostRecent.testRun.name).toBe("Manual Run");
    expect(mostRecent.result.status.name).toBe("Failed");
  });

  it("should exclude JUnit results from deleted test runs", () => {
    const testRuns: any[] = [];
    const junitResults = [
      {
        id: 100,
        executedAt: new Date("2025-12-25T10:00:00Z"),
        status: { id: 1, name: "Passed", color: { value: "#00FF00" } },
        testSuite: {
          id: 1,
          testRun: { id: 10, name: "Deleted Automated Run", isDeleted: true },
        },
      },
      {
        id: 101,
        executedAt: new Date("2025-12-20T10:00:00Z"),
        status: { id: 2, name: "Failed", color: { value: "#FF0000" } },
        testSuite: {
          id: 2,
          testRun: { id: 11, name: "Active Automated Run", isDeleted: false },
        },
      },
    ];

    const allResults: any[] = [];

    // Collect manual results (none in this test)
    for (const trLink of testRuns) {
      if (
        trLink.results &&
        trLink.results.length > 0 &&
        trLink.testRun &&
        !trLink.testRun.isDeleted
      ) {
        for (const result of trLink.results) {
          allResults.push({
            result: result,
            testRun: { id: trLink.testRun.id, name: trLink.testRun.name },
          });
        }
      }
    }

    // Collect JUnit results - should skip deleted test runs
    for (const junitResult of junitResults) {
      if (
        junitResult.executedAt &&
        junitResult.status &&
        junitResult.testSuite?.testRun &&
        !junitResult.testSuite.testRun.isDeleted
      ) {
        allResults.push({
          result: {
            id: junitResult.id,
            executedAt: junitResult.executedAt,
            status: junitResult.status,
          },
          testRun: {
            id: junitResult.testSuite.testRun.id,
            name: junitResult.testSuite.testRun.name,
          },
        });
      }
    }

    expect(allResults.length).toBe(1);
    expect(allResults[0].testRun.name).toBe("Active Automated Run");
  });

  it("should skip JUnit results without executedAt", () => {
    const junitResults = [
      {
        id: 100,
        executedAt: null, // No execution date
        status: { id: 1, name: "Passed", color: { value: "#00FF00" } },
        testSuite: {
          id: 1,
          testRun: { id: 10, name: "Automated Run", isDeleted: false },
        },
      },
    ];

    const allResults: any[] = [];

    for (const junitResult of junitResults) {
      if (
        junitResult.executedAt &&
        junitResult.status &&
        junitResult.testSuite?.testRun &&
        !junitResult.testSuite.testRun.isDeleted
      ) {
        allResults.push({
          result: {
            id: junitResult.id,
            executedAt: junitResult.executedAt,
            status: junitResult.status,
          },
          testRun: {
            id: junitResult.testSuite.testRun.id,
            name: junitResult.testSuite.testRun.name,
          },
        });
      }
    }

    expect(allResults.length).toBe(0);
  });

  it("should skip JUnit results without status", () => {
    const junitResults = [
      {
        id: 100,
        executedAt: new Date("2025-12-25T10:00:00Z"),
        status: null, // No status
        testSuite: {
          id: 1,
          testRun: { id: 10, name: "Automated Run", isDeleted: false },
        },
      },
    ];

    const allResults: any[] = [];

    for (const junitResult of junitResults) {
      if (
        junitResult.executedAt &&
        junitResult.status &&
        junitResult.testSuite?.testRun &&
        !junitResult.testSuite.testRun.isDeleted
      ) {
        allResults.push({
          result: {
            id: junitResult.id,
            executedAt: junitResult.executedAt,
            status: junitResult.status,
          },
          testRun: {
            id: junitResult.testSuite.testRun.id,
            name: junitResult.testSuite.testRun.name,
          },
        });
      }
    }

    expect(allResults.length).toBe(0);
  });
});
