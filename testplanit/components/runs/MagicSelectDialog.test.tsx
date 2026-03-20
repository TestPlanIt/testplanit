import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: any) => {
    if (opts && typeof opts === "object") {
      // Simple interpolation for tests
      const values = Object.entries(opts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `${key}(${values})`;
    }
    return key;
  },
}));

vi.mock("@/components/LoadingSpinner", () => ({
  default: ({ className }: { className?: string }) => (
    <div data-testid="loading-spinner" className={className} />
  ),
}));

vi.mock("@/components/SelectedTestCasesDrawer", () => ({
  SelectedTestCasesDrawer: ({
    trigger,
    selectedTestCases,
  }: {
    trigger: React.ReactNode;
    selectedTestCases: number[];
  }) => (
    <div data-testid="selected-cases-drawer">
      <span data-testid="drawer-count">{selectedTestCases.length}</span>
      {trigger}
    </div>
  ),
}));

// --- Helpers ---

function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

// --- Import Component Under Test ---
import { MagicSelectDialog } from "./MagicSelectDialog";

// --- Fixtures ---

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: 1,
  testRunMetadata: {
    name: "Sprint 1 Run",
    description: "Sprint regression tests",
    docs: null,
    linkedIssueIds: [],
    tags: [],
  },
  currentSelection: [],
  onAccept: vi.fn(),
};

// --- Mock fetch helper ---

function mockFetchCount(overrides: Record<string, any> = {}) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      totalCaseCount: 25,
      repositoryTotalCount: 30,
      searchPreFiltered: false,
      hitMaxSearchResults: false,
      noSearchMatches: false,
      ...overrides,
    }),
  } as any);
}

function _mockFetchSelectSuccess(overrides: Record<string, any> = {}) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      suggestedCaseIds: [1, 2, 3],
      reasoning: "These tests cover the login flow",
      metadata: {
        totalCasesAnalyzed: 25,
        suggestedCount: 3,
        directlySelected: 2,
        linkedCasesAdded: 1,
        model: "gpt-4o",
        tokens: { prompt: 1000, completion: 200, total: 1200 },
      },
      ...overrides,
    }),
  } as any);
}

function mockFetchError(message = "Server error") {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: message }),
  } as any);
}

// --- Test Setup ---

beforeEach(() => {
  vi.clearAllMocks();
  // Default: prevent any accidental real fetch
  global.fetch = vi.fn().mockRejectedValue(new Error("fetch not mocked"));
});

// --- Tests ---

