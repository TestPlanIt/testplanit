"use client";

import { RelativeTimeTooltip } from "@/components/RelativeTimeTooltip";
import { CasesListDisplay } from "@/components/tables/CaseListDisplay";
import { ColumnDef } from "@/components/tables/tableFeatures";
import { IssuesListDisplay } from "@/components/tables/IssuesListDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import type { RunResultSignatureIssue } from "@/components/triage/RunFailureClusters";
import { UserNameCell } from "@/components/tables/UserNameCell";
import {
  ClassificationBadge,
  FlakyCandidateBadge,
  KnownIssueBadge,
  SignatureStatusBadge,
} from "@/components/triage/badges";
import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Link } from "~/lib/navigation";
import type { FailureSignature } from "~/zenstack/models";

export type SignatureRow = FailureSignature & {
  issues: { issue: RunResultSignatureIssue }[];
};

export function useSignatureColumns(
  projectId: number
): ColumnDef<SignatureRow>[] {
  const t = useTranslations();
  const tTitle = t("common.fields.title");
  const tClassification = t("triage.columns.classification");
  const tStatus = t("common.actions.status");
  const tClassifiedBy = t("triage.columns.classifiedBy");
  const tSourceAi = t("triage.source.labelAI");
  const tOccurrences = t("triage.columns.occurrences");
  const tCases = t("common.fields.testCases");
  const tRuns = t("common.fields.testRuns");
  const tLastSeen = t("triage.columns.lastSeen");
  const tFirstSeen = t("triage.columns.firstSeen");
  const tIssues = t("common.fields.issues");

  return useMemo<ColumnDef<SignatureRow>[]>(
    () => [
      {
        id: "title",
        accessorKey: "title",
        header: tTitle,
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 360,
        minSize: 100,
        maxSize: 900,
        cell: ({ row, column }) => (
          <div
            style={{ maxWidth: column.getSize() }}
            className="flex min-w-0 items-center gap-2 overflow-hidden"
          >
            <Link
              href={`/projects/triage/${projectId}/${row.original.id}`}
              className="min-w-0 truncate font-mono text-sm hover:underline"
              title={row.original.title}
              data-testid="triage-signature-link"
            >
              {row.original.title}
            </Link>
            {row.original.flakyCandidate && (
              <FlakyCandidateBadge className="shrink-0" />
            )}
            <KnownIssueBadge
              count={row.original.issues.length}
              className="shrink-0"
            />
          </div>
        ),
      },
      {
        id: "classification",
        accessorKey: "classification",
        header: tClassification,
        enableSorting: true,
        enableResizing: true,
        size: 190,
        cell: ({ row }) => (
          <ClassificationBadge
            classification={row.original.classification}
            source={row.original.classificationSource}
          />
        ),
      },
      {
        id: "classificationSource",
        accessorKey: "classificationSource",
        header: tClassifiedBy,
        enableSorting: true,
        enableResizing: true,
        size: 180,
        cell: ({ row }) => {
          if (row.original.classificationSource === "AI") {
            return (
              <span className="flex items-center gap-1 text-sm">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                {tSourceAi}
              </span>
            );
          }
          if (
            row.original.classificationSource === "MANUAL" &&
            row.original.classifiedById
          ) {
            return (
              <UserNameCell userId={row.original.classifiedById} shrinkLink />
            );
          }
          return <span className="text-muted-foreground">-</span>;
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: tStatus,
        enableSorting: true,
        enableResizing: true,
        size: 130,
        cell: ({ row }) => (
          <SignatureStatusBadge status={row.original.status} />
        ),
      },
      {
        id: "occurrenceCount",
        accessorKey: "occurrenceCount",
        header: tOccurrences,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 170,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.occurrenceCount}</span>
        ),
      },
      {
        id: "caseCount",
        accessorKey: "caseCount",
        header: tCases,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 140,
        minSize: 60,
        maxSize: 200,
        cell: ({ row }) => (
          <div className="text-center">
            <CasesListDisplay
              count={row.original.caseCount}
              filter={{
                junitResults: { some: { failureSignatureId: row.original.id } },
              }}
            />
          </div>
        ),
      },
      {
        id: "runCount",
        accessorKey: "runCount",
        header: tRuns,
        enableSorting: true,
        enableResizing: true,
        sortFn: "basic",
        size: 140,
        minSize: 60,
        maxSize: 200,
        cell: ({ row }) => (
          <div className="text-center">
            <TestRunsListDisplay
              key={`tr-${row.original.id}`}
              count={row.original.runCount}
              filter={{
                junitTestSuites: {
                  some: {
                    results: { some: { failureSignatureId: row.original.id } },
                  },
                },
              }}
            />
          </div>
        ),
      },
      {
        id: "issues",
        accessorFn: (row) => row.issues.length,
        header: tIssues,
        enableSorting: false,
        enableResizing: true,
        size: 90,
        meta: { isVisible: false },
        cell: ({ row }) =>
          row.original.issues.length > 0 ? (
            <IssuesListDisplay
              issues={row.original.issues.map((link) => ({
                ...link.issue,
                projectIds: [projectId],
              }))}
              size="small"
            />
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "lastSeenAt",
        accessorKey: "lastSeenAt",
        header: tLastSeen,
        enableSorting: true,
        enableResizing: true,
        sortFn: "datetime",
        size: 160,
        cell: ({ row }) => (
          <div className="truncate text-sm text-muted-foreground">
            <RelativeTimeTooltip
              date={row.original.lastSeenAt}
              className="block truncate"
            />
          </div>
        ),
      },
      {
        id: "firstSeenAt",
        accessorKey: "firstSeenAt",
        header: tFirstSeen,
        enableSorting: true,
        enableResizing: true,
        sortFn: "datetime",
        size: 160,
        meta: { isVisible: false },
        cell: ({ row }) => (
          <div className="truncate text-sm text-muted-foreground">
            <RelativeTimeTooltip
              date={row.original.firstSeenAt}
              className="block truncate"
            />
          </div>
        ),
      },
    ],
    [
      projectId,
      tTitle,
      tClassification,
      tStatus,
      tClassifiedBy,
      tSourceAi,
      tOccurrences,
      tCases,
      tRuns,
      tLastSeen,
      tFirstSeen,
      tIssues,
    ]
  );
}
