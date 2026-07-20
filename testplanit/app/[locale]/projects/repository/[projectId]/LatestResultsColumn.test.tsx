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
      expect(column?.enableSorting).toBe(true);
      expect(column?.enableResizing).toBe(true);
      expect(column?.enableHiding).toBe(true);
    });

    it("should not offer sorting once the run is completed", () => {
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
        true // isCompleted
      );
      const column = columns.find((col) => col.id === "latestResults");

      expect(column?.enableSorting).toBe(false);
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
