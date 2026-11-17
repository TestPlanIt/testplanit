"use client";

import { RelativeTimeTooltip } from "@/components/RelativeTimeTooltip";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { DataTable } from "@/components/tables/DataTable";
import type {
  ColumnDef,
  VisibilityState,
} from "@/components/tables/tableFeatures";
import { UserNameCell } from "@/components/tables/UserNameCell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PageCardHeader,
  ProjectHeaderInfo,
} from "@/components/ui/page-card-header";
import { PageTitle } from "@/components/ui/typography";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { ShieldOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Loading } from "~/components/Loading";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { Link } from "~/lib/navigation";
import { ApplicationArea } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

type QuarantineRow = {
  id: number;
  caseId: number;
  case: {
    id: number;
    name: string;
    source: string;
    automated: boolean;
    isDeleted: boolean;
  };
  signature: { id: number; title: string } | null;
  reason: string | null;
  keepUntilReleased: boolean;
  createdById: string;
  createdAt: Date;
};

type SortState = { column: string; direction: "asc" | "desc" };

export default function QuarantinePage() {
  const t = useTranslations();
  const { session, isLoading: isAuthLoading } = useRequireAuth();
  const { projectId: projectIdParam } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdParam);
  const { permissions } = useProjectPermissions(
    projectId,
    ApplicationArea.FailurePatterns
  );
  const canEdit = permissions?.canAddEdit ?? false;
  const queries = useClientQueries(schema);

  const { data: project, isLoading: projectLoading } =
    queries.projects.useFindFirst(
      {
        where: { id: projectId, isDeleted: false },
        select: {
          id: true,
          name: true,
          iconUrl: true,
          quarantineAutoRelease: true,
          quarantineAutoReleasePasses: true,
        },
      },
      { enabled: Number.isInteger(projectId) && !isAuthLoading }
    );

  const [sort, setSort] = useState<SortState>({
    column: "createdAt",
    direction: "desc",
  });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [releasing, setReleasing] = useState<QuarantineRow | null>(null);

  const orderBy = useMemo(() => {
    switch (sort.column) {
      case "case":
        return { case: { name: sort.direction } };
      case "signature":
        return { signature: { title: sort.direction } };
      case "reason":
        return { reason: sort.direction };
      case "releasePolicy":
        return { keepUntilReleased: sort.direction };
      default:
        return { createdAt: sort.direction };
    }
  }, [sort]);

  const {
    data: rows,
    isLoading,
    refetch,
  } = queries.caseQuarantine.useFindMany(
    {
      where: { projectId },
      orderBy,
      select: {
        id: true,
        caseId: true,
        reason: true,
        keepUntilReleased: true,
        createdById: true,
        createdAt: true,
        case: {
          select: {
            id: true,
            name: true,
            source: true,
            automated: true,
            isDeleted: true,
          },
        },
        signature: { select: { id: true, title: true } },
      },
    },
    { enabled: !!project }
  );
  const { mutateAsync: release } = queries.caseQuarantine.useDelete();

  const tTestCase = t("common.name");
  const tSignature = t("triage.quarantine.columns.signature");
  const tReason = t("triage.quarantine.reasonLabel");
  const tBy = t("triage.quarantine.columns.by");
  const tSince = t("triage.quarantine.columns.since");
  const tRelease = t("triage.quarantine.release");
  const tReleaseColumn = t("triage.quarantine.columns.releasePolicy");
  const autoRelease = project?.quarantineAutoRelease ?? false;
  const autoReleasePasses = project?.quarantineAutoReleasePasses ?? 0;

  const columns = useMemo<ColumnDef<QuarantineRow>[]>(
    () => [
      {
        id: "case",
        accessorFn: (row) => row.case.name,
        header: tTestCase,
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 320,
        minSize: 100,
        cell: ({ row }) => (
          <CaseDisplay
            id={row.original.case.id}
            name={row.original.case.name}
            source={row.original.case.source}
            automated={row.original.case.automated}
            isDeleted={row.original.case.isDeleted}
            projectId={row.original.case.isDeleted ? undefined : projectId}
            className="truncate"
          />
        ),
      },
      {
        id: "signature",
        accessorFn: (row) => row.signature?.title ?? "",
        header: tSignature,
        enableSorting: true,
        enableResizing: true,
        size: 320,
        minSize: 100,
        cell: ({ row, column }) =>
          row.original.signature ? (
            <div style={{ maxWidth: column.getSize() }} className="min-w-0">
              <Link
                href={`/projects/triage/${projectId}/${row.original.signature.id}`}
                className="block truncate font-mono text-sm hover:underline"
                title={row.original.signature.title}
                data-testid="quarantine-signature-link"
              >
                {row.original.signature.title}
              </Link>
            </div>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "reason",
        accessorKey: "reason",
        header: tReason,
        enableSorting: true,
        enableResizing: true,
        size: 280,
        cell: ({ row }) =>
          row.original.reason ? (
            <span className="block truncate" title={row.original.reason}>
              {row.original.reason}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "releasePolicy",
        accessorKey: "keepUntilReleased",
        header: tReleaseColumn,
        enableSorting: true,
        enableResizing: true,
        size: 220,
        cell: ({ row }) => (
          <span className="block truncate text-sm text-muted-foreground">
            {row.original.keepUntilReleased || !autoRelease
              ? t("triage.quarantine.releaseManual")
              : t("triage.quarantine.releaseAuto", {
                  count: autoReleasePasses,
                })}
          </span>
        ),
      },
      {
        id: "createdBy",
        accessorKey: "createdById",
        header: tBy,
        enableSorting: false,
        enableResizing: true,
        size: 180,
        cell: ({ row }) => (
          <UserNameCell userId={row.original.createdById} shrinkLink />
        ),
      },
      {
        id: "createdAt",
        accessorKey: "createdAt",
        header: tSince,
        enableSorting: true,
        enableResizing: true,
        size: 160,
        cell: ({ row }) => (
          <div className="truncate text-sm text-muted-foreground">
            <RelativeTimeTooltip
              date={row.original.createdAt}
              className="block truncate"
            />
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableResizing: false,
        enableHiding: false,
        size: 60,
        cell: ({ row }) =>
          canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label={tRelease}
              title={tRelease}
              onClick={() => setReleasing(row.original)}
              data-testid="quarantine-release-button"
            >
              <ShieldOff className="h-4 w-4" />
            </Button>
          ) : null,
      },
    ],
    [
      projectId,
      canEdit,
      t,
      tTestCase,
      tSignature,
      tReason,
      tBy,
      tSince,
      tRelease,
      tReleaseColumn,
      autoRelease,
      autoReleasePasses,
    ]
  );

  const handleRelease = async (row: QuarantineRow) => {
    try {
      await release({ where: { id: row.id } });
      toast.success(t("triage.quarantine.releasedToast"));
      setReleasing(null);
      void refetch();
    } catch (error) {
      console.error("Failed to release quarantine:", error);
      toast.error(t("triage.quarantine.failedToast"));
    }
  };

  if (isAuthLoading || projectLoading) return <Loading />;
  if (!session?.user) return <div>{t("common.errors.sessionNotFound")}</div>;
  if (!project) {
    return (
      <Card className="flex h-full w-full min-w-[400px] flex-col">
        <CardContent className="flex h-full flex-col items-center justify-center">
          <PageTitle className="mb-2">
            {t("common.errors.projectNotFound")}
          </PageTitle>
          <p className="text-muted-foreground">
            {t("common.errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <main>
      <Card>
        <PageCardHeader
          className="w-full"
          title={t("triage.quarantine.title")}
          helpKey="projectQuarantine"
          backHref={`/projects/triage/${projectId}`}
          description={<ProjectHeaderInfo project={project} />}
          data-testid="quarantine-page-header"
        />
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {t("triage.quarantine.hint")}
          </p>
          <DataTable
            virtualized
            columns={columns}
            data={(rows ?? []) as QuarantineRow[]}
            sortConfig={sort}
            onSortChange={(column) =>
              setSort((prev) =>
                prev.column === column
                  ? {
                      column,
                      direction: prev.direction === "asc" ? "desc" : "asc",
                    }
                  : { column, direction: "asc" }
              )
            }
            onSortColumn={(column, direction) =>
              setSort(
                direction
                  ? { column, direction }
                  : { column: "createdAt", direction: "desc" }
              )
            }
            isLoading={isLoading}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            getRowId={(row) => String(row.id)}
            fillViewport
            emptyMessage={t("triage.quarantine.empty")}
            testIdPrefix="quarantine-table"
            rowTestIdPrefix="quarantine-row"
          />
        </CardContent>
      </Card>
      <AlertDialog
        open={releasing !== null}
        onOpenChange={(open) => {
          if (!open) setReleasing(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("triage.quarantine.releaseConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("triage.quarantine.releaseConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="quarantine-release-cancel">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (releasing) void handleRelease(releasing);
              }}
              data-testid="quarantine-release-confirm"
            >
              {t("triage.quarantine.release")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
