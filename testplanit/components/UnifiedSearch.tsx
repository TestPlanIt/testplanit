"use client";

import { useDebounce } from "@/components/Debounce";
import DynamicIcon from "@/components/DynamicIcon";
import { EntityTypeSelector } from "@/components/EntityTypeSelector";
import { ProjectIcon } from "@/components/ProjectIcon";
import { CustomFieldDisplay } from "@/components/search/CustomFieldDisplay";
import { FacetedSearchFilters } from "@/components/search/FacetedSearchFilters";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { SavedSearchesMenu } from "@/components/search/SavedSearchesMenu";
import { SearchHelpContent } from "@/components/search/SearchHelpContent";
import {
  BadgeList,
  DateDisplay,
  ExternalLink,
  MetadataItem,
  MetadataList,
  SearchHighlight,
  StatusBadge,
  TagList,
  TimeEstimate,
} from "@/components/search/SearchResultComponents";
import { TestCaseSearchResult } from "@/components/search/TestCaseSearchResult";
import { UserDisplay } from "@/components/search/UserDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { BulkEditModal } from "@/projects/repository/[projectId]/BulkEditModal";
import {
  Filter,
  Folder,
  Pencil,
  PlayCircle,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "~/lib/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getEntityIcon,
  getEntityLabel,
  useSearchContext,
} from "~/hooks/useSearchContext";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import { useSearchState } from "~/lib/contexts/SearchStateContext";
import { type SavedSearchCriteria } from "~/lib/schemas/savedSearch";
import { IconName } from "~/types/globals";
import {
  SearchableEntityType,
  SearchHit,
  SearchOptions,
  UnifiedSearchFilters,
  UnifiedSearchResult,
} from "~/types/search";
import { cn } from "~/utils";

interface UnifiedSearchProps {
  // Context overrides
  forceEntityType?: SearchableEntityType;
  forceProjectId?: number;

  // UI options
  showEntitySelector?: boolean;
  showProjectToggle?: boolean;
  showSavedSearches?: boolean;
  compactMode?: boolean;
  placeholder?: string;

  // Callbacks
  onResultsChange?: (results: UnifiedSearchResult) => void;
  onResultClick?: (hit: SearchHit) => void;
  renderResults?: (results: UnifiedSearchResult) => React.ReactNode;

  // Initial state
  initialQuery?: string;
  initialFilters?: UnifiedSearchFilters;
}

