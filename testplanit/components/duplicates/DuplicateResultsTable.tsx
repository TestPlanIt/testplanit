"use client";

import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import {
  type DuplicateCandidateRow,
  getColumns,
} from "./duplicateColumns";

interface DuplicateCandidate {
  id: number;
  projectId: number;
  caseAId: number;
  caseA: { id: number; name: string };
  caseBId: number;
  caseB: { id: number; name: string };
  score: number;
  matchedFields: string[];
  status: string;
  scanJobId: number;
  createdAt: string;
}

interface DuplicateResultsTableProps {
  projectId: string;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function DuplicateResultsTable({
  projectId,
}: DuplicateResultsTableProps) {
  const t = useTranslations("repository.duplicates");
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "score", direction: "desc" });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [searchString, setSearchString] = useState("");

  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
    setCurrentPage(1);
  };

  const handlePageSizeChange = (size: number | "All") => {
    setPageSize(typeof size === "number" ? size : 100);
    setCurrentPage(1);
  };

  const handleFilterChange = useCallback((value: string) => {
    setSearchString(value);
    setCurrentPage(1);
  }, []);

  const columns = useMemo(() => getColumns(t), [t]);

  const { data: allItems, isLoading } = useQuery<DuplicateCandidate[]>({
    queryKey: ["duplicate-scan-candidates", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/duplicate-scan/candidates?projectId=${projectId}&limit=100`
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.items;
    },
  });

  const sortedItems: DuplicateCandidateRow[] = useMemo(() => {
    const raw = allItems ?? [];
    let mapped = raw.map((item) => ({
      id: item.id,
      name: `${item.caseA.name} / ${item.caseB.name}`,
      projectId: item.projectId,
      caseAId: item.caseAId,
      caseAName: item.caseA.name,
      caseBId: item.caseBId,
      caseBName: item.caseB.name,
      score: item.score,
      matchedFields: item.matchedFields,
      status: item.status,
    }));

    // Filter by search string
    if (searchString) {
      const lower = searchString.toLowerCase();
      mapped = mapped.filter(
        (item) =>
          item.caseAName.toLowerCase().includes(lower) ||
          item.caseBName.toLowerCase().includes(lower) ||
          item.matchedFields.some((f) => f.toLowerCase().includes(lower))
      );
    }

    // Sort
    if (sortConfig) {
      const { column, direction } = sortConfig;
      const dir = direction === "asc" ? 1 : -1;
      mapped.sort((a, b) => {
        let aVal: string | number;
        let bVal: string | number;
        switch (column) {
          case "confidence":
          case "score":
            aVal = a.score;
            bVal = b.score;
            break;
          case "caseA":
            aVal = a.caseAName.toLowerCase();
            bVal = b.caseAName.toLowerCase();
            break;
          case "caseB":
            aVal = a.caseBName.toLowerCase();
            bVal = b.caseBName.toLowerCase();
            break;
          case "matchedFields":
            aVal = a.matchedFields.join(", ").toLowerCase();
            bVal = b.matchedFields.join(", ").toLowerCase();
            break;
          default:
            return 0;
        }
        if (aVal < bVal) return -1 * dir;
        if (aVal > bVal) return 1 * dir;
        return 0;
      });
    }

    return mapped;
  }, [allItems, sortConfig, searchString]);

  const totalItems = sortedItems.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const pageItems = sortedItems.slice(startIndex, endIndex);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">{t("loading")}</p>
      </div>
    );
  }

  if ((allItems ?? []).length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">{t("noDuplicatesFound")}</p>
        <p className="text-sm">{t("noDuplicatesDescription")}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-row items-start">
        <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
          <div className="text-muted-foreground w-full text-nowrap">
            <Filter
              placeholder={t("filterPlaceholder")}
              initialSearchString={searchString}
              onSearchChange={handleFilterChange}
            />
          </div>
        </div>

        <div className="flex flex-col w-full sm:w-2/3 items-end">
          {totalItems > 0 && (
            <>
              <div className="justify-end">
                <PaginationInfo
                  startIndex={startIndex + 1}
                  endIndex={endIndex}
                  totalRows={totalItems}
                  searchString={searchString}
                  pageSize={pageSize}
                  pageSizeOptions={[...PAGE_SIZE_OPTIONS]}
                  handlePageSizeChange={handlePageSizeChange}
                />
              </div>
              <div className="justify-end -mx-4">
                <PaginationComponent
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onPageChange={setCurrentPage}
                />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-4">
        <DataTable
          columns={columns}
          data={pageItems}
          onSortChange={handleSortChange}
          sortConfig={sortConfig}
          columnVisibility={columnVisibility}
          onColumnVisibilityChange={setColumnVisibility}
          isLoading={isLoading}
          pageSize={pageSize}
        />
      </div>
    </div>
  );
}
