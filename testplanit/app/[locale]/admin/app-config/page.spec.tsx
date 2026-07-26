import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react"; // Ensure React is imported for JSX in mocks
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// Import the entire mock module as a namespace
// import * as AppConfigHooksMock from "./app-config.hooks.mock";

// Import the mocked Edit modal - needed for DataTable mock
import { EditAppConfig } from "./EditAppConfig";

// --- Mocks ---

// Declare mocks LOCALLY before vi.doMock
const mockUseFindManyAppConfig = vi.fn();
const mockCreateMutateAsync = vi.fn();
const mockUpdateMutateAsync = vi.fn();
const mockSetCurrentPage = vi.fn();
const mockSetPageSize = vi.fn();
const mockSetTotalItems = vi.fn();

// Translations
vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: (namespace?: string) => (key: string) =>
    namespace ? `${namespace}.${key}` : key,
}));

// Pagination Context Hook Mock
const mockPaginationContextValue = {
  currentPage: 1,
  setCurrentPage: mockSetCurrentPage,
  pageSize: 10,
  setPageSize: mockSetPageSize,
  totalItems: 0,
  setTotalItems: mockSetTotalItems,
};
vi.mock("~/lib/contexts/PaginationContext", () => ({
  usePagination: () => mockPaginationContextValue,
  PaginationProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

// Use vi.doMock (NOT hoisted) so the dynamically-imported page picks up these
// useClientQueries mocks built from the local spies (the page reads
// appConfig.useFindMany/useCreate/useUpdate).
vi.doMock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    appConfig: {
      useFindMany: mockUseFindManyAppConfig,
      useCreate: () => ({
        mutateAsync: mockCreateMutateAsync,
        isPending: false,
      }),
      useUpdate: () => ({
        mutateAsync: mockUpdateMutateAsync,
        isPending: false,
      }),
    },
  }),
}));

// Mock next/navigation hooks, keeping other exports
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual, // Keep original exports like redirect, permanentRedirect
    useSearchParams: () => ({
      // Override specific hooks
      get: (_key: string) => null,
    }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => "/mock/path",
  };
});

// Modals (Mocking the implementation)
// AddAppConfig is now a pure form component rendered conditionally by the
// parent page; mock it as a placeholder div since the parent owns the
// trigger button directly.
vi.mock("./AddAppConfig", () => ({
  AddAppConfig: vi.fn(() => <div>{"Mock Add Modal"}</div>),
}));
// EditAppConfig is now a pure form component rendered conditionally by the
// parent page; mock it as a div placeholder. The page test simulates the
// "edit button clicked" view by rendering the mock for each row.
vi.mock("./EditAppConfig", () => ({
  EditAppConfig: vi.fn(({ config }) => <div>{`Mock Edit ${config.key}`}</div>),
}));

// Debounce Hook
vi.mock("@/components/Debounce", () => ({
  useDebounce: (value: any) => value, // Return value immediately
}));

// Mock the VirtualizedDataTable component (the page renders the table through it
// since the pagination → infinite-scroll conversion).
vi.mock("@/components/tables/VirtualizedDataTable", () => ({
  VirtualizedDataTable: vi.fn(({ data, isLoading, columns: _columns }) => {
    if (isLoading) {
      return <div>{"Table Loading..."}</div>;
    }
    if (!data || data.length === 0) {
      return <div>{"Table No Data"}</div>;
    }
    // Render confirmation and the mocked Edit Modals based on data
    return (
      <div>
        <div>{`Table Received ${data.length} items`}</div>
        {/* Render mocked Edit Modals to verify data prop */}
        {data.map((item: any) => (
          <EditAppConfig
            key={item.key}
            config={item}
            open={false}
            onClose={() => {}}
          />
        ))}
      </div>
    );
  }),
}));

// --- Test Setup ---
const queryClient = new QueryClient();

// Render function now accepts the dynamically imported component
const renderPage = (Component: React.ComponentType) => {
  return {
    user: userEvent.setup(),
    ...render(
      <QueryClientProvider client={queryClient}>
        <Component />
      </QueryClientProvider>
    ),
  };
};

beforeEach(() => {
  // Reset LOCAL mocks
  mockUseFindManyAppConfig.mockClear();
  mockCreateMutateAsync.mockClear();
  mockUpdateMutateAsync.mockClear();
  mockSetCurrentPage.mockClear();
  mockSetPageSize.mockClear();
  mockSetTotalItems.mockClear();
  // Reset pagination context values
  Object.assign(mockPaginationContextValue, {
    currentPage: 1,
    pageSize: 10,
    totalItems: 0,
  });
});

