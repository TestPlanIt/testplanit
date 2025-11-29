import React from "react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import { SessionResultsSummary } from "./SessionResultsSummary";
import {
  Theme,
  Locale,
  DateFormat,
  TimeFormat,
  ItemsPerPage,
  NotificationMode,
} from "@prisma/client";
import { Session } from "next-auth";
import * as NextAuth from "next-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- Mocking Dependencies ---

// Mock Session
const mockSession: Session = {
  expires: "1",
  user: {
    id: "user-123",
    name: "Test User",
    email: "test@example.com",
    image: "",
    access: "USER",
    preferences: {
      id: "pref-1",
      userId: "user-123",
      theme: Theme.System,
      locale: Locale.en_US,
      dateFormat: DateFormat.MM_DD_YYYY_SLASH,
      timeFormat: TimeFormat.HH_MM,
      itemsPerPage: ItemsPerPage.P50,
      timezone: "UTC",
      notificationMode: NotificationMode.USE_GLOBAL,
      emailNotifications: true,
      inAppNotifications: true,
      hasCompletedWelcomeTour: false,
      hasCompletedInitialPreferencesSetup: false,
    },
  },
};

// Helper function to create a test query client
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

// Helper function to render with QueryClient
function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

// Mock Hooks
vi.mock("~/lib/hooks", () => ({
  useFindManySessionResults: vi.fn(),
  useFindFirstStatus: vi.fn(),
}));

// Import the mocked hooks AFTER vi.mock
import { useFindManySessionResults, useFindFirstStatus } from "~/lib/hooks";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "project-123" })),
}));

// Mock ~/lib/navigation (for Link)
vi.mock("~/lib/navigation", () => ({
  Link: vi.fn(({ children, href, ...props }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )),
}));

// Mock UI Components
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip">{children}</div> // Add testid
  ),
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div> // Add testid
  ),
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-provider">{children}</div> // Add testid
  ),
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-trigger">{children}</div> // Add testid
  ),
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: (props: any) => <div data-testid="skeleton" {...props} />,
}));
vi.mock("@/components/DateFormatter", () => ({
  DateFormatter: ({
    date,
    formatString,
  }: {
    date: any;
    formatString?: string;
  }) => (
    <span data-testid="date-formatter">{`${new Date(date).toISOString()} (format: ${formatString})`}</span>
  ),
}));
vi.mock("./ElapsedTime", () => ({
  // Destructure props to only apply valid ones to the div
  ElapsedTime: ({
    sessionId,
    className,
    textSize,
    estimate,
    ...restProps
  }: any) => (
    <div
      data-testid="elapsed-time"
      className={className} // Apply className explicitly
      data-estimate={estimate} // Use data-estimate attribute
      {...restProps} // Spread only *other* valid HTML attributes
    >
      {/* Display relevant info for testing */}
      {`ElapsedTime Mock (sessionId: ${sessionId}, textSize: ${textSize})`}
    </div>
  ),
}));

// Mock utility functions
vi.mock("~/utils/duration", () => ({
  toHumanReadable: vi.fn((ms: number) => `${ms / 1000}s human-readable`),
}));

// --- Test Setup ---
beforeEach(() => {
  // Reset mocks using the IMPORTED functions, cast to Mock<any>
  (useFindManySessionResults as Mock<any>)
    .mockClear()
    .mockReturnValue({ data: [], isLoading: false });
  (useFindFirstStatus as Mock<any>).mockClear().mockReturnValue({
    data: {
      id: 1,
      name: "Untested",
      order: 1,
      isDeleted: false,
      color: { id: 1, name: "Grey", value: "#808080" },
    },
    isLoading: false,
  });

  // Mock useSession return value
  vi.spyOn(NextAuth, "useSession").mockReturnValue({
    data: mockSession,
    status: "authenticated",
    update: vi.fn(),
  });

  // Mock global fetch for API calls
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [],
          sessionIssues: [],
          resultIssues: [],
          estimate: null,
        }),
    })
  ) as any;
});

