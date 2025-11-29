"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, X, Filter as FilterIcon, Loader2 } from "lucide-react";
import { useDebounce } from "@/components/Debounce";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslations } from "next-intl";

interface SearchFilters {
  projectIds?: number[];
  repositoryIds?: number[];
  folderIds?: number[];
  templateIds?: number[];
  stateIds?: number[];
  tagIds?: number[];
  creatorIds?: string[];
  automated?: boolean;
  isArchived?: boolean;
  dateRange?: {
    field: "createdAt";
    from?: Date;
    to?: Date;
  };
  customFields?: Array<{
    fieldId: number;
    value: any;
  }>;
}

interface SearchOptions {
  query?: string;
  filters?: SearchFilters;
  sort?: {
    field: string;
    order: "asc" | "desc";
  }[];
  pagination?: {
    page: number;
    size: number;
  };
  highlight?: boolean;
  facets?: string[];
}

interface SearchFacet {
  field: string;
  buckets: Array<{
    key: any;
    count: number;
  }>;
}

interface SearchResult {
  total: number;
  hits: Array<{
    id: number;
    score: number;
    source: any;
    highlights?: Record<string, string[]>;
  }>;
  facets?: Record<string, SearchFacet>;
  took: number;
}

interface RepositoryCaseSearchProps {
  onResultsChange: (results: SearchResult) => void;
  projectId?: number;
  initialFilters?: SearchFilters;
  showFacets?: boolean;
  compactMode?: boolean;
  renderResults?: (results: SearchResult) => React.ReactNode;
  onResultClick?: (result: any) => void;
}

type FilterType = keyof SearchFilters;

const FACET_FIELDS = [
  "projectId",
  "templateId",
  "stateId",
  "creatorId",
  "tags",
  "automated",
] as const;

