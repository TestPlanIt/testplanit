import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaginationProvider, usePagination } from "./PaginationContext";

// The App Router commits a `router.replace` asynchronously: the URL the hooks
// see only moves once the transition lands. `replace` records the requested
// URL and `commitUrl` applies it, so each test controls that ordering.
let search = new URLSearchParams();
let pendingSearch: URLSearchParams | null = null;
let sessionData: { user?: { preferences?: { itemsPerPage?: string } } } | null =
  null;

const replace = vi.fn((href: string) => {
  pendingSearch = new URLSearchParams(href.replace(/^\?/, ""));
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => search,
}));

vi.mock("~/lib/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: sessionData, status: "authenticated" }),
}));

type Rerender = () => void;

function commitUrl(rerenders: Rerender[]) {
  if (!pendingSearch) return false;
  search = pendingSearch;
  pendingSearch = null;
  act(() => rerenders.forEach((rerender) => rerender()));
  return true;
}

function setUrl(next: string, rerenders: Rerender[]) {
  search = new URLSearchParams(next);
  act(() => rerenders.forEach((rerender) => rerender()));
}

function renderPagination(params?: {
  pageParam?: string;
  pageSizeParam?: string;
}) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <PaginationProvider {...params}>{children}</PaginationProvider>
  );
  return renderHook(() => usePagination(), { wrapper });
}

beforeEach(() => {
  search = new URLSearchParams();
  pendingSearch = null;
  sessionData = null;
  replace.mockClear();
});

describe("PaginationProvider URL sync", () => {
  it("writes the initial page and page size to the URL on mount", () => {
    renderPagination();

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?page=1&pageSize=10", {
      scroll: false,
    });
  });

  it("reads the initial page and page size from the URL without writing", () => {
    search = new URLSearchParams("page=3&pageSize=25");
    const { result } = renderPagination();

    expect(result.current.currentPage).toBe(3);
    expect(result.current.pageSize).toBe(25);
    expect(replace).not.toHaveBeenCalled();
  });

  it("writes a page size chosen through the setter and settles once it commits", () => {
    const { result, rerender } = renderPagination();
    commitUrl([rerender]);
    replace.mockClear();

    act(() => result.current.setPageSize(25));

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith("?page=1&pageSize=25", {
      scroll: false,
    });

    commitUrl([rerender]);

    expect(result.current.pageSize).toBe(25);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("adopts a page size changed elsewhere instead of writing the old one back", () => {
    const { result, rerender } = renderPagination();
    commitUrl([rerender]);
    replace.mockClear();

    setUrl("page=2&pageSize=50", [rerender]);

    expect(result.current.currentPage).toBe(2);
    expect(result.current.pageSize).toBe(50);
    expect(replace).not.toHaveBeenCalled();
  });

  it("keeps a setter change made after an external change", () => {
    const { result, rerender } = renderPagination();
    commitUrl([rerender]);
    setUrl("page=1&pageSize=50", [rerender]);
    replace.mockClear();

    act(() => result.current.setCurrentPage(4));

    expect(replace).toHaveBeenCalledWith("?page=4&pageSize=50", {
      scroll: false,
    });
    commitUrl([rerender]);
    expect(result.current.currentPage).toBe(4);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("two providers on the same params converge instead of flipping the URL back and forth", () => {
    const first = renderPagination();
    const second = renderPagination();
    const rerenders = [first.rerender, second.rerender];
    while (commitUrl(rerenders)) {
      // drain the mount writes
    }
    replace.mockClear();

    act(() => first.result.current.setPageSize(25));

    let commits = 0;
    while (commitUrl(rerenders)) {
      commits += 1;
      if (commits > 5) break;
    }

    expect(commits).toBe(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(first.result.current.pageSize).toBe(25);
    expect(second.result.current.pageSize).toBe(25);
    expect(search.get("pageSize")).toBe("25");
  });

  it("providers bound to different params page independently", () => {
    const cases = renderPagination();
    const results = renderPagination({
      pageParam: "resultsPage",
      pageSizeParam: "resultsPageSize",
    });
    const rerenders = [cases.rerender, results.rerender];
    while (commitUrl(rerenders)) {
      // drain the mount writes
    }
    replace.mockClear();

    act(() => results.result.current.setPageSize(50));
    while (commitUrl(rerenders)) {
      // settle
    }

    expect(search.get("pageSize")).toBe("10");
    expect(search.get("resultsPageSize")).toBe("50");
    expect(cases.result.current.pageSize).toBe(10);
    expect(results.result.current.pageSize).toBe(50);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("applies the user's preferred page size when the URL has none", () => {
    sessionData = { user: { preferences: { itemsPerPage: "P25" } } };
    const { result, rerender } = renderPagination();
    while (commitUrl([rerender])) {
      // settle
    }

    expect(result.current.pageSize).toBe(25);
    expect(search.get("pageSize")).toBe("25");
  });
});
