"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "~/lib/navigation";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";

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

interface PaginationProviderProps {
  children: React.ReactNode;
  defaultPageSize?: PageSizeOption;
}

export function PaginationProvider({
  children,
  defaultPageSize = 10,
}: PaginationProviderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  // Initialize state from URL if present, otherwise use defaults
  const [currentPage, setCurrentPage] = useState(() => {
    const page = searchParams.get("page");
    const urlPage = page ? parseInt(page, 10) : null;
    return urlPage && !isNaN(urlPage) && urlPage > 0 ? urlPage : 1;
  });

  const [pageSize, setPageSize] = useState<PageSizeOption>(() => {
    const size = searchParams.get("pageSize");
    if (size === "All") return "All";
    const urlSize = size ? parseInt(size, 10) : null;
    return urlSize && !isNaN(urlSize) && urlSize > 0 ? urlSize : defaultPageSize;
  });

  const [totalItems, setTotalItems] = useState(0);

  // Track the last values we set to avoid circular updates
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
    const page = searchParams.get("page");
    const size = searchParams.get("pageSize");

    // Parse URL values
    const urlPage = page ? parseInt(page, 10) : null;
    const urlSize = size === "All" ? "All" : size ? parseInt(size, 10) : null;

    // Priority 1: URL parameters (always respect these)
    if (urlPage && !isNaN(urlPage) && urlPage > 0) {
      if (urlPage !== lastSetValues.current.page) {
        lastSetValues.current.page = urlPage;
        setCurrentPage(urlPage);
      }
    }

    if (urlSize === "All" || (typeof urlSize === "number" && !isNaN(urlSize) && urlSize > 0)) {
      if (urlSize !== lastSetValues.current.size) {
        lastSetValues.current.size = urlSize;
        setPageSize(urlSize);
      }
    }

    // Priority 2: User preferences (only if no URL params, haven't applied yet, and session has preference)
    if (
      !urlSize &&
      !hasAppliedPreferences.current &&
      session?.user?.preferences?.itemsPerPage
    ) {
      const preferredSize = parseInt(
        session.user.preferences.itemsPerPage.replace("P", ""),
        10
      );
      if (!isNaN(preferredSize) && preferredSize > 0 && preferredSize !== lastSetValues.current.size) {
        hasAppliedPreferences.current = true;
        lastSetValues.current = { page: lastSetValues.current.page, size: preferredSize };
        setPageSize(preferredSize);
      }
    }
  }, [searchParams, session?.user?.preferences?.itemsPerPage]);

  // Update URL when pagination state changes
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const currentPageParam = params.get("page");
    const currentPageSizeParam = params.get("pageSize");

    const pageChanged = currentPageParam !== currentPage.toString();
    const pageSizeChanged = currentPageSizeParam !== pageSize.toString();

    if (pageChanged || pageSizeChanged) {
      // Update our tracking ref
      lastSetValues.current = { page: currentPage, size: pageSize };

      params.set("page", currentPage.toString());
      params.set("pageSize", pageSize.toString());
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [currentPage, pageSize, router, searchParams]);

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
