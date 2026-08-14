import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePageSizeOptions } from "~/hooks/usePageSizeOptions";
import { usePagination } from "~/lib/contexts/PaginationContext";
import JunitFilterBar, {
  junitFacetsActive,
  type JunitFacetFilters,
  type JunitFacetOption,
} from "./JunitFilterBar";
import { getJunitColumns } from "./junitColumns";

interface JunitResultsPanelProps {
  t: (key: string) => string;
  projectId: string;
  runId: string;
  jUnitSuites: any[] | undefined;
  sortedJunitTestCases: any[];
  junitSortConfig:
    { column: string; direction: "asc" | "desc" } | null | undefined;
  handleJunitSortChange: (column: string) => void;
  onSortColumn?: (column: string, direction: "asc" | "desc" | null) => void;
  isJUnitLoading: boolean;
  selectedTestCaseId: number | null;
  facets: JunitFacetFilters;
  onFacetsChange: (next: JunitFacetFilters) => void;
}

/**
 * The left panel of a JUnit (automated) test run: the results table with its
 * filter, column selection and pagination. Content only — it renders inside the
 * shared run-details shell in `page.tsx`. The JUnit run STATE (suites, sorted
 * cases, sort config) is owned by `page.tsx` and passed in; this component owns
 * only the local filter / pagination / column-visibility / result-attachment
 * state. Must be rendered inside a `PaginationProvider`.
 */