describe("MagicSelectDialog", () => {
  it("auto-fetches count when dialog opens and transitions to configuring state", async () => {
    mockFetchCount();

    renderWithQueryClient(<MagicSelectDialog {...defaultProps} />);

    // Initially shows counting spinner
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();

    // After fetch resolves, transitions to configuring state
    await waitFor(() => {
      expect(screen.getByText("configure.title")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument();
  });

  it("shows loading spinner during counting state", () => {
    // Fetch never resolves — stays in counting
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    renderWithQueryClient(<MagicSelectDialog {...defaultProps} />);

    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    expect(screen.getByText("counting")).toBeInTheDocument();
  });

  it("shows configuring state with clarification textarea after count", async () => {
    mockFetchCount();

    renderWithQueryClient(<MagicSelectDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByLabelText("clarification.label")).toBeInTheDocument();
    });

    // Analyze button should be present
    expect(
      screen.getByRole("button", { name: /actions\.start/i })
    ).toBeInTheDocument();
  });

  it("transitions to loading state when analyze is clicked", async () => {
    const user = userEvent.setup();

    // First call: count, second call: select (never resolves)
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalCaseCount: 10,
          repositoryTotalCount: 10,
          searchPreFiltered: false,
          hitMaxSearchResults: false,
          noSearchMatches: false,
        }),
      })
      .mockReturnValueOnce(new Promise(() => {})); // Select never resolves

    renderWithQueryClient(<MagicSelectDialog {...defaultProps} />);

    // Wait for configuring state
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions\.start/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /actions\.start/i }));

    // Should show loading
    await waitFor(() => {
      expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
      expect(screen.getByText("loading.analyzing")).toBeInTheDocument();
    });
  });

  it("renders success state with reasoning, case count badge, and accept button", async () => {
    const user = userEvent.setup();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalCaseCount: 10,
          repositoryTotalCount: 10,
          searchPreFiltered: false,
          hitMaxSearchResults: false,
          noSearchMatches: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestedCaseIds: [1, 2, 3],
          reasoning: "These tests cover the login flow",
          metadata: {
            totalCasesAnalyzed: 10,
            suggestedCount: 3,
            directlySelected: 3,
            linkedCasesAdded: 0,
            model: "gpt-4o",
            tokens: { prompt: 500, completion: 100, total: 600 },
          },
        }),
      });

    renderWithQueryClient(<MagicSelectDialog {...defaultProps} />);

    // Wait for configuring state
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions\.start/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /actions\.start/i }));

    // Wait for success state
    await waitFor(() => {
      expect(screen.getByText("success.title")).toBeInTheDocument();
    });

    // Reasoning text appears
    expect(
      screen.getByText("These tests cover the login flow")
    ).toBeInTheDocument();

    // Accept button
    expect(
      screen.getByRole("button", { name: /actions\.accept/i })
    ).toBeInTheDocument();

    // Token usage metadata
    expect(screen.getByText(/tokenUsage/)).toBeInTheDocument();
  });

  it("renders error state with error message and retry button", async () => {
    mockFetchError("LLM service unavailable");

    renderWithQueryClient(<MagicSelectDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText("errors.title")).toBeInTheDocument();
    });

    expect(screen.getByText("LLM service unavailable")).toBeInTheDocument();

    // Retry button in footer
    expect(
      screen.getByRole("button", { name: /search\.errors\.tryAgain/i })
    ).toBeInTheDocument();
  });

  it("calls onAccept with suggestedCaseIds when accept button clicked", async () => {
    const onAccept = vi.fn();
    const user = userEvent.setup();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalCaseCount: 10,
          repositoryTotalCount: 10,
          searchPreFiltered: false,
          hitMaxSearchResults: false,
          noSearchMatches: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestedCaseIds: [7, 8, 9],
          reasoning: "Selected for login coverage",
          metadata: {
            totalCasesAnalyzed: 10,
            suggestedCount: 3,
            directlySelected: 3,
            linkedCasesAdded: 0,
            model: "gpt-4o",
            tokens: { prompt: 400, completion: 80, total: 480 },
          },
        }),
      });

    renderWithQueryClient(
      <MagicSelectDialog {...defaultProps} onAccept={onAccept} />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions\.start/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /actions\.start/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions\.accept/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /actions\.accept/i }));

    expect(onAccept).toHaveBeenCalledWith([7, 8, 9]);
  });

  it("calls onOpenChange(false) when cancel button is clicked", async () => {
    const onOpenChange = vi.fn();
    mockFetchCount();

    const user = userEvent.setup();
    renderWithQueryClient(
      <MagicSelectDialog {...defaultProps} onOpenChange={onOpenChange} />
    );

    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancelBtn);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows SelectedTestCasesDrawer in success state for reviewing suggestions", async () => {
    const user = userEvent.setup();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalCaseCount: 5,
          repositoryTotalCount: 5,
          searchPreFiltered: false,
          hitMaxSearchResults: false,
          noSearchMatches: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestedCaseIds: [1, 2],
          reasoning: "Test reasoning",
          metadata: null,
        }),
      });

    renderWithQueryClient(<MagicSelectDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions\.start/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /actions\.start/i }));

    await waitFor(() => {
      expect(screen.getByTestId("selected-cases-drawer")).toBeInTheDocument();
    });

    expect(screen.getByTestId("drawer-count")).toHaveTextContent("2");
  });

  it("shows refine button in success state allowing re-run", async () => {
    const user = userEvent.setup();

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalCaseCount: 5,
          repositoryTotalCount: 5,
          searchPreFiltered: false,
          hitMaxSearchResults: false,
          noSearchMatches: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestedCaseIds: [1],
          reasoning: "Single case",
          metadata: null,
        }),
      });

    renderWithQueryClient(<MagicSelectDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /actions\.start/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /actions\.start/i }));

    await waitFor(() => {
      expect(screen.getByText("success.title")).toBeInTheDocument();
    });

    // Refine button should appear
    expect(
      screen.getByRole("button", { name: /clarification\.refine/i })
    ).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    // Even with a pending fetch, dialog is closed
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

    renderWithQueryClient(
      <MagicSelectDialog {...defaultProps} open={false} />
    );

    // Dialog content not rendered when closed
    expect(screen.queryByText("counting")).not.toBeInTheDocument();
    expect(screen.queryByText("configure.title")).not.toBeInTheDocument();
  });
});
