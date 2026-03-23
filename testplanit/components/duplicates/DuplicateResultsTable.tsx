"use client";

import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/tables/DataTable";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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

interface CandidatesPage {
  items: DuplicateCandidate[];
  nextCursor: number | null;
}

interface DuplicateResultsTableProps {
  projectId: string;
}

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

  const handleSortChange = (column: string) => {
    setSortConfig((prev) => ({
      column,
      direction:
        prev.column === column && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const columns = useMemo(() => getColumns(t), [t]);

  const { data, isLoading, fetchNextPage, hasNextPage } =
    useInfiniteQuery<CandidatesPage>({
      queryKey: ["duplicate-scan-candidates", projectId],
      queryFn: ({ pageParam }) =>
        fetch(
          `/api/duplicate-scan/candidates?projectId=${projectId}${
            pageParam ? `&cursor=${pageParam}` : ""
          }`
        ).then((r) => r.json()),
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialPageParam: undefined as number | undefined,
    });

  const items: DuplicateCandidateRow[] = useMemo(() => {
    const raw = data?.pages.flatMap((p) => p.items) ?? [];
    const mapped = raw.map((item) => ({
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
  }, [data, sortConfig]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">{t("loading")}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">{t("noDuplicatesFound")}</p>
        <p className="text-sm">{t("noDuplicatesDescription")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        data={items}
        onSortChange={handleSortChange}
        sortConfig={sortConfig}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        isLoading={isLoading}
        pageSize={25}
      />

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => fetchNextPage()}>
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