// --- Tests ---
describe("SessionResultsSummary", () => {
  it("should render loading state", async () => {
    // Override fetch to simulate loading state
    global.fetch = vi.fn(() => new Promise(() => {})) as any;

    renderWithQueryClient(<SessionResultsSummary sessionId={1} />);

    // Expect skeleton components to be rendered
    const skeletons = screen.getAllByTestId("skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should render "No results" state correctly', async () => {
    // Default mocks in beforeEach already set data: []
    const firstStatus = {
      id: 1,
      name: "Untested",
      order: 1,
      isDeleted: false,
      color: { id: 1, name: "Grey", value: "#808080" },
    };
    (useFindFirstStatus as Mock<any>).mockReturnValue({
      data: firstStatus,
      isLoading: false,
    });

    // Mock fetch to return empty results
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [],
            sessionIssues: [],
            resultIssues: [],
            estimate: null,
          }),
      })
    ) as any;

    renderWithQueryClient(<SessionResultsSummary sessionId={1} />);

    // Wait for the query to resolve
    await screen.findByRole("link", {
      name: /View session details/i,
    });

    // Check for the default status bar link
    const statusBarLink = screen.getByRole("link", {
      name: /View session details/i, // Use the correct aria-label
    });
    expect(statusBarLink).toBeInTheDocument();
    expect(statusBarLink).toHaveAttribute(
      "href",
      `/projects/sessions/project-123/1`
    );
    expect(statusBarLink).toHaveStyle({
      backgroundColor: firstStatus.color.value,
    });

    // Check for the "No results yet" message below the bar
    // Target the span directly, then find the container
    const messageSpan = screen.getByText("No results yet", {
      selector: "span",
    });
    const messageContainer = messageSpan.closest("div");
    expect(messageContainer).toBeInTheDocument();
    expect(messageContainer!.querySelector("svg")).toBeInTheDocument(); // Check for Timer icon
    expect(messageSpan).toBeInTheDocument(); // Verify the span itself

    // Ensure ElapsedTime component is NOT rendered
    expect(screen.queryByTestId("elapsed-time")).not.toBeInTheDocument();
  });

  it("should render correctly with results that have elapsed time", async () => {
    const mockResultsData = [
      {
        id: 101,
        sessionId: 1,
        statusId: 2,
        createdAt: new Date("2023-11-01T10:00:00Z"),
        elapsed: 60, // 1 minute
        status: {
          id: 2,
          name: "Passed",
          color: { value: "#22C55E" }, // green
        },
        session: { estimate: 300 }, // 5 min estimate
      },
      {
        id: 102,
        sessionId: 1,
        statusId: 3,
        createdAt: new Date("2023-11-01T10:01:00Z"),
        elapsed: 120, // 2 minutes
        status: {
          id: 3,
          name: "Failed",
          color: { value: "#EF4444" }, // red
        },
        session: { estimate: 300 },
      },
      {
        id: 103,
        sessionId: 1,
        statusId: 4,
        createdAt: new Date("2023-11-01T10:03:00Z"),
        elapsed: 0, // 0 elapsed time, should get minimum width
        status: {
          id: 4,
          name: "Skipped",
          color: { value: "#6B7280" }, // gray
        },
        session: { estimate: 300 },
      },
    ];

    // Mock fetch to return results with elapsed time
    // Calculate total elapsed: 60 + 120 + 0 = 180
    const totalElapsed = mockResultsData.reduce(
      (sum, r) => sum + (r.elapsed || 0),
      0
    );

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: mockResultsData.map((r) => ({
              id: r.id,
              elapsed: r.elapsed,
              statusColorValue: r.status.color.value,
              statusName: r.status.name,
              createdAt: r.createdAt.toISOString(),
              issueIds: [],
            })),
            sessionIssues: [],
            resultIssues: [],
            estimate: 300,
            totalElapsed,
          }),
      })
    ) as any;

    renderWithQueryClient(<SessionResultsSummary sessionId={1} />);

    // Wait for the data to load
    await screen.findByTestId("elapsed-time");

    // 1. Check Status Bar segments for proportional width
    const statusBarContainer =
      screen.getByTestId("tooltip-provider").firstElementChild;
    expect(statusBarContainer).toHaveClass("flex"); // Check it's the flex container

    const segments = statusBarContainer!.querySelectorAll(
      'a[style*="background-color"]'
    );
    expect(segments).toHaveLength(3); // Passed, Failed, Skipped

    // Total elapsed = 60 + 120 + 0 = 180
    const expectedWidthPassed = `${Math.max(5, (60 / 180) * 100)}%`; // ~33.3%, >= 5%
    const expectedWidthFailed = `${Math.max(5, (120 / 180) * 100)}%`; // ~66.7%, >= 5%
    const expectedWidthSkipped = "5%"; // Min width for 0 elapsed

    // Find segments by href attribute
    let passedSegment: Element | null = null;
    let failedSegment: Element | null = null;
    let skippedSegment: Element | null = null;
    segments.forEach((s) => {
      const href = s.getAttribute("href");
      if (href?.includes("#result-101")) passedSegment = s;
      else if (href?.includes("#result-102")) failedSegment = s;
      else if (href?.includes("#result-103")) skippedSegment = s;
    });

    expect(passedSegment).not.toBeNull();
    expect(failedSegment).not.toBeNull();
    expect(skippedSegment).not.toBeNull();

    // Check widths and styles now that we have the correct segments
    expect(passedSegment).toHaveStyle({
      width: expectedWidthPassed,
      backgroundColor: "#22C55E",
    });
    expect(failedSegment).toHaveStyle({
      width: expectedWidthFailed,
      backgroundColor: "#EF4444",
    });
    expect(skippedSegment).toHaveStyle({
      width: expectedWidthSkipped,
      backgroundColor: "#6B7280",
    });

    // Check hrefs again for sanity
    expect(passedSegment!.getAttribute("href")).toContain("#result-101");

    // 2. Check that ElapsedTime component IS rendered
    const elapsedTimeMock = screen.getByTestId("elapsed-time");
    expect(elapsedTimeMock).toBeInTheDocument();
    // Assert the correct text based on the mock's output and the default textSize="xs"
    expect(elapsedTimeMock).toHaveTextContent(
      "ElapsedTime Mock (sessionId: 1, textSize: xs)"
    );
    // Check data-estimate attribute passed to mock
    expect(elapsedTimeMock).toHaveAttribute("data-estimate", "300");

    // 3. Check that the "no elapsed time" message is NOT rendered
    expect(
      screen.queryByText("Results recorded, but no time elapsed")
    ).not.toBeInTheDocument();
  });

  it("should render correctly with results that have NO elapsed time", async () => {
    const mockResultsNoTime = [
      {
        id: 201,
        sessionId: 1,
        statusId: 2,
        createdAt: new Date("2023-11-02T10:00:00Z"),
        elapsed: null, // No time
        status: {
          id: 2,
          name: "Passed",
          color: { value: "#22C55E" },
        },
        session: { estimate: null }, // No estimate
      },
      {
        id: 202,
        sessionId: 1,
        statusId: 3,
        createdAt: new Date("2023-11-02T10:01:00Z"),
        elapsed: 0, // No time
        status: {
          id: 3,
          name: "Failed",
          color: { value: "#EF4444" },
        },
        session: { estimate: null },
      },
    ];

    // Mock fetch to return results with no elapsed time
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: mockResultsNoTime.map((r) => ({
              id: r.id,
              elapsed: r.elapsed,
              statusColorValue: r.status.color.value,
              statusName: r.status.name,
              createdAt: r.createdAt.toISOString(),
              issueIds: [],
            })),
            sessionIssues: [],
            resultIssues: [],
            estimate: null,
            totalElapsed: 0,
          }),
      })
    ) as any;

    renderWithQueryClient(<SessionResultsSummary sessionId={1} />);

    // Wait for the data to load
    await screen.findByText("Results recorded, but no time elapsed");

    // 1. Check Status Bar segments for equal width
    const statusBarContainer =
      screen.getByTestId("tooltip-provider").firstElementChild;
    expect(statusBarContainer).toHaveClass("flex");

    const segments = statusBarContainer!.querySelectorAll(
      'a[style*="background-color"]'
    );
    expect(segments).toHaveLength(2); // Passed, Failed

    // Check for equal width (approximately 50%)
    const expectedWidth = `${100 / segments.length}%`; // 50%
    segments.forEach((segment) => {
      expect(segment).toHaveStyle({ width: expectedWidth });
    });

    // 2. Check that ElapsedTime component is NOT rendered
    expect(screen.queryByTestId("elapsed-time")).not.toBeInTheDocument();

    // 3. Check that the specific message for no elapsed time IS rendered
    expect(
      screen.getByText("Results recorded, but no time elapsed")
    ).toBeInTheDocument();
  });

  // More tests will go here...
});
