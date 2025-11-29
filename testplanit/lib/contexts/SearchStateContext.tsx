"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import {
  SearchableEntityType,
  UnifiedSearchResult,
  UnifiedSearchFilters,
} from "~/types/search";

interface SearchState {
  query: string;
  filters: UnifiedSearchFilters;
  selectedEntities: SearchableEntityType[];
  currentProjectOnly: boolean;
  results: UnifiedSearchResult | null;
  currentPage: number;
  selectedTab: SearchableEntityType | "all";
  allEntityTypeCounts?: Record<SearchableEntityType, number>;
}

interface SearchStateContextType {
  searchState: SearchState | null;
  setSearchState: (state: SearchState) => void;
  clearSearchState: () => void;
}

const SearchStateContext = createContext<SearchStateContextType | undefined>(
  undefined
);

interface SearchStateProviderProps {
  children: React.ReactNode;
}

export function SearchStateProvider({ children }: SearchStateProviderProps) {
  const [searchState, setSearchStateInternal] = useState<SearchState | null>(
    null
  );

  const setSearchState = useCallback((state: SearchState) => {
    setSearchStateInternal(state);
  }, []);

  const clearSearchState = useCallback(() => {
    setSearchStateInternal(null);
  }, []);

  const value = {
    searchState,
    setSearchState,
    clearSearchState,
  };

  return (
    <SearchStateContext.Provider value={value}>
      {children}
    </SearchStateContext.Provider>
  );
}

export function useSearchState() {
  const context = useContext(SearchStateContext);
  if (!context) {
    throw new Error("useSearchState must be used within a SearchStateProvider");
  }
  return context;
}
