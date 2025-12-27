import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react"; // Ensure React is imported for JSX in mocks

// Import the entire mock module as a namespace
// import * as AppConfigHooksMock from "./app-config.hooks.mock";

// Import the mocked Edit modal - needed for DataTable mock
import { EditAppConfigModal } from "./EditAppConfig";

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

// Use vi.doMock (NOT hoisted) with local mocks
vi.doMock("~/lib/hooks/app-config", () => ({
  useFindManyAppConfig: mockUseFindManyAppConfig,
  useCreateAppConfig: () => ({ mutateAsync: mockCreateMutateAsync }),
  useUpdateAppConfig: () => ({ mutateAsync: mockUpdateMutateAsync }),
}));

// Mock next/navigation hooks, keeping other exports
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual, // Keep original exports like redirect, permanentRedirect
    useSearchParams: () => ({
      // Override specific hooks
      get: (key: string) => null,
    }),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => "/mock/path",
  };
});

// Modals (Mocking the implementation)
vi.mock("./AddAppConfig", () => ({
  AddAppConfigModal: vi.fn(() => <button>{"Mock Add Modal Trigger"}</button>),
}));
vi.mock("./EditAppConfig", () => ({
  EditAppConfigModal: vi.fn(({ config }) => (
    <button>{`Mock Edit ${config.key}`}</button>
  )),
}));

// Debounce Hook
vi.mock("@/components/Debounce", () => ({
  useDebounce: (value: any) => value, // Return value immediately
}));

// Mock the DataTable component
vi.mock("@/components/tables/DataTable", () => ({
  DataTable: vi.fn(({ data, isLoading, columns }) => {
    if (isLoading) {
      return <div>{"DataTable Loading..."}</div>;
    }
    if (!data || data.length === 0) {
      return <div>{"DataTable No Data"}</div>;
    }
    // Render confirmation and the mocked Edit Modals based on data
    return (
      <div>
        <div>{`DataTable Received ${data.length} items`}</div>
        {/* Render mocked Edit Modals to verify data prop */}
        {data.map((item: any) => (
          <EditAppConfigModal key={item.key} config={item} />
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
  expect(screen.getByText("Mock Add Modal Trigger")).toBeInTheDocument();
  expect(
    screen.getByPlaceholderText("admin.appConfig.filterPlaceholder")
  ).toBeInTheDocument();

  // Wait for the DataTable mock to render the correct state based on the mock implementation
  await waitFor(() => {
    expect(screen.getByText("DataTable No Data")).toBeInTheDocument();
  });
  // Ensure loading state is NOT present finally
  expect(screen.queryByText("DataTable Loading...")).not.toBeInTheDocument();
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

  // Wait for the DataTable mock to render the correct state
  await waitFor(() => {
    expect(screen.getByText("DataTable Received 2 items")).toBeVisible();
  });

  // Ensure loading state is NOT present finally
  expect(screen.queryByText("DataTable Loading...")).not.toBeInTheDocument();

  // Check that the Edit Modals were rendered by the DataTable mock
  expect(screen.getByText("Mock Edit key1")).toBeVisible(); // Can use getBy now
  expect(screen.getByText("Mock Edit key2")).toBeVisible(); // Can use getBy now

  // Check for the Add Modal Trigger (rendered outside DataTable)
  expect(screen.getByText("Mock Add Modal Trigger")).toBeInTheDocument();
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

  const dataTableMock = (await vi.importMock("@/components/tables/DataTable"))
    .DataTable as any;
  await waitFor(() => expect(dataTableMock).toHaveBeenCalled());
  const onSortChange = dataTableMock.mock.lastCall![0].onSortChange;

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
  await waitFor(() => {
    expect(mockSetCurrentPage).toHaveBeenCalledWith(1);
  });
});

// --- Add tests for pagination ---
