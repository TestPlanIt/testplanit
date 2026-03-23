"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ConfidenceBucket,
  scoreToConfidence,
} from "~/lib/utils/similarity";
import { useInfiniteQuery } from "@tanstack/react-query";

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

function ConfidenceBadge({ score }: { score: number }) {
  const confidence: ConfidenceBucket | null = scoreToConfidence(score);

  if (!confidence) return null;

  if (confidence === "HIGH") {
    return <Badge variant="destructive">HIGH</Badge>;
  }
  if (confidence === "MEDIUM") {
    return <Badge variant="default">MEDIUM</Badge>;
  }
  return <Badge variant="secondary">LOW</Badge>;
}

export function DuplicateResultsTable({ projectId }: DuplicateResultsTableProps) {
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

  const items = data?.pages.flatMap((p) => p.items) ?? [];

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">Loading duplicate candidates...</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">No duplicates found</p>
        <p className="text-sm">Last scan completed with no matching pairs.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Confidence</TableHead>
            <TableHead>Case A</TableHead>
            <TableHead>Case B</TableHead>
            <TableHead>Matched Fields</TableHead>
            <TableHead className="text-right">Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={item.id}>
              <TableCell className="text-muted-foreground">{index + 1}</TableCell>
              <TableCell>
                <ConfidenceBadge score={item.score} />
              </TableCell>
              <TableCell>{item.caseA.name}</TableCell>
              <TableCell>{item.caseB.name}</TableCell>
              <TableCell>{item.matchedFields.join(", ")}</TableCell>
              <TableCell className="text-right">
                {(item.score * 100).toFixed(0)}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => fetchNextPage()}>
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