export function RepositoryCaseSearch({
  onResultsChange,
  projectId,
  initialFilters = {},
  showFacets = true,
  compactMode = false,
  renderResults,
  onResultClick,
}: RepositoryCaseSearchProps) {
  const t = useTranslations("common.ui.search");
  const tCommon = useTranslations("common");

  // State management
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>(
    projectId ? { ...initialFilters, projectIds: [projectId] } : initialFilters
  );
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Perform search
  const performSearch = useCallback(async () => {
    setIsLoading(true);
    try {
      const searchOptions: SearchOptions = {
        query: debouncedSearchQuery,
        filters,
        pagination: {
          page: currentPage,
          size: pageSize,
        },
        highlight: true,
        facets: showFacets ? [...FACET_FIELDS] : undefined,
      };

      const response = await fetch("/api/repository-cases/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(searchOptions),
      });

      if (!response.ok) {
        throw new Error("Search failed");
      }

      const results = await response.json();
      setSearchResults(results);
      onResultsChange(results);
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [
    debouncedSearchQuery,
    filters,
    currentPage,
    pageSize,
    showFacets,
    onResultsChange,
  ]);

  // Fetch suggestions
  const fetchSuggestions = useCallback(async (prefix: string) => {
    if (prefix.length < 2) {
      setSuggestions([]);
      return;
    }

    try {
      const response = await fetch(
        `/api/repository-cases/search?prefix=${encodeURIComponent(prefix)}&size=5`
      );

      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (error) {
      console.error("Failed to fetch suggestions:", error);
      setSuggestions([]);
    }
  }, []);

  // Effects
  useEffect(() => {
    performSearch();
  }, [performSearch]);

  useEffect(() => {
    if (debouncedSearchQuery) {
      fetchSuggestions(debouncedSearchQuery);
    } else {
      setSuggestions([]);
    }
  }, [debouncedSearchQuery, fetchSuggestions]);

  // Filter management
  const updateFilter = useCallback((filterType: FilterType, value: any) => {
    setFilters((prev) => ({
      ...prev,
      [filterType]: value,
    }));
    setCurrentPage(1); // Reset to first page when filters change
  }, []);

  const clearFilter = useCallback((filterType: FilterType) => {
    setFilters((prev) => {
      const newFilters = { ...prev };
      delete newFilters[filterType];
      return newFilters;
    });
    setCurrentPage(1);
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters(projectId ? { projectIds: [projectId] } : {});
    setSearchQuery("");
    setCurrentPage(1);
  }, [projectId]);

  // Count active filters
  const activeFilterCount = useMemo(() => {
    return Object.keys(filters).filter((key) => {
      const value = filters[key as FilterType];
      if (Array.isArray(value)) return value.length > 0;
      return value !== undefined;
    }).length;
  }, [filters]);

  // Render filter content
  const renderFilterContent = () => (
    <div className="space-y-4">
      {/* Projects Filter */}
      {!projectId && searchResults?.facets?.projectId && (
        <div>
          <h4 className="mb-2 text-sm font-medium">{t("projects")}</h4>
          <ScrollArea className="h-48">
            <div className="space-y-2">
              {searchResults.facets.projectId.buckets.map((bucket) => (
                <label
                  key={bucket.key}
                  className="flex items-center space-x-2 text-sm"
                >
                  <Checkbox
                    checked={filters.projectIds?.includes(bucket.key) || false}
                    onCheckedChange={(checked) => {
                      const currentIds = filters.projectIds || [];
                      if (checked) {
                        updateFilter("projectIds", [...currentIds, bucket.key]);
                      } else {
                        updateFilter(
                          "projectIds",
                          currentIds.filter((id) => id !== bucket.key)
                        );
                      }
                    }}
                  />
                  <span className="flex-1">{bucket.key}</span>
                  <span className="text-muted-foreground">{`(${bucket.count})`}</span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Templates Filter */}
      {searchResults?.facets?.templateId && (
        <div>
          <h4 className="mb-2 text-sm font-medium">{t("templates")}</h4>
          <ScrollArea className="h-48">
            <div className="space-y-2">
              {searchResults.facets.templateId.buckets.map((bucket) => (
                <label
                  key={bucket.key}
                  className="flex items-center space-x-2 text-sm"
                >
                  <Checkbox
                    checked={filters.templateIds?.includes(bucket.key) || false}
                    onCheckedChange={(checked) => {
                      const currentIds = filters.templateIds || [];
                      if (checked) {
                        updateFilter("templateIds", [
                          ...currentIds,
                          bucket.key,
                        ]);
                      } else {
                        updateFilter(
                          "templateIds",
                          currentIds.filter((id) => id !== bucket.key)
                        );
                      }
                    }}
                  />
                  <span className="flex-1">{bucket.key}</span>
                  <span className="text-muted-foreground">{`(${bucket.count})`}</span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* States Filter */}
      {searchResults?.facets?.stateId && (
        <div>
          <h4 className="mb-2 text-sm font-medium">{t("states")}</h4>
          <ScrollArea className="h-48">
            <div className="space-y-2">
              {searchResults.facets.stateId.buckets.map((bucket) => (
                <label
                  key={bucket.key}
                  className="flex items-center space-x-2 text-sm"
                >
                  <Checkbox
                    checked={filters.stateIds?.includes(bucket.key) || false}
                    onCheckedChange={(checked) => {
                      const currentIds = filters.stateIds || [];
                      if (checked) {
                        updateFilter("stateIds", [...currentIds, bucket.key]);
                      } else {
                        updateFilter(
                          "stateIds",
                          currentIds.filter((id) => id !== bucket.key)
                        );
                      }
                    }}
                  />
                  <span className="flex-1">{bucket.key}</span>
                  <span className="text-muted-foreground">{`(${bucket.count})`}</span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Tags Filter */}
      {searchResults?.facets?.tags && (
        <div>
          <h4 className="mb-2 text-sm font-medium">{t("tags")}</h4>
          <ScrollArea className="h-48">
            <div className="space-y-2">
              {searchResults.facets.tags.buckets.map((bucket) => (
                <label
                  key={bucket.key}
                  className="flex items-center space-x-2 text-sm"
                >
                  <Checkbox
                    checked={filters.tagIds?.includes(bucket.key) || false}
                    onCheckedChange={(checked) => {
                      const currentIds = filters.tagIds || [];
                      if (checked) {
                        updateFilter("tagIds", [...currentIds, bucket.key]);
                      } else {
                        updateFilter(
                          "tagIds",
                          currentIds.filter((id) => id !== bucket.key)
                        );
                      }
                    }}
                  />
                  <span className="flex-1">{bucket.key}</span>
                  <span className="text-muted-foreground">{`(${bucket.count})`}</span>
                </label>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Automation Status Filter */}
      <div>
        <h4 className="mb-2 text-sm font-medium">{t("automationStatus")}</h4>
        <div className="space-y-2">
          <label className="flex items-center space-x-2 text-sm">
            <Checkbox
              checked={filters.automated === true}
              onCheckedChange={(checked) => {
                updateFilter("automated", checked ? true : undefined);
              }}
            />
            <span>{t("automated")}</span>
          </label>
          <label className="flex items-center space-x-2 text-sm">
            <Checkbox
              checked={filters.automated === false}
              onCheckedChange={(checked) => {
                updateFilter("automated", checked ? false : undefined);
              }}
            />
            <span>{t("manual")}</span>
          </label>
        </div>
      </div>

      {/* Clear Filters */}
      {activeFilterCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={clearAllFilters}
          className="w-full"
        >
          <X className="mr-2 h-4 w-4" />
          {`Clear Filters (${activeFilterCount})`}
        </Button>
      )}
    </div>
  );

  return (
    <div className={compactMode ? "space-y-2" : "space-y-4"}>
      {/* Search Input */}
      <div className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search repository cases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Autocomplete Suggestions */}
        {showSuggestions && suggestions.length > 0 && (
          <Card className="absolute z-10 mt-1 w-full">
            <CardContent className="p-0">
              <ul className="py-1">
                {suggestions.map((suggestion, index) => (
                  <li
                    key={index}
                    className="cursor-pointer px-3 py-2 text-sm hover:bg-accent"
                    onMouseDown={() => {
                      setSearchQuery(suggestion);
                      setShowSuggestions(false);
                    }}
                  >
                    {suggestion}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Filters Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Active Filter Badges */}
          {filters.projectIds?.map((id) => (
            <Badge key={`project-${id}`} variant="secondary">
              {`Project: ${id}`}
              <button
                onClick={() => {
                  const newIds = filters.projectIds!.filter(
                    (pid) => pid !== id
                  );
                  if (newIds.length === 0) {
                    clearFilter("projectIds");
                  } else {
                    updateFilter("projectIds", newIds);
                  }
                }}
                className="ml-1"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}

          {filters.automated !== undefined && (
            <Badge variant="secondary">
              {filters.automated ? "Automated" : "Manual"}
              <button onClick={() => clearFilter("automated")} className="ml-1">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>

        {/* Desktop Filters */}
        {showFacets && !compactMode && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <FilterIcon className="mr-2 h-4 w-4" />
                {t("filters")}
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              {renderFilterContent()}
            </PopoverContent>
          </Popover>
        )}

        {/* Mobile Filters */}
        {showFacets && compactMode && (
          <Sheet
            open={isMobileFiltersOpen}
            onOpenChange={setIsMobileFiltersOpen}
          >
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <FilterIcon className="mr-2 h-4 w-4" />
                {t("filters")}
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{t("filters")}</SheetTitle>
              </SheetHeader>
              <div className="mt-4">{renderFilterContent()}</div>
            </SheetContent>
          </Sheet>
        )}
      </div>

      {/* Results Summary */}
      {searchResults && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {`Showing ${searchResults.hits.length} of ${searchResults.total} results (${(searchResults.took / 1000).toFixed(2)}s)`}
          </span>
          {searchResults.total > pageSize && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                {tCommon("actions.previous")}
              </Button>
              <span>
                {`Page ${currentPage} / ${Math.ceil(searchResults.total / pageSize)}`}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => p + 1)}
                disabled={currentPage * pageSize >= searchResults.total}
              >
                {tCommon("actions.next")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      )}

      {/* Search Results */}
      {!isLoading && searchResults && renderResults && (
        <div className="mt-4">{renderResults(searchResults)}</div>
      )}

      {/* Default Results Display */}
      {!isLoading &&
        searchResults &&
        !renderResults &&
        searchResults.hits.length > 0 && (
          <div className="mt-4 space-y-2">
            {searchResults.hits.map((hit) => (
              <Card
                key={hit.id}
                className={
                  onResultClick
                    ? "cursor-pointer hover:shadow-md transition-shadow"
                    : ""
                }
                onClick={() => onResultClick && onResultClick(hit)}
              >
                <CardContent className="p-4">
                  <h4 className="font-medium mb-1">
                    {hit.highlights?.name?.[0] ? (
                      <span
                        dangerouslySetInnerHTML={{
                          __html: hit.highlights.name[0],
                        }}
                      />
                    ) : (
                      hit.source.name
                    )}
                  </h4>
                  {hit.source.projectName && (
                    <p className="text-sm text-muted-foreground">
                      {hit.source.projectName}
                      {hit.source.folderPath && ` / ${hit.source.folderPath}`}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

      {/* No Results */}
      {!isLoading &&
        searchResults &&
        searchResults.hits.length === 0 &&
        searchQuery && (
          <div className="text-center py-8 text-muted-foreground">
            {t("noResultsFound")}
          </div>
        )}
    </div>
  );
}