export default function JunitResultsPanel({
  t,
  projectId,
  runId,
  jUnitSuites,
  sortedJunitTestCases,
  junitSortConfig,
  handleJunitSortChange,
  onSortColumn,
  isJUnitLoading,
  selectedTestCaseId,
  facets,
  onFacetsChange,
}: JunitResultsPanelProps) {
  const { data: session } = useSession();
  const [junitFilter, setJunitFilter] = useState("");
  const [junitColumnVisibility, setJunitColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const hideColumnRef = useRef<((columnId: string) => void) | null>(null);
  const {
    currentPage: junitPage,
    setCurrentPage: setJunitPage,
    pageSize: junitPageSize,
    setPageSize: setJunitPageSize,
    totalItems,
    setTotalItems,
    totalPages,
    startIndex,
    endIndex,
  } = usePagination();

  // Facet options with attempt-row counts; flaky/retried count distinct cases.
  const { statusOptions, suiteOptions, flakyCaseCount, retriedCaseCount } =
    useMemo(() => {
      const statusCounts = new Map<string, number>();
      const suiteCounts = new Map<string, number>();
      const flakyCases = new Set<number | string>();
      const retriedCases = new Set<number | string>();
      for (const tc of sortedJunitTestCases) {
        if (tc.resultStatus) {
          statusCounts.set(
            tc.resultStatus,
            (statusCounts.get(tc.resultStatus) ?? 0) + 1
          );
        }
        if (tc.suiteName) {
          suiteCounts.set(
            tc.suiteName,
            (suiteCounts.get(tc.suiteName) ?? 0) + 1
          );
        }
        if (tc.isFlaky) flakyCases.add(tc.id);
        if (tc.isRetried) retriedCases.add(tc.id);
      }
      const toOptions = (counts: Map<string, number>): JunitFacetOption[] =>
        Array.from(counts, ([value, count]) => ({ value, count })).sort(
          (a, b) => a.value.localeCompare(b.value)
        );
      return {
        statusOptions: toOptions(statusCounts),
        suiteOptions: toOptions(suiteCounts),
        flakyCaseCount: flakyCases.size,
        retriedCaseCount: retriedCases.size,
      };
    }, [sortedJunitTestCases]);

  const facetFilteredJunitTestCases = useMemo(() => {
    if (!junitFacetsActive(facets)) return sortedJunitTestCases;
    return sortedJunitTestCases.filter((tc: any) => {
      if (
        facets.statuses.length > 0 &&
        !facets.statuses.includes(tc.resultStatus)
      ) {
        return false;
      }
      if (facets.suites.length > 0 && !facets.suites.includes(tc.suiteName)) {
        return false;
      }
      if (facets.flakyOnly && !tc.isFlaky) return false;
      if (facets.retriedOnly && !tc.isRetried) return false;
      return true;
    });
  }, [sortedJunitTestCases, facets]);

  const filteredJunitTestCases = useMemo(() => {
    if (!junitFilter) return facetFilteredJunitTestCases;
    const filterLower = junitFilter.toLowerCase();
    return facetFilteredJunitTestCases.filter((tc: any) =>
      Object.values(tc).some(
        (val) =>
          typeof val === "string" && val.toLowerCase().includes(filterLower)
      )
    );
  }, [facetFilteredJunitTestCases, junitFilter]);

  useEffect(() => {
    setTotalItems(filteredJunitTestCases.length);
  }, [filteredJunitTestCases.length, setTotalItems]);

  // A facet change can strand the pager past the last page of the narrowed
  // set — snap back to the first page.
  useEffect(() => {
    setJunitPage(1);
  }, [facets, setJunitPage]);

  const pageSizeOptions = usePageSizeOptions(totalItems);
  const effectivePageSize =
    junitPageSize === "All" ? totalItems : junitPageSize;
  const pagedJunitTestCases = useMemo(() => {
    if (junitPageSize === "All") return filteredJunitTestCases;
    const start =
      (junitPage - 1) * (typeof junitPageSize === "number" ? junitPageSize : 1);
    return filteredJunitTestCases.slice(
      start,
      start + (typeof junitPageSize === "number" ? junitPageSize : 1)
    );
  }, [filteredJunitTestCases, junitPage, junitPageSize]);

  // JUnit result attachments (opened from a result row; separate from the run's
  // own attachments carousel in the shared shell).
  const [junitResultAttachments, setJunitResultAttachments] = useState<any[]>(
    []
  );
  const [junitResultAttachmentIndex, setJunitResultAttachmentIndex] = useState<
    number | null
  >(null);
  const handleJunitResultAttachmentSelect = useCallback(
    (attachments: any[], index: number) => {
      setJunitResultAttachments(attachments);
      setJunitResultAttachmentIndex(index);
    },
    []
  );
  const handleJunitResultAttachmentClose = useCallback(() => {
    setJunitResultAttachmentIndex(null);
    setJunitResultAttachments([]);
  }, []);

  const junitColumns = useMemo(
    () =>
      getJunitColumns({
        t: t as (key: string) => string,
        session,
        projectId: projectId ? String(projectId) : "",
        handleAttachmentSelect: handleJunitResultAttachmentSelect,
      }),
    [t, session, projectId, handleJunitResultAttachmentSelect]
  );

  // Jump to the page holding the case selected via the URL param.
  useEffect(() => {
    if (
      selectedTestCaseId &&
      sortedJunitTestCases.length > 0 &&
      typeof junitPageSize === "number"
    ) {
      const idx = sortedJunitTestCases.findIndex(
        (tc: { id: number }) => tc.id === selectedTestCaseId
      );
      if (idx >= 0) {
        const page = Math.floor(idx / junitPageSize) + 1;
        setJunitPage(page);
      }
    }
  }, [selectedTestCaseId, sortedJunitTestCases, junitPageSize, setJunitPage]);

  return (
    <div className="space-y-4">
      {/* Facet filters above the whole toolbar row, as on Repository Cases. */}
      <JunitFilterBar
        facets={facets}
        onFacetsChange={onFacetsChange}
        statusOptions={statusOptions}
        suiteOptions={suiteOptions}
        flakyCaseCount={flakyCaseCount}
        retriedCaseCount={retriedCaseCount}
      />
      <div className="flex flex-row items-start w-full gap-4 mb-2">
        <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
          <Filter
            initialSearchString={junitFilter}
            onSearchChange={setJunitFilter}
            placeholder={t("common.table.filter")}
            dataTestId="junit-table-filter"
          />
          <div className="mt-4">
            <ColumnSelection<any>
              storageKey={`junit-results:${projectId}:${runId}`}
              columns={junitColumns as any}
              onVisibilityChange={setJunitColumnVisibility}
              hideColumnRef={hideColumnRef}
            />
          </div>
        </div>
        <div className="flex flex-col w-full sm:w-2/3 items-end">
          <div className="justify-end">
            <PaginationInfo
              startIndex={startIndex}
              endIndex={endIndex}
              totalRows={totalItems}
              searchString={junitFilter}
              pageSize={junitPageSize}
              pageSizeOptions={pageSizeOptions}
              handlePageSizeChange={setJunitPageSize}
            />
          </div>
          <div className="justify-end -mx-4">
            <PaginationComponent
              currentPage={junitPage}
              totalPages={totalPages}
              onPageChange={setJunitPage}
            />
          </div>
        </div>
      </div>
      <div className="space-y-8">
        <DataTable
          columns={junitColumns}
          data={isJUnitLoading ? [] : pagedJunitTestCases}
          columnVisibility={junitColumnVisibility}
          onColumnVisibilityChange={setJunitColumnVisibility}
          isLoading={isJUnitLoading}
          pageSize={effectivePageSize}
          sortConfig={junitSortConfig ?? undefined}
          onSortChange={handleJunitSortChange}
          onSortColumn={onSortColumn}
          onHideColumn={(columnId) => hideColumnRef.current?.(columnId)}
          storageKey="run-junit-results"
        />
        {!isJUnitLoading && (!jUnitSuites || jUnitSuites.length === 0) && (
          <div className="text-muted-foreground">
            {t("common.ui.noAutomatedTestResults")}
          </div>
        )}
      </div>
      {junitResultAttachmentIndex !== null && (
        <AttachmentsCarousel
          attachments={junitResultAttachments}
          initialIndex={junitResultAttachmentIndex}
          onClose={handleJunitResultAttachmentClose}
          canEdit={false}
        />
      )}
    </div>
  );
}
