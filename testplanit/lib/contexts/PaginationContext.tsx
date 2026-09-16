"use client";

import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "~/lib/navigation";

export type PageSizeOption = number | "All";

interface PaginationContextType {
  currentPage: number;
  setCurrentPage: (page: number) => void;
  pageSize: PageSizeOption;
  setPageSize: (size: PageSizeOption) => void;
  totalItems: number;
  setTotalItems: (total: number) => void;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

const PaginationContext = createContext<PaginationContextType | undefined>(
  undefined
);

export const defaultPageSizeOptions: PageSizeOption[] = [
  10,
  25,
  50,
  100,
  250,
  "All",
];

function parseUrlPage(raw: string | null): number | null {
  if (!raw) return null;
  const page = parseInt(raw, 10);
  return !isNaN(page) && page > 0 ? page : null;
}

function parseUrlSize(raw: string | null): PageSizeOption | null {
  if (!raw) return null;
  if (raw === "All") return "All";
  const size = parseInt(raw, 10);
  return !isNaN(size) && size > 0 ? size : null;
}

interface PaginationProviderProps {
  children: React.ReactNode;
  defaultPageSize?: PageSizeOption;
  /** URL param carrying the current page. Two providers on one page must
   * bind to different params, or each one's URL sync fights the other's. */
  pageParam?: string;
  /** URL param carrying the page size. See `pageParam`. */
  pageSizeParam?: string;
}

export function PaginationProvider({
  children,
  defaultPageSize = 10,
  pageParam = "page",
  pageSizeParam = "pageSize",
}: PaginationProviderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  // Initialize state from URL if present, otherwise use defaults
  const [currentPage, setCurrentPage] = useState(() => {
    return parseUrlPage(searchParams.get(pageParam)) ?? 1;
  });

  const [pageSize, setPageSize] = useState<PageSizeOption>(() => {
    return parseUrlSize(searchParams.get(pageSizeParam)) ?? defaultPageSize;
  });

  const [totalItems, setTotalItems] = useState(0);

  // The URL values this provider last reconciled with, by writing them or by
  // adopting a change that arrived from outside (browser navigation, another
  // writer). Owned by the write effect only: the read effect and the write
  // effect run in the same commit, so if the read effect moved this ref the
  // write effect would still see the previous state and write it back over
  // the URL that just changed.
  const lastSetValues = React.useRef<{ page: number; size: PageSizeOption }>({
    page: currentPage,
    size: pageSize,
  });

  // Calculate pagination values
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const totalPages = Math.ceil(totalItems / effectivePageSize);
  const startIndex =
    totalItems > 0 ? (currentPage - 1) * effectivePageSize + 1 : 0;
  const endIndex = Math.min(startIndex + effectivePageSize - 1, totalItems);

  // Track if we've already applied user preferences to avoid re-applying on every session change
  const hasAppliedPreferences = React.useRef(false);

  // Read from URL on mount or when URL changes externally
  useEffect(() => {
    const urlPage = parseUrlPage(searchParams.get(pageParam));
    const urlSize = parseUrlSize(searchParams.get(pageSizeParam));

    // Priority 1: URL parameters (always respect these)
    if (urlPage !== null && urlPage !== lastSetValues.current.page) {
      setCurrentPage(urlPage);
    }
    if (urlSize !== null && urlSize !== lastSetValues.current.size) {
      setPageSize(urlSize);
    }

    // Priority 2: User preferences (only if no URL params, haven't applied yet, and session has preference)
    if (
      urlSize === null &&
      !hasAppliedPreferences.current &&
      session?.user?.preferences?.itemsPerPage
    ) {
      const preferredSize = parseInt(
        session.user.preferences.itemsPerPage.replace("P", ""),
        10
      );
      if (!isNaN(preferredSize) && preferredSize > 0) {
        hasAppliedPreferences.current = true;
        setPageSize(preferredSize);
      }
    }
  }, [
    searchParams,
    session?.user?.preferences?.itemsPerPage,
    pageParam,
    pageSizeParam,
  ]);

  // Update URL when pagination state changes
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const urlPage = parseUrlPage(params.get(pageParam));
    const urlSize = parseUrlSize(params.get(pageSizeParam));

    // The URL moved away from what this provider last reconciled with, so
    // something else changed it. The read effect is pulling that value into
    // state; adopt it here instead of writing the (still previous) state back
    // over it, which would flip the URL back and forth indefinitely.
    const pageChangedExternally =
      urlPage !== null && urlPage !== lastSetValues.current.page;
    const sizeChangedExternally =
      urlSize !== null && urlSize !== lastSetValues.current.size;
    if (pageChangedExternally || sizeChangedExternally) {
      lastSetValues.current = {
        page: urlPage ?? lastSetValues.current.page,
        size: urlSize ?? lastSetValues.current.size,
      };
      return;
    }

    if (urlPage !== currentPage || urlSize !== pageSize) {
      lastSetValues.current = { page: currentPage, size: pageSize };

      params.set(pageParam, currentPage.toString());
      params.set(pageSizeParam, pageSize.toString());
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [currentPage, pageSize, router, searchParams, pageParam, pageSizeParam]);

  const value = {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalItems,
    setTotalItems,
    totalPages,
    startIndex,
    endIndex,
  };

  return (
    <PaginationContext.Provider value={value}>
      {children}
    </PaginationContext.Provider>
  );
}

export function usePagination() {
  const context = useContext(PaginationContext);
  if (!context) {
    throw new Error("usePagination must be used within a PaginationProvider");
  }
  return context;
}
