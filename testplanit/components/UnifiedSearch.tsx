"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Folder,
  Settings2,
} from "lucide-react";
import { useDebounce } from "@/components/Debounce";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  SearchableEntityType,
  SearchOptions,
  UnifiedSearchResult,
  UnifiedSearchFilters,
  SearchHit,
} from "~/types/search";
import {
  useSearchContext,
  getEntityLabel,
  getEntityIcon,
} from "~/hooks/useSearchContext";
import DynamicIcon from "@/components/DynamicIcon";
import { cn } from "~/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { FacetedSearchFilters } from "@/components/search/FacetedSearchFilters";
import { Filter } from "lucide-react";
import { useTranslations } from "next-intl";
import { useSearchState } from "~/lib/contexts/SearchStateContext";
import {
  MetadataList,
  MetadataItem,
  StatusBadge,
  TimeEstimate,
  TagList,
  BadgeList,
  ExternalLink,
  DateDisplay,
  SearchHighlight,
} from "@/components/search/SearchResultComponents";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { ProjectIcon } from "@/components/ProjectIcon";
import { UserDisplay } from "@/components/search/UserDisplay";
import { TestCaseSearchResult } from "@/components/search/TestCaseSearchResult";
import { WorkflowStateDisplay } from "@/components/WorkflowStateDisplay";
import { IconName } from "~/types/globals";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CustomFieldDisplay } from "@/components/search/CustomFieldDisplay";
import { EntityTypeSelector } from "@/components/EntityTypeSelector";

interface UnifiedSearchProps {
  // Context overrides
  forceEntityType?: SearchableEntityType;
  forceProjectId?: number;