export function UnifiedSearch({
  forceEntityType,
  forceProjectId,
  showEntitySelector = true,
  showProjectToggle = true,
  showSavedSearches = true,
  compactMode = false,
  placeholder,
  onResultsChange,
  onResultClick,
  renderResults,
  initialQuery = "",
  initialFilters,
}: UnifiedSearchProps) {
  const searchContext = useSearchContext();
  const t = useTranslations();
  const { searchState, setSearchState } = useSearchState();

  // Initialize state from saved search state or defaults
  const [query, setQuery] = useState(searchState?.query || initialQuery);
  const [filters, setFilters] = useState<UnifiedSearchFilters>(
    searchState?.filters || initialFilters || searchContext.defaultFilters
  );
  const [selectedEntities, setSelectedEntities] = useState<
    SearchableEntityType[]
  >(() => {
    if (searchState?.selectedEntities) return searchState.selectedEntities;
    if (forceEntityType) return [forceEntityType];
    if (searchContext.defaultFilters.entityTypes)
      return searchContext.defaultFilters.entityTypes;
    if (searchContext.currentEntity) return [searchContext.currentEntity];
    return searchContext.availableEntities;
  });
  const [currentProjectOnly, setCurrentProjectOnly] = useState<boolean>(() => {
    if (searchState?.currentProjectOnly !== undefined)
      return searchState.currentProjectOnly;
    // Default to current project if we're in a project context
    return Boolean(searchContext.projectId);
  });
  const [results, setResults] = useState<UnifiedSearchResult | null>(
    searchState?.results || null
  );
  // Accumulated hits across every loaded page for the current tab/query. The
  // virtualized list renders from this rather than a single page, so the user
  // scrolls one continuous list with no page seam.
  const [loadedHits, setLoadedHits] = useState<SearchHit[]>(
    searchState?.results?.hits ?? []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A failed "load more" stops the auto-fetch from looping on the still-visible
  // sentinel; cleared on every reset (query/scope/tab change).
  const [loadMoreError, setLoadMoreError] = useState(false);
  // Guards against an inconsistent `total` (more reported than returnable, e.g.
  // count drift) wedging the sentinel into fetching empty pages forever.
  const [reachedEnd, setReachedEnd] = useState(false);
  const [isFirstSearch, setIsFirstSearch] = useState(!searchState?.results);
  // Highest page loaded for the current tab/query (the infinite-scroll cursor).
  const [currentPage, setCurrentPage] = useState(searchState?.currentPage || 1);
  const [pageSize] = useState(compactMode ? 10 : 50);
  const [showFilters, setShowFilters] = useState(false);
  const [showEntityTypeSheet, setShowEntityTypeSheet] = useState(false);
  const [selectedTab, setSelectedTab] = useState<SearchableEntityType | "all">(
    searchState?.selectedTab || "all"
  );
  const allEntityTypeCountsRef = useRef<
    Record<SearchableEntityType, number> | undefined
  >(searchState?.allEntityTypeCounts);

  // Bulk-action selection: RepositoryCase hits only. Map<caseId → projectId> so
  // we can both look up by id and detect cross-project selections cheaply.
  const [selectedCaseRows, setSelectedCaseRows] = useState<Map<number, number>>(
    new Map()
  );
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const router = useRouter();

  // Restore a saved search into the live state. The existing reset effect
  // (keyed on query/filters/selectedEntities/currentProjectOnly) re-runs the
  // search under the current session.
  const handleApplySavedSearch = useCallback(
    (criteria: SavedSearchCriteria) => {
      setSelectedEntities(criteria.selectedEntities);
      setCurrentProjectOnly(criteria.currentProjectOnly);
      setFilters(criteria.filters);
      setQuery(criteria.query);
    },
    []
  );

  // Debounced search query
  const debouncedQuery = useDebounce(query, 300);

  // Available entities based on context
  const availableEntities = useMemo(
    () =>
      forceEntityType ? [forceEntityType] : searchContext.availableEntities,
    [forceEntityType, searchContext.availableEntities]
  );

  // Build display text for selected entities
  const selectedEntitiesText = useMemo(() => {
    if (selectedEntities.length === 0) return t("search.allTypes");
    if (selectedEntities.length === 1)
      return getEntityLabel(selectedEntities[0]);
    if (selectedEntities.length === availableEntities.length)
      return t("search.allTypes");
    return t("search.typesSelected", { count: selectedEntities.length });
  }, [selectedEntities, availableEntities, t]);

  // Build placeholder text
  const searchPlaceholder = useMemo(() => {
    if (placeholder) return placeholder;
    if (currentProjectOnly && searchContext.projectId) {
      return t("search.placeholder.thisProject");
    }
    return t("search.placeholder.allProjects");
  }, [placeholder, currentProjectOnly, searchContext.projectId, t]);

  // Search function. `append` distinguishes the next-page fetch (results are
  // appended to the accumulated list) from a fresh search (results replace it).
  const performSearch = useCallback(
    async (
      page: number = 1,
      forSpecificTab?: SearchableEntityType | "all",
      { append = false }: { append?: boolean } = {}
    ) => {
      // Don't search if query is empty
      if (!debouncedQuery.trim()) {
        setResults(null);
        setLoadedHits([]);
        return;
      }

      setLoading(true);
      if (append) setLoadMoreError(false);
      else setError(null);

      try {
        // Build filters based on selected scope and entities
        const scopedFilters = { ...filters };

        // Determine which entity types to search based on tab
        const tabToSearch = forSpecificTab || selectedTab;
        const entitiesToSearch =
          tabToSearch === "all"
            ? selectedEntities
            : [tabToSearch as SearchableEntityType];

        const searchOptions: SearchOptions = {
          filters: {
            ...scopedFilters,
            query: debouncedQuery,
            entityTypes:
              entitiesToSearch.length > 0 ? entitiesToSearch : undefined,
          },
          pagination: {
            page,
            size: pageSize,
          },
          highlight: true,
          facets: [
            "projects",
            "states",
            "tags",
            "creators",
            "folders",
            "templates",
            "configurations",
            "milestones",
            "assignedTo",
          ],
        };

        const response = await fetch("/api/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(searchOptions),
        });

        if (!response.ok) {
          throw new Error("Search failed");
        }

        const data: UnifiedSearchResult = await response.json();

        // Store entity type counts when searching all types
        if (tabToSearch === "all" && data.entityTypeCounts) {
          allEntityTypeCountsRef.current = data.entityTypeCounts;
        }

        // If searching a specific tab, use stored counts
        if (tabToSearch !== "all" && allEntityTypeCountsRef.current) {
          data.entityTypeCounts = allEntityTypeCountsRef.current;
        }

        if (append) {
          // An empty page means we've reached the end regardless of what the
          // reported total claims — stop the sentinel from refetching it.
          if (data.hits.length === 0) setReachedEnd(true);
          // Keep the first-page metadata (total, counts, facets) and grow the
          // rendered list. De-dupe by entity+id in case a page boundary
          // overlaps so the virtualizer never gets duplicate keys.
          setLoadedHits((prev) => {
            const seen = new Set(prev.map((h) => `${h.entityType}-${h.id}`));
            const next = data.hits.filter(
              (h) => !seen.has(`${h.entityType}-${h.id}`)
            );
            return next.length ? [...prev, ...next] : prev;
          });
        } else {
          setResults(data);
          setLoadedHits(data.hits);
          setReachedEnd(false);
        }
        setCurrentPage(page);
        setIsFirstSearch(false);
        onResultsChange?.(data);
      } catch (err) {
        console.error("Search error:", err);
        if (append) {
          // Don't wipe the already-rendered list on a next-page failure; surface
          // an inline retry and pause the auto-fetch loop instead.
          setLoadMoreError(true);
        } else {
          setError(t("search.errors.searchFailed"));
        }
      } finally {
        setLoading(false);
      }
    },
    [
      debouncedQuery,
      filters,
      selectedEntities,
      selectedTab,
      pageSize,
      onResultsChange,
      t,
    ]
  );

  // Track if parameters have changed (not tab/page)
  const [searchTrigger, setSearchTrigger] = useState(0);

  // Reset to the first page + "all" tab whenever the query/filters/scope
  // change, then trigger a fresh search.
  useEffect(() => {
    setCurrentPage(1);
    setSelectedTab("all");
    setLoadMoreError(false);
    setReachedEnd(false);
    setSearchTrigger((prev) => prev + 1);
  }, [debouncedQuery, filters, selectedEntities, currentProjectOnly]);

  // Run the fresh (page 1) search when triggered. Subsequent pages are
  // appended by the infinite-scroll sentinel; tab switches load their own
  // page 1 (see the Tabs onValueChange handler).
  useEffect(() => {
    if (debouncedQuery.trim() && searchTrigger > 0) {
      void performSearch(1, "all", { append: false });
    } else if (!debouncedQuery.trim()) {
      setResults(null);
      setLoadedHits([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger]);

  // Save search state whenever it changes
  useEffect(() => {
    if (query || results) {
      setSearchState({
        query,
        filters,
        selectedEntities,
        currentProjectOnly,
        results,
        currentPage,
        selectedTab,
        allEntityTypeCounts: allEntityTypeCountsRef.current,
      });
    }
  }, [
    query,
    filters,
    selectedEntities,
    currentProjectOnly,
    results,
    currentPage,
    selectedTab,
    setSearchState,
  ]);

  // Update filters when currentProjectOnly changes
  useEffect(() => {
    const projectId = forceProjectId || searchContext.projectId;
    if (!projectId) return;

    setFilters((prevFilters) => {
      const newFilters = { ...prevFilters };

      // Update project filters for each entity type based on currentProjectOnly
      selectedEntities.forEach((entityType) => {
        switch (entityType) {
          case SearchableEntityType.REPOSITORY_CASE:
            if (currentProjectOnly) {
              newFilters.repositoryCase = {
                ...newFilters.repositoryCase,
                projectIds: [projectId],
              };
            } else if (
              newFilters.repositoryCase?.projectIds?.includes(projectId)
            ) {
              // Remove current project from filters if unchecked
              const { projectIds, ...rest } = newFilters.repositoryCase;
              newFilters.repositoryCase = rest;
            }
            break;
          case SearchableEntityType.SHARED_STEP:
            if (currentProjectOnly) {
              newFilters.sharedStep = {
                ...newFilters.sharedStep,
                projectIds: [projectId],
              };
            } else {
              // SharedStep requires projectIds, so we keep it but empty
              newFilters.sharedStep = {
                ...newFilters.sharedStep,
                projectIds: [],
              };
            }
            break;
          case SearchableEntityType.TEST_RUN:
            if (currentProjectOnly) {
              newFilters.testRun = {
                ...newFilters.testRun,
                projectIds: [projectId],
              };
            } else if (newFilters.testRun?.projectIds?.includes(projectId)) {
              const { projectIds, ...rest } = newFilters.testRun;
              newFilters.testRun = rest;
            }
            break;
          case SearchableEntityType.SESSION:
            if (currentProjectOnly) {
              newFilters.session = {
                ...newFilters.session,
                projectIds: [projectId],
              };
            } else if (newFilters.session?.projectIds?.includes(projectId)) {
              const { projectIds, ...rest } = newFilters.session;
              newFilters.session = rest;
            }
            break;
          case SearchableEntityType.ISSUE:
            if (currentProjectOnly) {
              newFilters.issue = {
                ...newFilters.issue,
                projectIds: [projectId],
              };
            } else if (newFilters.issue?.projectIds?.includes(projectId)) {
              const { projectIds, ...rest } = newFilters.issue;
              newFilters.issue = rest;
            }
            break;
          case SearchableEntityType.MILESTONE:
            if (currentProjectOnly) {
              newFilters.milestone = {
                ...newFilters.milestone,
                projectIds: [projectId],
              };
            } else if (newFilters.milestone?.projectIds?.includes(projectId)) {
              const { projectIds, ...rest } = newFilters.milestone;
              newFilters.milestone = rest;
            }
            break;
          case SearchableEntityType.PROJECT:
            // Projects don't have project filters
            break;
        }
      });

      return newFilters;
    });
  }, [
    currentProjectOnly,
    forceProjectId,
    searchContext.projectId,
    selectedEntities,
  ]);

  // Clear search
  const clearSearch = () => {
    setQuery("");
    setResults(null);
    setLoadedHits([]);
    setError(null);
    setLoadMoreError(false);
    setReachedEnd(false);
    setIsFirstSearch(true);
    setCurrentPage(1);
    setSelectedCaseRows(new Map());
  };

  // Drop any bulk selection when the query or scope changes — the user is
  // re-narrowing, so the prior selection is no longer in the visible result set.
  useEffect(() => {
    setSelectedCaseRows(new Map());
  }, [debouncedQuery, filters, currentProjectOnly]);

  // Bulk-action derivatives + handlers (RepositoryCase rows only).
  const selectedCaseProjectIds = useMemo(
    () => new Set(selectedCaseRows.values()),
    [selectedCaseRows]
  );
  const isCrossProjectSelection = selectedCaseProjectIds.size > 1;
  const singleSelectedProjectId =
    selectedCaseProjectIds.size === 1
      ? Number([...selectedCaseProjectIds][0])
      : null;
  const selectedCaseIdList = useMemo(
    () => [...selectedCaseRows.keys()],
    [selectedCaseRows]
  );

  const toggleCaseSelection = useCallback((hit: SearchHit) => {
    const id = Number(hit.id);
    const projectId = Number((hit.source as { projectId?: number })?.projectId);
    if (!Number.isFinite(id) || !Number.isFinite(projectId)) return;
    setSelectedCaseRows((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, projectId);
      return next;
    });
  }, []);

  const clearBulkSelection = useCallback(() => {
    setSelectedCaseRows(new Map());
  }, []);

  const handleBulkCreateTestRun = useCallback(() => {
    if (singleSelectedProjectId == null || selectedCaseIdList.length === 0)
      return;
    sessionStorage.setItem(
      "createTestRun_selectedCases",
      JSON.stringify(selectedCaseIdList)
    );
    router.push(`/projects/runs/${singleSelectedProjectId}?openAddRun=true`);
  }, [router, selectedCaseIdList, singleSelectedProjectId]);

  // Handle filter changes from faceted search
  const handleFiltersChange = (newFilters: UnifiedSearchFilters) => {
    setFilters(newFilters);
    setCurrentPage(1); // Reset to first page when filters change
  };

  // Get active filter count
  const getActiveFilterCount = () => {
    let count = 0;

    // Check each entity type's filters
    if (filters.repositoryCase) {
      const f = filters.repositoryCase;
      if (f.projectIds?.length) count++;
      if (f.stateIds?.length) count++;
      if (f.tagIds?.length) count++;
      if (f.creatorIds?.length) count++;
      if (f.dateRange) count++;
      if (f.folderIds?.length) count++;
      if (f.templateIds?.length) count++;
      if (f.automated !== undefined) count++;
      if (f.isArchived !== undefined) count++;
      if (f.customFields?.length) count += f.customFields.length;
    }

    if (filters.testRun) {
      const f = filters.testRun;
      if (f.projectIds?.length) count++;
      if (f.stateIds?.length) count++;
      if (f.tagIds?.length) count++;
      if (f.creatorIds?.length) count++;
      if (f.dateRange) count++;
      if (f.configurationIds?.length) count++;
      if (f.milestoneIds?.length) count++;
      if (f.isCompleted !== undefined) count++;
      if (f.testRunType) count++;
    }

    if (filters.session) {
      const f = filters.session;
      if (f.projectIds?.length) count++;
      if (f.stateIds?.length) count++;
      if (f.tagIds?.length) count++;
      if (f.creatorIds?.length) count++;
      if (f.dateRange) count++;
      if (f.templateIds?.length) count++;
      if (f.assignedToIds?.length) count++;
      if (f.configurationIds?.length) count++;
      if (f.isCompleted !== undefined) count++;
    }

    if (filters.sharedStep) {
      const f = filters.sharedStep;
      if (f.projectIds?.length) count++;
      if (f.tagIds?.length) count++;
      if (f.creatorIds?.length) count++;
      if (f.dateRange) count++;
    }

    if (filters.issue) {
      const f = filters.issue;
      if (f.projectIds?.length) count++;
      if (f.stateIds?.length) count++;
      if (f.tagIds?.length) count++;
      if (f.creatorIds?.length) count++;
      if (f.dateRange) count++;
    }

    if (filters.milestone) {
      const f = filters.milestone;
      if (f.projectIds?.length) count++;
      if (f.creatorIds?.length) count++;
      if (f.dateRange) count++;
    }

    return count;
  };

  // Total available for the active tab — drives the "showing X of Y" summary
  // and whether the infinite-scroll sentinel may fetch another page.
  const totalForTab = useMemo(() => {
    if (!results) return 0;
    return selectedTab === "all"
      ? results.total
      : results.entityTypeCounts?.[selectedTab as SearchableEntityType] || 0;
  }, [results, selectedTab]);

  const hasMore =
    loadedHits.length < totalForTab && !loadMoreError && !reachedEnd;

  // Fetch the next page and append it. The cursor is the highest page loaded
  // for the current tab/query. Guard on `hasMore` so a stray trigger can't
  // fetch past the end of the result set.
  const handleLoadMore = useCallback(() => {
    if (!hasMore) return;
    void performSearch(currentPage + 1, selectedTab, { append: true });
  }, [hasMore, performSearch, currentPage, selectedTab]);

  // Full skeleton only on the first fetch; later fetches keep the list visible
  // and show an inline indicator at the bottom.
  const isInitialLoading = loading && loadedHits.length === 0;
  const isLoadingMore = loading && loadedHits.length > 0;

  const {
    scrollRef,
    sentinelRef,
    virtualItems,
    totalSize,
    measureElement,
    maxHeight,
  } = useVirtualizedInfiniteList({
    count: loadedHits.length,
    estimateSize: 140,
    overscan: 6,
    hasMore,
    isLoading: loading,
    onLoadMore: handleLoadMore,
    // Leave room for the fixed bulk-action toolbar so the last rows stay clear.
    bottomMargin: selectedCaseRows.size > 0 ? 96 : 16,
    resetKey: `${searchTrigger}:${selectedTab}`,
  });

  // Virtualized, infinite-scrolling list of the accumulated hits for the
  // active tab. One continuous scroll container — no page seam — so a bulk
  // selection can span the entire result set.
  const renderVirtualizedHits = () => (
    <div
      ref={scrollRef}
      className="relative overflow-auto"
      style={{ height: maxHeight ?? undefined }}
      data-testid="search-results-scroll"
    >
      <div className="relative w-full" style={{ height: totalSize }}>
        {virtualItems.map((vItem) => {
          const hit = loadedHits[vItem.index];
          if (!hit) return null;
          return (
            <div
              key={vItem.key}
              data-index={vItem.index}
              ref={measureElement}
              className="absolute left-0 top-0 w-full pb-2"
              style={{ transform: `translateY(${vItem.start}px)` }}
            >
              <SearchResultCard
                hit={hit}
                onClick={() => onResultClick?.(hit)}
                searchQuery={query}
                isSelected={selectedCaseRows.has(Number(hit.id))}
                onSelectToggle={
                  hit.entityType === SearchableEntityType.REPOSITORY_CASE
                    ? () => toggleCaseSelection(hit)
                    : undefined
                }
              />
            </div>
          );
        })}
      </div>

      {/* Sentinel — when it nears the viewport the hook fetches the next page. */}
      <div
        ref={sentinelRef}
        aria-hidden
        className="h-px w-full"
        data-testid="search-results-sentinel"
      />

      {isLoadingMore && (
        <div
          className="space-y-2 py-3"
          aria-label={t("common.loading")}
          data-testid="search-results-loading-more"
        >
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {loadMoreError && (
        <div className="py-4 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            data-testid="search-results-load-more-retry"
          >
            {t("search.errors.tryAgain")}
          </Button>
        </div>
      )}
    </div>
  );

  // Default result renderer with tab support over the virtualized list.
  const defaultResultRenderer = (results: UnifiedSearchResult) => {
    if (!results.hits.length && results.total === 0) {
      return (
        <div className="py-12 space-y-12">
          <div className="text-center">
            <p className="text-muted-foreground mb-2">
              {t("common.labels.noResults")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("search.results.tryAdjusting")}
            </p>
          </div>
          <div className="ml-2 border-l-8 pl-2">
            <SearchHelpContent />
          </div>
        </div>
      );
    }

    // If we have entity type counts, show tabs for all searched entity types
    const hasEntityTypeCounts =
      results.entityTypeCounts &&
      Object.keys(results.entityTypeCounts).length > 0;
    const hasMultipleTypes = selectedEntities.length > 1;

    return (
      <div>
        {hasMultipleTypes && hasEntityTypeCounts && (
          <Tabs
            value={selectedTab}
            onValueChange={(value) => {
              const newTab = value as SearchableEntityType | "all";
              setSelectedTab(newTab);
              setCurrentPage(1);
              setLoadMoreError(false);
              setReachedEnd(false);
              // Each tab loads its own page 1; the accumulated list resets as
              // the new results arrive.
              void performSearch(1, newTab, { append: false });
            }}
            className="w-full"
          >
            <TabsList className="w-full justify-start flex-wrap h-auto">
              {/* All tab */}
              <TabsTrigger value="all" className="gap-2">
                <Search className="h-4 w-4" />
                {t("search.allTypes")}
                <Badge variant="secondary" className="ml-1">
                  {results.entityTypeCounts
                    ? Object.values(results.entityTypeCounts).reduce(
                        (sum, count) => sum + count,
                        0
                      )
                    : results.total}
                </Badge>
              </TabsTrigger>

              {/* Entity type tabs */}
              {selectedEntities.map((entityType) => {
                const count = results.entityTypeCounts?.[entityType] || 0;
                if (count === 0) return null;

                return (
                  <TabsTrigger
                    key={entityType}
                    value={entityType}
                    className="gap-1"
                  >
                    <DynamicIcon
                      name={
                        getEntityIcon(
                          entityType
                        ) as keyof typeof import("lucide-react/dynamicIconImports").default
                      }
                      className="h-4 w-4"
                    />
                    {getEntityLabel(entityType)}
                    <Badge variant="secondary" className="ml-1">
                      {count}
                    </Badge>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        )}

        {totalForTab > 0 && (
          <div className="mt-4 text-sm text-muted-foreground">
            {t("common.pagination.showing")} {loadedHits.length}{" "}
            {t("common.of")} {totalForTab} {t("common.results")}
          </div>
        )}

        <div className="mt-2">{renderVirtualizedHits()}</div>
      </div>
    );
  };

  return (
    <div className={cn("space-y-4", compactMode && "space-y-2")}>
      {/* Search input with filters */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              type="text"
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10 pr-10"
              autoFocus
            />
            {query && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7"
                onClick={clearSearch}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Entity type selector button */}
          {showEntitySelector && availableEntities.length > 1 && (
            <Sheet
              open={showEntityTypeSheet}
              onOpenChange={setShowEntityTypeSheet}
            >
              <SheetTrigger asChild>
                <Button variant="outline">
                  <Settings2 className="h-4 w-4" />
                  {selectedEntitiesText}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[320px]">
                <SheetHeader>
                  <SheetTitle>{t("search.title")}</SheetTitle>
                  <SheetDescription className="sr-only">
                    {t("search.title")}
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-6">
                  <EntityTypeSelector
                    availableEntities={availableEntities}
                    selectedEntities={selectedEntities}
                    onSelectionChange={setSelectedEntities}
                  />
                </div>
              </SheetContent>
            </Sheet>
          )}

          {/* Project toggle */}
          {showProjectToggle && searchContext.projectId && (
            <div className="flex items-center gap-2">
              <Switch
                id="project-scope"
                checked={currentProjectOnly}
                onCheckedChange={setCurrentProjectOnly}
              />
              <Label htmlFor="project-scope" className="text-xs font-normal">
                {t("search.currentProjectOnly")}
              </Label>
            </div>
          )}

          {/* Faceted search filters button */}
          <Sheet open={showFilters} onOpenChange={setShowFilters}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="relative"
                data-testid="search-filters-button"
              >
                <Filter className="h-4 w-4" />
                {getActiveFilterCount() > 0 && (
                  <Badge
                    variant="destructive"
                    className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs"
                  >
                    {getActiveFilterCount()}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[400px] sm:w-[540px]">
              <SheetHeader className="sr-only">
                <SheetTitle>{t("search.filters.title")}</SheetTitle>
                <SheetDescription>{t("search.filters.title")}</SheetDescription>
              </SheetHeader>
              <FacetedSearchFilters
                entityTypes={selectedEntities}
                filters={filters}
                onFiltersChange={handleFiltersChange}
                projectId={
                  currentProjectOnly
                    ? searchContext.projectId || undefined
                    : undefined
                }
                facetCounts={results?.facets}
              />
            </SheetContent>
          </Sheet>

          {/* Saved searches */}
          {showSavedSearches && !forceEntityType && (
            <SavedSearchesMenu
              criteria={{
                query,
                filters,
                selectedEntities,
                currentProjectOnly,
              }}
              canSave={Boolean(query.trim())}
              onLoad={handleApplySavedSearch}
            />
          )}
        </div>

        {/* Active filters summary */}
        {query && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("search.results.searchingFor")}</span>
            <Badge variant="secondary">{`"${query}"`}</Badge>
            <span>{t("common.in")}</span>
            <Badge variant="secondary">{selectedEntitiesText}</Badge>
            {currentProjectOnly && searchContext.projectId && (
              <>
                <span>{t("search.results.within")}</span>
                <Badge variant="secondary">
                  {t("search.results.currentProject")}
                </Badge>
              </>
            )}
            {getActiveFilterCount() > 0 && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <Badge variant="outline" className="gap-1">
                  {getActiveFilterCount()} {t("search.filters.active")}
                </Badge>
              </>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div
        className={cn(
          "relative min-h-[200px]",
          selectedCaseRows.size > 0 && "pb-20"
        )}
      >
        {isInitialLoading && (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {error && !loading && (
          <div className="text-center py-12">
            <p className="text-destructive mb-2">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => performSearch(1, selectedTab, { append: false })}
            >
              {t("search.errors.tryAgain")}
            </Button>
          </div>
        )}

        {!isInitialLoading && !error && results && (
          <>
            {renderResults
              ? renderResults(results)
              : defaultResultRenderer(results)}
          </>
        )}

        {!loading && !error && !results && !isFirstSearch && (
          <div className="text-center py-12 text-muted-foreground">
            <p>{t("common.labels.noResults")}</p>
          </div>
        )}

        {!loading && !error && !results && isFirstSearch && query === "" && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>{t("search.startTyping")}</p>
          </div>
        )}
      </div>

      {selectedCaseRows.size > 0 && (
        <div
          className="fixed bottom-0 right-0 z-50 w-full border-t bg-background/95 shadow-lg backdrop-blur sm:max-w-3xl supports-[backdrop-filter]:bg-background/80"
          data-testid="bulk-action-toolbar"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium">
                {t("repository.duplicates.selected", {
                  count: selectedCaseRows.size,
                })}
              </span>
              {isCrossProjectSelection && (
                <span className="text-muted-foreground">
                  {t("search.bulk.crossProjectHint")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setBulkEditOpen(true)}
                      disabled={isCrossProjectSelection}
                      data-testid="bulk-edit-button"
                    >
                      <Pencil className="h-4 w-4" />
                      {t("repository.cases.bulkEdit")}
                    </Button>
                  </span>
                </TooltipTrigger>
                {isCrossProjectSelection && (
                  <TooltipContent>
                    {t("search.bulk.crossProjectDisabled")}
                  </TooltipContent>
                )}
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBulkCreateTestRun}
                      disabled={isCrossProjectSelection}
                      data-testid="bulk-create-test-run-button"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {t("repository.cases.createTestRun")}
                    </Button>
                  </span>
                </TooltipTrigger>
                {isCrossProjectSelection && (
                  <TooltipContent>
                    {t("search.bulk.crossProjectDisabled")}
                  </TooltipContent>
                )}
              </Tooltip>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearBulkSelection}
                data-testid="bulk-clear-button"
              >
                <X className="h-4 w-4" />
                {t("common.actions.clear")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {bulkEditOpen && singleSelectedProjectId != null && (
        <BulkEditModal
          isOpen={bulkEditOpen}
          onClose={() => setBulkEditOpen(false)}
          onSaveSuccess={() => {
            setBulkEditOpen(false);
            clearBulkSelection();
          }}
          selectedCaseIds={selectedCaseIdList}
          projectId={singleSelectedProjectId}
        />
      )}
    </div>
  );
}

// Individual search result card component
function SearchResultCard({
  hit,
  onClick,
  searchQuery: _searchQuery,
  isSelected = false,
  onSelectToggle,
}: {
  hit: SearchHit;
  onClick?: () => void;
  searchQuery?: string;
  isSelected?: boolean;
  /**
   * When provided, a selection checkbox is rendered before the row icon.
   * Currently only wired for `SearchableEntityType.REPOSITORY_CASE` hits by the
   * caller, so the column is invisible for other entity types.
   */
  onSelectToggle?: () => void;
}) {
  const t = useTranslations();
  const Icon = getEntityIcon(hit.entityType);

  const renderEntitySpecificInfo = () => {
    switch (hit.entityType) {
      case SearchableEntityType.REPOSITORY_CASE:
        return (
          <>
            <MetadataList
              items={[
                hit.source.projectName && hit.source.projectId && (
                  <ProjectNameDisplay
                    projectName={hit.source.projectName}
                    projectId={hit.source.projectId}
                    iconUrl={hit.source.projectIconUrl}
                  />
                ),
                hit.source.folderPath && hit.source.folderPath !== "/" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <MetadataItem className="flex items-center gap-1 text-muted-foreground min-w-0">
                        <Folder className="h-3 w-3 shrink-0" />
                        <span className="truncate">
                          {hit.source.folderPath}
                        </span>
                      </MetadataItem>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{hit.source.folderPath}</p>
                    </TooltipContent>
                  </Tooltip>
                ),
                hit.source.templateName && (
                  <MetadataItem className="flex items-center gap-1 min-w-0">
                    <DynamicIcon
                      name="layout-template"
                      className="h-3 w-3 shrink-0"
                    />
                    <span className="truncate">{hit.source.templateName}</span>
                  </MetadataItem>
                ),
                hit.source.creatorName && (
                  <UserDisplay
                    userId={hit.source.creatorId}
                    userName={hit.source.creatorName}
                    userImage={hit.source.creatorImage}
                  />
                ),
              ]}
            />
            <BadgeList
              items={[
                hit.source.stateName &&
                  (hit.source.stateIcon && hit.source.stateColor ? (
                    <WorkflowStateDisplay
                      state={{
                        name: hit.source.stateName,
                        icon: { name: hit.source.stateIcon as IconName },
                        color: { value: hit.source.stateColor },
                      }}
                      size="sm"
                    />
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      {hit.source.stateName}
                    </Badge>
                  )),
                hit.source.automated && (
                  <Badge variant="secondary" className="text-xs">
                    <DynamicIcon name="bot" className="h-3 w-3 text-primary" />
                  </Badge>
                ),
                hit.source.source && hit.source.source !== "MANUAL" && (
                  <Badge variant="outline" className="text-xs">
                    {hit.source.source}
                  </Badge>
                ),
                hit.source.estimate && (
                  <TimeEstimate
                    label={t("common.fields.estimate")}
                    seconds={hit.source.estimate}
                  />
                ),
                hit.source.tags?.length > 0 && (
                  <TagList tags={hit.source.tags} />
                ),
              ]}
            />
            {hit.source.customFields && hit.source.customFields.length > 0 && (
              <div className="mt-2">
                <CustomFieldDisplay customFields={hit.source.customFields} />
              </div>
            )}
            {hit.source.steps && hit.source.steps.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-medium text-muted-foreground mb-1.5">
                  {t("common.fields.steps")}
                  {":"}
                </div>
                <div className="space-y-1.5 text-sm text-muted-foreground">
                  {(() => {
                    // Get highlighted steps from Elasticsearch
                    const highlightedSteps =
                      hit.highlights?.["steps.step"] || [];
                    const highlightedExpectedResults =
                      hit.highlights?.["steps.expectedResult"] || [];

                    // Helper to find highlighted version of text
                    const getHighlightedText = (
                      originalText: string,
                      highlightArray: string[]
                    ): string | null => {
                      if (!originalText || !highlightArray.length) return null;

                      // Find a highlight that contains part of the original text
                      // The highlight will have <mark> tags, so strip those for comparison
                      for (const highlighted of highlightArray) {
                        const strippedHighlight = highlighted.replace(
                          /<\/?mark[^>]*>/gi,
                          ""
                        );
                        // If the stripped highlight contains the original text or vice versa, use it
                        if (
                          strippedHighlight.includes(originalText) ||
                          originalText.includes(strippedHighlight)
                        ) {
                          return highlighted;
                        }
                      }
                      return null;
                    };

                    return hit.source.steps
                      .slice(0, 3)
                      .map((step: any, index: number) => {
                        // Get highlighted versions from Elasticsearch
                        const highlightedStep = getHighlightedText(
                          step.step,
                          highlightedSteps
                        );
                        const highlightedExpectedResult = getHighlightedText(
                          step.expectedResult,
                          highlightedExpectedResults
                        );

                        // Determine if this step has highlights
                        const hasHighlights =
                          highlightedStep || highlightedExpectedResult;

                        return (
                          <div
                            key={step.id || index}
                            className={cn(
                              "flex gap-2 rounded px-2 py-1",
                              hasHighlights &&
                                "bg-yellow-50 dark:bg-yellow-900/20 border-l-2 border-yellow-400"
                            )}
                          >
                            <span className="font-medium shrink-0">
                              {index + 1}
                              {"."}
                            </span>
                            <div className="min-w-0">
                              {step.step && (
                                <div className="truncate">
                                  {highlightedStep ? (
                                    <span
                                      dangerouslySetInnerHTML={{
                                        __html: highlightedStep,
                                      }}
                                    />
                                  ) : (
                                    step.step
                                  )}
                                </div>
                              )}
                              {step.expectedResult && (
                                <div className="text-xs italic truncate">
                                  {"→ "}
                                  {highlightedExpectedResult ? (
                                    <span
                                      dangerouslySetInnerHTML={{
                                        __html: highlightedExpectedResult,
                                      }}
                                    />
                                  ) : (
                                    step.expectedResult
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      });
                  })()}
                  {hit.source.steps.length > 3 && (
                    <div className="text-xs">
                      {"+"}
                      {hit.source.steps.length - 3}{" "}
                      {t("common.ui.breadcrumb.more")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        );

      case SearchableEntityType.SHARED_STEP:
        return (
          <MetadataList
            items={[
              hit.source.projectName && hit.source.projectId && (
                <ProjectNameDisplay
                  projectName={hit.source.projectName}
                  projectId={hit.source.projectId}
                  iconUrl={hit.source.projectIconUrl}
                />
              ),
              hit.source.items?.length > 0 && (
                <MetadataItem>
                  {hit.source.items.length} {t("common.fields.steps")}
                </MetadataItem>
              ),
              hit.source.createdByName && (
                <UserDisplay
                  userId={hit.source.createdById}
                  userName={hit.source.createdByName}
                  userImage={hit.source.createdByImage}
                />
              ),
            ]}
          />
        );

      case SearchableEntityType.TEST_RUN:
        return (
          <>
            <MetadataList
              items={[
                hit.source.projectName && hit.source.projectId && (
                  <ProjectNameDisplay
                    projectName={hit.source.projectName}
                    projectId={hit.source.projectId}
                    iconUrl={hit.source.projectIconUrl}
                  />
                ),
                hit.source.milestoneName && (
                  <MetadataItem>{hit.source.milestoneName}</MetadataItem>
                ),
                hit.source.configurationName && (
                  <MetadataItem>{hit.source.configurationName}</MetadataItem>
                ),
              ]}
            />
            <BadgeList
              items={[
                hit.source.stateName &&
                  (hit.source.stateIcon && hit.source.stateColor ? (
                    <WorkflowStateDisplay
                      state={{
                        name: hit.source.stateName,
                        icon: { name: hit.source.stateIcon as IconName },
                        color: { value: hit.source.stateColor },
                      }}
                      size="sm"
                    />
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      {hit.source.stateName}
                    </Badge>
                  )),
                hit.source.isCompleted !== undefined && (
                  <StatusBadge
                    isCompleted={hit.source.isCompleted}
                    completedText={t("common.fields.completed")}
                    activeText={t("common.fields.isActive")}
                  />
                ),
                hit.source.elapsed && (
                  <TimeEstimate
                    label={t("common.fields.elapsed")}
                    seconds={hit.source.elapsed}
                  />
                ),
              ]}
            />
          </>
        );

      case SearchableEntityType.SESSION:
        return (
          <>
            <MetadataList
              items={[
                hit.source.projectName && hit.source.projectId && (
                  <ProjectNameDisplay
                    projectName={hit.source.projectName}
                    projectId={hit.source.projectId}
                    iconUrl={hit.source.projectIconUrl}
                  />
                ),
                hit.source.templateName && (
                  <MetadataItem className="flex items-center gap-1 min-w-0">
                    <DynamicIcon
                      name="layout-template"
                      className="h-3 w-3 shrink-0"
                    />
                    <span className="truncate">{hit.source.templateName}</span>
                  </MetadataItem>
                ),
                hit.source.assignedToName && (
                  <UserDisplay
                    userId={hit.source.assignedToId}
                    userName={hit.source.assignedToName}
                    userImage={hit.source.assignedToImage}
                  />
                ),
              ]}
            />
            <BadgeList
              items={[
                hit.source.stateName &&
                  (hit.source.stateIcon && hit.source.stateColor ? (
                    <WorkflowStateDisplay
                      state={{
                        name: hit.source.stateName,
                        icon: { name: hit.source.stateIcon as IconName },
                        color: { value: hit.source.stateColor },
                      }}
                      size="sm"
                    />
                  ) : (
                    <Badge variant="secondary" className="text-xs">
                      {hit.source.stateName}
                    </Badge>
                  )),
                hit.source.isCompleted !== undefined && (
                  <StatusBadge
                    isCompleted={hit.source.isCompleted}
                    completedText={t("common.fields.completed")}
                    activeText={t("common.fields.isActive")}
                  />
                ),
                hit.source.estimate && (
                  <TimeEstimate
                    label={t("common.fields.estimate")}
                    seconds={hit.source.estimate}
                  />
                ),
              ]}
            />
          </>
        );

      case SearchableEntityType.PROJECT:
        return (
          <MetadataList
            items={[
              hit.source.createdByName && (
                <UserDisplay
                  userId={hit.source.createdById}
                  userName={hit.source.createdByName}
                  userImage={hit.source.createdByImage}
                />
              ),
              hit.source.createdAt && (
                <DateDisplay date={hit.source.createdAt} />
              ),
            ]}
          />
        );

      case SearchableEntityType.ISSUE:
        return (
          <>
            <MetadataList
              items={[
                hit.source.projectName && hit.source.projectId && (
                  <ProjectNameDisplay
                    projectName={hit.source.projectName}
                    projectId={hit.source.projectId}
                    iconUrl={hit.source.projectIconUrl}
                  />
                ),
                hit.source.issueSystem && (
                  <MetadataItem>{hit.source.issueSystem}</MetadataItem>
                ),
                hit.source.externalId && (
                  <Badge variant="outline" className="text-xs">
                    {hit.source.externalId}
                  </Badge>
                ),
              ]}
            />
            {hit.source.url && <ExternalLink url={hit.source.url} />}
          </>
        );

      case SearchableEntityType.MILESTONE:
        return (
          <>
            <MetadataList
              items={[
                hit.source.projectName && hit.source.projectId && (
                  <ProjectNameDisplay
                    projectName={hit.source.projectName}
                    projectId={hit.source.projectId}
                    iconUrl={hit.source.projectIconUrl}
                  />
                ),
                hit.source.milestoneTypeName && (
                  <MetadataItem className="flex items-center gap-1 min-w-0">
                    <DynamicIcon
                      name="layout-template"
                      className="h-3 w-3 shrink-0"
                    />
                    <span className="truncate">
                      {hit.source.milestoneTypeName}
                    </span>
                  </MetadataItem>
                ),
                hit.source.parentName && (
                  <MetadataItem>
                    {t("common.ui.search.parent")}
                    {": "}
                    {hit.source.parentName}
                  </MetadataItem>
                ),
              ]}
            />
            <BadgeList
              items={[
                hit.source.isCompleted !== undefined && (
                  <StatusBadge
                    isCompleted={hit.source.isCompleted}
                    completedText={t("common.fields.completed")}
                    activeText={t("common.fields.isActive")}
                  />
                ),
                hit.source.dueDate && (
                  <DateDisplay
                    date={hit.source.dueDate}
                    label={t("milestones.fields.dueDate")}
                  />
                ),
              ]}
            />
          </>
        );

      default:
        return (
          <MetadataList
            items={[
              hit.source.projectName && hit.source.projectId && (
                <ProjectNameDisplay
                  projectName={hit.source.projectName}
                  projectId={hit.source.projectId}
                  iconUrl={hit.source.projectIconUrl}
                />
              ),
              hit.source.stateName && (
                <Badge variant="secondary" className="text-xs">
                  {hit.source.stateName}
                </Badge>
              ),
            ]}
          />
        );
    }
  };

  return (
    <Card
      className={cn(
        "p-4 cursor-pointer hover:shadow-md transition-all hover:border-primary/50",
        hit.source.isDeleted &&
          "bg-destructive/10 border-destructive/20 hover:border-destructive/50",
        isSelected && "border-primary/50 bg-primary/5"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {onSelectToggle && (
          <div
            className="mt-1"
            onClick={(e) => {
              e.stopPropagation();
              onSelectToggle();
            }}
          >
            <Checkbox
              checked={isSelected}
              aria-label={t("repository.duplicates.selectRow")}
              data-testid={`bulk-select-${hit.entityType}-${hit.id}`}
            />
          </div>
        )}
        <div className="mt-1">
          <DynamicIcon
            name={
              Icon as keyof typeof import("lucide-react/dynamicIconImports").default
            }
            className="h-5 w-5 text-muted-foreground"
          />
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-medium line-clamp-1 flex items-center gap-2">
              {hit.entityType === SearchableEntityType.PROJECT &&
                hit.source.iconUrl && (
                  <ProjectIcon
                    iconUrl={hit.source.iconUrl}
                    width={20}
                    height={20}
                  />
                )}
              {hit.entityType === SearchableEntityType.REPOSITORY_CASE ? (
                <TestCaseSearchResult
                  testCase={{
                    id: hit.source.id,
                    name: hit.source.name,
                    source: hit.source.source,
                    isDeleted: hit.source.isDeleted,
                  }}
                  highlight={hit.highlights?.name?.[0]}
                  showIcon={false}
                />
              ) : hit.entityType === SearchableEntityType.MILESTONE &&
                hit.source.milestoneTypeIcon ? (
                <>
                  <DynamicIcon
                    name={hit.source.milestoneTypeIcon}
                    className="h-4 w-4 shrink-0"
                  />
                  {hit.highlights?.name?.[0] ? (
                    <span
                      dangerouslySetInnerHTML={{
                        __html: hit.highlights.name[0],
                      }}
                    />
                  ) : (
                    hit.source.name
                  )}
                </>
              ) : hit.highlights?.name?.[0] ? (
                <span
                  dangerouslySetInnerHTML={{ __html: hit.highlights.name[0] }}
                />
              ) : (
                hit.source.name
              )}
            </h4>
            <Badge variant="outline" className="ml-2 shrink-0">
              {getEntityLabel(hit.entityType)}
            </Badge>
            {hit.source.isDeleted && (
              <Badge variant="destructive" className="ml-2 shrink-0">
                {t("common.status.deleted")}
              </Badge>
            )}
          </div>

          {renderEntitySpecificInfo()}

          {/* Only show searchableContent highlights if there are no step-specific matches to avoid redundancy */}
          {!hit.highlights?.["steps.step"] &&
            !hit.highlights?.["steps.expectedResult"] && (
              <SearchHighlight
                highlights={hit.highlights}
                field="searchableContent"
              />
            )}
        </div>
      </div>
    </Card>
  );
}
