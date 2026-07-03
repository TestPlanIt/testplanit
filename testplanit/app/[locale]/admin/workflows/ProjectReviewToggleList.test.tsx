import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseReviewFeatureEnabled = vi.fn();
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: (...args: unknown[]) =>
    mockUseReviewFeatureEnabled(...args),
}));

// The list moved from paged useFindMany to infinite scroll; `useInfiniteFindMany`
// records the (where/orderBy) args the assertions below check.
const mockUseFindManyProjects = vi.fn();
const mockUseCountProjects = vi.fn();
const mockUseUpdateProjects = vi.fn();
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: {
      useInfiniteFindMany: (...args: unknown[]) =>
        mockUseFindManyProjects(...args),
      useCount: (...args: unknown[]) => mockUseCountProjects(...args),
      useUpdate: (...args: unknown[]) => mockUseUpdateProjects(...args),
    },
  }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

// Stub PaginationContext so the component runs without next-intl navigation
// plumbing. Tests do not exercise pagination state changes.
const setTotalItemsMock = vi.fn();
const setCurrentPageMock = vi.fn();
const setPageSizeMock = vi.fn();
vi.mock("~/lib/contexts/PaginationContext", () => ({
  PaginationProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  usePagination: () => ({
    currentPage: 1,
    setCurrentPage: setCurrentPageMock,
    pageSize: 10,
    setPageSize: setPageSizeMock,
    totalItems: 2,
    setTotalItems: setTotalItemsMock,
    startIndex: 1,
    endIndex: 2,
    totalPages: 1,
  }),
}));

// Render columns through a passthrough DataTable so the Switch cells (and
// their data-testids) appear in the DOM, without DataTable's own internal
// effects firing. Also exposes a sort-header proxy so tests can trigger the
// onSortChange callback the real DataTable invokes on header click.
const dataTableLastProps: { current: any } = { current: null };
vi.mock("@/components/tables/VirtualizedDataTable", () => ({
  VirtualizedDataTable: (props: any) => {
    dataTableLastProps.current = props;
    const { columns, data, onSortChange } = props;
    return (
      <table data-testid="data-table">
        <thead>
          <tr>
            {columns.map((col: any) => (
              <th key={col.id}>
                <button
                  data-testid={`sort-header-${col.id}`}
                  onClick={() => onSortChange?.(col.id)}
                >
                  {col.id}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row: any, rowIndex: number) => (
            <tr key={row.id ?? rowIndex}>
              {columns.map((col: any, colIndex: number) => (
                <td key={col.id ?? colIndex}>
                  {col.cell ? col.cell({ row: { original: row } }) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  },
}));

vi.mock("@/components/tables/Pagination", () => ({
  PaginationComponent: () => null,
}));

vi.mock("@/components/tables/PaginationControls", () => ({
  PaginationInfo: () => null,
}));

vi.mock("@/components/tables/Filter", () => ({
  Filter: ({ onSearchChange: _onSearchChange }: any) => (
    <input data-testid="project-review-toggle-search" />
  ),
}));

vi.mock("@/components/ProjectIcon", () => ({
  ProjectIcon: () => <span data-testid="project-icon" />,
}));

// ProjectNameCell uses next-intl's Link via ~/lib/navigation which requires
// an intl context; render a plain anchor in tests so the cell still mounts.
vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { ProjectReviewToggleList } from "./ProjectReviewToggleList";

const sampleProjects = [
  { id: 1, name: "Alpha", iconUrl: null, reviewWorkflowEnabled: false },
  { id: 2, name: "Beta", iconUrl: null, reviewWorkflowEnabled: true },
];

const mutateAsync = vi.fn();

beforeEach(() => {
  mockUseReviewFeatureEnabled.mockReset();
  mockUseFindManyProjects.mockReset();
  mockUseCountProjects.mockReset();
  mockUseUpdateProjects.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  setTotalItemsMock.mockReset();
  setCurrentPageMock.mockReset();
  setPageSizeMock.mockReset();
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});

  mockUseFindManyProjects.mockReturnValue({
    data: { pages: [sampleProjects], pageParams: [undefined] },
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
  });
  mockUseCountProjects.mockReturnValue({ data: sampleProjects.length });
  mockUseUpdateProjects.mockReturnValue({ mutateAsync });
});

describe("ProjectReviewToggleList", () => {
  it("renders nothing when the system review flag is off", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: false,
      enabled: false,
      isLoading: false,
    });

    render(<ProjectReviewToggleList />);

    expect(
      screen.queryByTestId("project-review-toggle-list-card")
    ).not.toBeInTheDocument();
  });

  it("renders nothing while the system review flag is loading", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: undefined,
      enabled: undefined,
      isLoading: true,
    });

    render(<ProjectReviewToggleList />);

    expect(
      screen.queryByTestId("project-review-toggle-list-card")
    ).not.toBeInTheDocument();
  });

  it("renders the card and a Switch per project when the system review flag is on", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<ProjectReviewToggleList />);

    expect(
      screen.getByTestId("project-review-toggle-list-card")
    ).toBeInTheDocument();

    const switchA = screen.getByTestId("project-review-workflow-switch-1");
    expect(switchA).toHaveAttribute("data-state", "unchecked");

    const switchB = screen.getByTestId("project-review-workflow-switch-2");
    expect(switchB).toHaveAttribute("data-state", "checked");
  });

  it("passes where.isDeleted=false to both useFindManyProjects and useCountProjects", () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<ProjectReviewToggleList />);

    expect(mockUseFindManyProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isDeleted: false }),
      }),
      expect.any(Object)
    );
    expect(mockUseCountProjects).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isDeleted: false }),
      }),
      expect.any(Object)
    );
  });

  it("toggling a row's switch calls updateProjects with the row id and new value and fires a success toast", async () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<ProjectReviewToggleList />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("project-review-workflow-switch-1"));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { reviewWorkflowEnabled: true },
    });
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("defaults to orderBy { name: 'asc' } and flips to desc on clicking the Name header", async () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<ProjectReviewToggleList />);

    // Initial query should sort by name asc.
    expect(mockUseFindManyProjects).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderBy: { name: "asc" } }),
      expect.any(Object)
    );

    const user = userEvent.setup();
    await user.click(screen.getByTestId("sort-header-name"));

    await waitFor(() => {
      expect(mockUseFindManyProjects).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: { name: "desc" } }),
        expect.any(Object)
      );
    });
  });

  it("sorts by reviewWorkflowEnabled when that column header is clicked", async () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });

    render(<ProjectReviewToggleList />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("sort-header-reviewWorkflowEnabled"));

    await waitFor(() => {
      expect(mockUseFindManyProjects).toHaveBeenLastCalledWith(
        expect.objectContaining({
          orderBy: { reviewWorkflowEnabled: "asc" },
        }),
        expect.any(Object)
      );
    });
  });

  it("surfaces a localized error toast when the update mutation rejects", async () => {
    mockUseReviewFeatureEnabled.mockReturnValue({
      systemEnabled: true,
      enabled: true,
      isLoading: false,
    });
    mutateAsync.mockRejectedValueOnce(new Error("boom"));

    render(<ProjectReviewToggleList />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("project-review-workflow-switch-1"));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });
});