  // UI options
  showEntitySelector?: boolean;
  showProjectToggle?: boolean;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFirstSearch, setIsFirstSearch] = useState(!searchState?.results);
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

  // Search function
  const performSearch = useCallback(
    async (page: number = 1, forSpecificTab?: SearchableEntityType | "all") => {
      // Don't search if query is empty
      if (!debouncedQuery.trim()) {
        setResults(null);
        return;
      }

      setLoading(true);
      setError(null);

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

        setResults(data);
        setCurrentPage(page);
        setIsFirstSearch(false);
        onResultsChange?.(data);
      } catch (err) {
        console.error("Search error:", err);
        setError(t("search.errors.searchFailed"));
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

  // Trigger search when query or filters change
  useEffect(() => {
    setCurrentPage(1); // Reset pagination
    setSelectedTab("all"); // Reset to all tab
    setSearchTrigger((prev) => prev + 1); // Trigger search
  }, [debouncedQuery, filters, selectedEntities, currentProjectOnly]);

  // Perform search when triggered or when tab/page changes
  useEffect(() => {
    if (debouncedQuery.trim() && searchTrigger > 0) {
      performSearch(currentPage, selectedTab);
    } else if (!debouncedQuery.trim()) {
      setResults(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTrigger, currentPage, selectedTab]);

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
    setError(null);
    setIsFirstSearch(true);
    setCurrentPage(1);
  };

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

  // Pagination calculations based on selected tab
  const { totalForTab, totalPagesForTab, showingFromForTab, showingToForTab } =
    useMemo(() => {
      if (!results)
        return {
          totalForTab: 0,
          totalPagesForTab: 0,
          showingFromForTab: 0,
          showingToForTab: 0,
        };

      // Calculate totals based on selected tab
      const total =
        selectedTab === "all"
          ? results.total
          : results.entityTypeCounts?.[selectedTab as SearchableEntityType] ||
            0;

      const totalPages = Math.ceil(total / pageSize);
      const showingFrom = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
      const showingTo =
        total === 0 ? 0 : Math.min(currentPage * pageSize, total);

      return {
        totalForTab: total,
        totalPagesForTab: totalPages,
        showingFromForTab: showingFrom,
        showingToForTab: showingTo,
      };
    }, [results, selectedTab, currentPage, pageSize]);

  // Default result renderer with proper tab support
  const defaultResultRenderer = (results: UnifiedSearchResult) => {
    if (!results.hits.length && results.total === 0) {
      return (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">
            {t("search.results.noResults")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("search.results.tryAdjusting")}
          </p>
        </div>
      );
    }

    // If we have entity type counts, show tabs for all searched entity types
    const hasEntityTypeCounts =
      results.entityTypeCounts &&
      Object.keys(results.entityTypeCounts).length > 0;
    const hasMultipleTypes = selectedEntities.length > 1;

    if (hasMultipleTypes && hasEntityTypeCounts) {
      // Filter results for the selected tab
      const filteredHits =
        selectedTab === "all"
          ? results.hits
          : results.hits.filter((hit) => hit.entityType === selectedTab);

      return (
        <div>
          <Tabs
            value={selectedTab}
            onValueChange={(value) => {
              const newTab = value as SearchableEntityType | "all";
              setSelectedTab(newTab);
              setCurrentPage(1); // Reset to first page when changing tabs
              // Perform search for the specific tab
              performSearch(1, newTab);
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

          {/* Results for selected tab */}
          <div className="mt-4 space-y-2">
            {filteredHits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>{t("search.results.noResults")}</p>
              </div>
            ) : (
              filteredHits.map((hit) => (
                <SearchResultCard
                  key={`${hit.entityType}-${hit.id}`}
                  hit={hit}
                  onClick={() => onResultClick?.(hit)}
                />
              ))
            )}
          </div>
        </div>
      );
    } else {
      // Single entity type or no counts - show results directly
      return (
        <div className="space-y-2">
          {results.hits.map((hit) => (
            <SearchResultCard
              key={`${hit.entityType}-${hit.id}`}
              hit={hit}
              onClick={() => onResultClick?.(hit)}
            />
          ))}
        </div>
      );
    }
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
                <Button variant="outline" className="gap-1">
                  <Settings2 className="h-4 w-4" />
                  {selectedEntitiesText}
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[320px]">
                <SheetHeader>
                  <SheetTitle>
                    {t("search.entityTypes.repositoryCase").replace(
                      "Repository Cases",
                      "Select Entity Types"
                    )}
                  </SheetTitle>
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
        </div>

        {/* Active filters summary */}
        {query && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("search.results.searchingFor")}</span>
            <Badge variant="secondary">{`"${query}"`}</Badge>
            <span>{t("search.results.in")}</span>
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
      <div className="relative min-h-[200px]">
        {loading && (
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
              onClick={() => performSearch(currentPage, selectedTab)}
            >
              {t("search.errors.tryAgain")}
            </Button>
          </div>
        )}

        {!loading && !error && results && (
          <>
            {renderResults
              ? renderResults(results)
              : defaultResultRenderer(results)}

            {/* Pagination controls */}
            {totalPagesForTab > 1 && (
              <div className="mt-6 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {t("search.results.showing")} {showingFromForTab}-
                  {showingToForTab} {t("search.results.of")} {totalForTab}{" "}
                  {t("search.results.results")}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => performSearch(1, selectedTab)}
                    disabled={currentPage === 1}
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => performSearch(currentPage - 1, selectedTab)}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  <div className="flex items-center gap-1">
                    <span className="text-sm">{t("search.results.page")}</span>
                    <Input
                      type="number"
                      min={1}
                      max={totalPagesForTab}
                      value={currentPage}
                      onChange={(e) => {
                        const page = parseInt(e.target.value) || 1;
                        if (page >= 1 && page <= totalPagesForTab) {
                          performSearch(page, selectedTab);
                        }
                      }}
                      className="w-16 h-9 text-center"
                    />
                    <span className="text-sm">
                      {t("search.results.of")} {totalPagesForTab}
                    </span>
                  </div>

                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => performSearch(currentPage + 1, selectedTab)}
                    disabled={currentPage === totalPagesForTab}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => performSearch(totalPagesForTab, selectedTab)}
                    disabled={currentPage === totalPagesForTab}
                  >
                    <ChevronsRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {!loading && !error && !results && !isFirstSearch && (
          <div className="text-center py-12 text-muted-foreground">
            <p>{t("search.results.noResults")}</p>
          </div>
        )}

        {!loading && !error && !results && isFirstSearch && query === "" && (
          <div className="text-center py-12 text-muted-foreground">
            <Search className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>{t("search.startTyping")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Individual search result card component
function SearchResultCard({
  hit,
  onClick,
}: {
  hit: SearchHit;
  onClick?: () => void;
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
                  <TooltipProvider>
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
                  </TooltipProvider>
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
              <CustomFieldDisplay customFields={hit.source.customFields} />
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
                    completedText={t("common.status.completed")}
                    activeText={t("common.status.active")}
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
                    completedText={t("common.status.completed")}
                    activeText={t("common.status.active")}
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
                    {t("common.ui.search.parent")}: {hit.source.parentName}
                  </MetadataItem>
                ),
              ]}
            />
            <BadgeList
              items={[
                hit.source.isCompleted !== undefined && (
                  <StatusBadge
                    isCompleted={hit.source.isCompleted}
                    completedText={t("common.status.completed")}
                    activeText={t("common.status.active")}
                  />
                ),
                hit.source.dueDate && (
                  <DateDisplay date={hit.source.dueDate} label="Due" />
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
          "bg-destructive/10 border-destructive/20 hover:border-destructive/50"
      )}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
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

          <SearchHighlight
            highlights={hit.highlights}
            field="searchableContent"
          />
        </div>
      </div>
    </Card>
  );
}
