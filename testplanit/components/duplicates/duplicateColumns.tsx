import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ColumnDef } from "@tanstack/react-table";
import { ArrowRightLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  type ConfidenceBucket,
  scoreToConfidence,
} from "~/lib/utils/similarity";

export interface DuplicateCandidateRow {
  id: number;
  name: string;
  projectId: number;
  caseAId: number;
  caseAName: string;
  caseBId: number;
  caseBName: string;
  score: number;
  matchedFields: string[];
  status: string;
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

export const getColumns = (
  t: ReturnType<typeof useTranslations<"repository.duplicates">>,
  onCompare?: (id: number) => void
): ColumnDef<DuplicateCandidateRow>[] => [
  {
    id: "confidence",
    accessorKey: "score",
    header: t("columnConfidence"),
    enableSorting: true,
    enableResizing: true,
    size: 120,
    cell: ({ row }) => <ConfidenceBadge score={row.original.score} />,
  },
  {
    id: "caseA",
    accessorKey: "caseAName",
    header: t("columnCaseA"),
    enableSorting: true,
    enableResizing: true,
    size: 300,
    cell: ({ row }) => row.original.caseAName,
  },
  {
    id: "caseB",
    accessorKey: "caseBName",
    header: t("columnCaseB"),
    enableSorting: true,
    enableResizing: true,
    size: 300,
    cell: ({ row }) => row.original.caseBName,
  },
  {
    id: "matchedFields",
    accessorKey: "matchedFields",
    header: t("columnMatchedFields"),
    enableSorting: true,
    enableResizing: true,
    size: 200,
    cell: ({ row }) => row.original.matchedFields.join(", "),
  },
  {
    id: "score",
    accessorKey: "score",
    header: t("columnScore"),
    enableSorting: true,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => (
      <span className="text-right block">
        {(row.original.score * 100).toFixed(0)}%
      </span>
    ),
  },
  {
    id: "actions",
    header: "",
    enableSorting: false,
    enableResizing: false,
    enableHiding: false,
    size: 80,
    maxSize: 80,
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          onCompare?.(row.original.id);
        }}
        className="gap-1.5 text-muted-foreground hover:text-foreground"
      >
        <ArrowRightLeft className="h-3.5 w-3.5" />
        <span className="text-xs">{t("compareButton")}</span>
      </Button>
    ),
  },
];
