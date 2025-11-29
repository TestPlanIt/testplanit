/**
 * Hook for managing report drill-down state and data fetching
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  DrillDownContext,
  DrillDownResponse,
  DrillDownRecord,
} from "~/lib/types/reportDrillDown";

const RECORDS_PER_PAGE = 50;

interface UseDrillDownReturn {
  /** Whether the drill-down drawer is open */
  isOpen: boolean;
  /** Close the drill-down drawer */
  closeDrawer: () => void;
  /** The current drill-down context */
  context: DrillDownContext | null;
  /** All loaded records */
  records: DrillDownRecord[];
  /** Total number of records available */
  total: number;
  /** Whether there are more records to load */
  hasMore: boolean;
  /** Whether initial data is loading */
  isLoading: boolean;
  /** Whether additional records are being loaded */
  isLoadingMore: boolean;
  /** Error if any */
  error: Error | null;
  /** Load more records */
  loadMore: () => void;
  /** Handle metric click to open drill-down */
  handleMetricClick: (context: DrillDownContext) => void;
  /** Aggregate statistics */
  aggregates?: DrillDownResponse["aggregates"];
}

/**
 * Hook for managing drill-down functionality
 */
export function useDrillDown(): UseDrillDownReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [context, setContext] = useState<DrillDownContext | null>(null);
  const [allRecords, setAllRecords] = useState<DrillDownRecord[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sessionId, setSessionId] = useState(0);
  const [aggregates, setAggregates] = useState<DrillDownResponse["aggregates"]>();

  // Fetch initial batch of records
  const { isLoading, error } = useQuery({
    queryKey: ["drill-down", sessionId, context?.metricId, context?.dimensions, offset],
    queryFn: async () => {
      if (!context) return null;

      const response = await fetch("/api/report-builder/drill-down", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          context,
          offset,
          limit: RECORDS_PER_PAGE,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to fetch drill-down data");
      }

      const data: DrillDownResponse = await response.json();

      // If this is a new query (offset = 0), replace all records
      // Otherwise, append to existing records
      if (offset === 0) {
        setAllRecords(data.data);
      } else {
        setAllRecords((prev) => [...prev, ...data.data]);
      }

      setTotal(data.total);
      setHasMore(data.hasMore);
      setIsLoadingMore(false);

      // Store aggregates (only set on first load)
      if (offset === 0 && data.aggregates) {
        setAggregates(data.aggregates);
      }

      return data;
    },
    enabled: !!context && isOpen,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  /**
   * Handle metric click to open drill-down
   */
  const handleMetricClick = useCallback((newContext: DrillDownContext) => {
    // Reset state for new drill-down
    setContext(newContext);
    setAllRecords([]);
    setOffset(0);
    setTotal(0);
    setHasMore(false);
    setIsLoadingMore(false);
    setAggregates(undefined); // Clear aggregates from previous drill-down
    setSessionId((prev) => prev + 1); // Increment to create new query key
    setIsOpen(true);
  }, []);

  /**
   * Close the drill-down drawer
   */
  const closeDrawer = useCallback(() => {
    setIsOpen(false);
    // Don't immediately clear context/records to allow smooth closing animation
    setTimeout(() => {
      setContext(null);
      setAllRecords([]);
      setOffset(0);
      setTotal(0);
      setHasMore(false);
    }, 300); // Wait for drawer close animation
  }, []);

  /**
   * Load more records (for infinite scroll)
   */
  const loadMore = useCallback(() => {
    if (!hasMore || isLoadingMore || isLoading) return;

    setIsLoadingMore(true);
    setOffset((prev) => prev + RECORDS_PER_PAGE);
  }, [hasMore, isLoadingMore, isLoading]);

  return {
    isOpen,
    closeDrawer,
    context,
    records: allRecords,
    total,
    hasMore,
    isLoading,
    isLoadingMore,
    error: error as Error | null,
    loadMore,
    handleMetricClick,
    aggregates,
  };
}