// Clean up JSDOM after each test
afterEach(() => {
  cleanup();
  vi.resetModules(); // IMPORTANT: Reset modules between tests for dynamic imports
});

// --- Tests ---

test("renders initial layout, title, and add button", async () => {
  // Dynamically import the component *after* mocks are set
  const { default: AppConfigs } = await import("./page");

  mockUseFindManyAppConfig.mockImplementation(() => ({
    data: [],
    isLoading: false,
  }));
  renderPage(AppConfigs);

  // Assertions for static elements first
  expect(screen.getByText("admin.menu.appConfig")).toBeInTheDocument();
  // Trigger button is rendered directly by the page (not inside the modal)
  expect(
    screen.getByRole("button", { name: "admin.appConfig.addConfig" })
  ).toBeInTheDocument();
  // The modal itself is conditionally mounted — not in the DOM until opened
  expect(screen.queryByText("Mock Add Modal")).not.toBeInTheDocument();
  expect(
    screen.getByPlaceholderText("admin.appConfig.filterPlaceholder")
  ).toBeInTheDocument();

  // Wait for the table mock to render the correct state based on the mock implementation
  await waitFor(() => {
    expect(screen.getByText("Table No Data")).toBeInTheDocument();
  });
  // Ensure loading state is NOT present finally
  expect(screen.queryByText("Table Loading...")).not.toBeInTheDocument();
});

test("renders table indication and edit buttons when data exists", async () => {
  const { default: AppConfigs } = await import("./page");
  const sampleData = [
    { key: "key1", value: { a: 1 }, id: "key1", name: "key1" },
    { key: "key2", value: "value2", id: "key2", name: "key2" },
  ];
  mockUseFindManyAppConfig.mockImplementation(() => ({
    data: sampleData,
    isLoading: false,
  }));
  mockPaginationContextValue.totalItems = sampleData.length;

  renderPage(AppConfigs);

  // Wait for the table mock to render the correct state
  await waitFor(() => {
    expect(screen.getByText("Table Received 2 items")).toBeVisible();
  });

  // Ensure loading state is NOT present finally
  expect(screen.queryByText("Table Loading...")).not.toBeInTheDocument();

  // Check that the Edit Modals were rendered by the DataTable mock
  expect(screen.getByText("Mock Edit key1")).toBeVisible(); // Can use getBy now
  expect(screen.getByText("Mock Edit key2")).toBeVisible(); // Can use getBy now

  // Check for the Add trigger button (rendered directly by the page,
  // outside DataTable). The modal itself is conditionally mounted and
  // only appears when the button is clicked.
  expect(
    screen.getByRole("button", { name: "admin.appConfig.addConfig" })
  ).toBeInTheDocument();
  expect(screen.queryByText("Mock Add Modal")).not.toBeInTheDocument();
});

test("calls data fetch hook with filter when text is entered", async () => {
  const { default: AppConfigs } = await import("./page");
  const { user } = renderPage(AppConfigs);

  const filterInput = screen.getByPlaceholderText(
    "admin.appConfig.filterPlaceholder"
  );
  const searchTerm = "test-filter";

  // Simulate typing into the filter input
  await user.type(filterInput, searchTerm);

  // Assert that the find hook was called with the filter term
  // Note: The hook might be called initially on render, so we check the *last* call
  // or assert it was called with the specific args. `toHaveBeenCalledWith` is often cleaner.
  await waitFor(() => {
    // Wait for the debounce/re-render/hook call
    expect(mockUseFindManyAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          key: {
            contains: searchTerm,
            mode: "insensitive",
          },
        },
      })
    );
  });
});

// Separate tests for each sort action
test("sorts ascending on first click", async () => {
  const { default: AppConfigs } = await import("./page");
  // Initial state for the hook (default sort)
  mockUseFindManyAppConfig.mockImplementation(() => ({
    data: [],
    isLoading: false,
  }));
  renderPage(AppConfigs);

  const tableMock = (
    await vi.importMock("@/components/tables/VirtualizedDataTable")
  ).VirtualizedDataTable as any;
  await waitFor(() => expect(tableMock).toHaveBeenCalled());
  const onSortChange = tableMock.mock.lastCall![0].onSortChange;

  // Set implementation for the *next* call (after sort)
  mockUseFindManyAppConfig.mockImplementation(() => ({
    data: [],
    isLoading: false,
  }));

  await act(async () => {
    onSortChange("value");
  });

  await waitFor(() => {
    expect(mockUseFindManyAppConfig).toHaveBeenCalledTimes(2); // Initial + Sort
    expect(mockUseFindManyAppConfig).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ orderBy: { value: "asc" } })
    );
  });
});

// --- Add tests for pagination ---
