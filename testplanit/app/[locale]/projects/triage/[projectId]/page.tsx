"use client";

import { useDebounce } from "@/components/Debounce";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import type { VisibilityState } from "@/components/tables/tableFeatures";
import {
  ActionButtonContent,
  collapsibleActionClass,
} from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  PageCardHeader,
  ProjectHeaderInfo,
} from "@/components/ui/page-card-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { PageTitle } from "@/components/ui/typography";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Settings, ShieldAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { Loading } from "~/components/Loading";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import {
  ApplicationArea,
  FailureClassificationSource,
  FailureSignatureStatus,
} from "~/zenstack/models";
import { ClassificationOption } from "@/components/triage/badges";
import { schema } from "~/zenstack/schema";
import { useSignatureColumns, type SignatureRow } from "./columns";

const PAGE_SIZE = 50;
const STATUS_FILTER_ALL = "all";
const CLASSIFICATION_FILTER_ALL = "all";
const CLASSIFICATION_FILTER_NONE = "none";
const SOURCE_FILTER_ALL = "all";
const SOURCE_FILTER_NONE = "none";

type SortConfig = { column: string; direction: "asc" | "desc" };
const DEFAULT_SORT: SortConfig = { column: "lastSeenAt", direction: "desc" };

export default function TriagePage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const { session, isLoading: isAuthLoading } = useRequireAuth();
  const { projectId: projectIdParam } = useParams<{ projectId: string }>();
  const projectId = Number(projectIdParam);
  const { isProjectAdmin } = useProjectPermissions(
    projectId,
    ApplicationArea.Settings
  );

  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId, isDeleted: false },
      select: {
        id: true,
        name: true,
        iconUrl: true,
        failureTriageEnabled: true,
      },
    },
    { enabled: Number.isInteger(projectId) && !isAuthLoading }
  );

  const [searchString, setSearchString] = useState("");
  const debouncedSearch = useDebounce(searchString, 400);
  const [statusFilter, setStatusFilter] = useState<string>(
    FailureSignatureStatus.OPEN
  );
  const [classificationFilter, setClassificationFilter] = useState<string>(
    CLASSIFICATION_FILTER_ALL
  );
  const [sourceFilter, setSourceFilter] = useState<string>(SOURCE_FILTER_ALL);
  const [flakyOnly, setFlakyOnly] = useState(false);
  const [sortConfig, setSortConfig] = useState<SortConfig>(DEFAULT_SORT);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({
    firstSeenAt: false,
  });

  const where = useMemo(
    () => ({
      projectId,
      ...(statusFilter !== STATUS_FILTER_ALL
        ? { status: statusFilter as FailureSignatureStatus }
        : {}),
      ...(classificationFilter === CLASSIFICATION_FILTER_NONE
        ? { classificationId: null }
        : classificationFilter !== CLASSIFICATION_FILTER_ALL
          ? { classificationId: Number(classificationFilter) }
          : {}),
      ...(sourceFilter === SOURCE_FILTER_NONE
        ? { classificationSource: null }
        : sourceFilter !== SOURCE_FILTER_ALL
          ? {
              classificationSource: sourceFilter as FailureClassificationSource,
            }
          : {}),
      ...(flakyOnly ? { flakyCandidate: true } : {}),
      ...(debouncedSearch
        ? {
            OR: [
              {
                title: {
                  contains: debouncedSearch,
                  mode: "insensitive" as const,
                },
              },
              {
                exceptionType: {
                  contains: debouncedSearch,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    }),
    [
      projectId,
      statusFilter,
      classificationFilter,
      sourceFilter,
      flakyOnly,
      debouncedSearch,
    ]
  );

  const { data: classifications } = useClientQueries(
    schema
  ).failureClassification.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      select: { id: true, name: true, color: { select: { value: true } } },
    },
    { enabled: !isAuthLoading }
  );

  const queryArgs = useMemo(
    () => ({
      where,
      orderBy:
        sortConfig.column === "classification"
          ? { classification: { name: sortConfig.direction } }
          : sortConfig.column === "issues"
            ? { issues: { _count: sortConfig.direction } }
            : { [sortConfig.column]: sortConfig.direction },
      include: {
        classification: {
          select: {
            id: true,
            name: true,
            isDeleted: true,
            color: { select: { value: true } },
          },
        },
        issues: {
          select: {
            issue: {
              select: {
                id: true,
                name: true,
                externalId: true,
                externalUrl: true,
                externalKey: true,
                title: true,
                description: true,
                externalStatus: true,
                priority: true,
                lastSyncedAt: true,
                data: true,
                issueTypeName: true,
                issueTypeIconUrl: true,
                integration: {
                  select: { id: true, provider: true, name: true },
                },
              },
            },
          },
        },
      },
      take: PAGE_SIZE,
    }),
    [where, sortConfig]
  );

  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useClientQueries(schema).failureSignature.useInfiniteFindMany(queryArgs, {
    getNextPageParam: (lastPage, allPages) =>
      !lastPage || lastPage.length < PAGE_SIZE
        ? undefined
        : { ...queryArgs, skip: allPages.flat().length },
    enabled: !!project,
  });
  const rows = useMemo(
    () => (pages?.pages.flat() ?? []) as SignatureRow[],
    [pages]
  );

  const { data: total } = useClientQueries(schema).failureSignature.useCount(
    { where },
    { enabled: !!project }
  );
  const { data: quarantinedCount } = useClientQueries(
    schema
  ).caseQuarantine.useCount({ where: { projectId } }, { enabled: !!project });

  const columns = useSignatureColumns(projectId);

  const handleSortChange = useCallback((column: string) => {
    setSortConfig((prev) =>
      prev.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: column === "title" ? "asc" : "desc" }
    );
  }, []);
  const handleSortColumn = useCallback(
    (column: string, direction: "asc" | "desc" | null) => {
      setSortConfig(direction ? { column, direction } : DEFAULT_SORT);
    },
    []
  );

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

  const resetKey = `${debouncedSearch}|${statusFilter}|${classificationFilter}|${sourceFilter}|${flakyOnly}|${sortConfig.column}|${sortConfig.direction}`;

  return (
    <main>
      <Card>
        <PageCardHeader
          className="w-full"
          title={t("common.pageTitles.triage")}
          helpKey="projectTriage"
          description={<ProjectHeaderInfo project={project} />}
          actions={
            <>
              <Button
                variant="outline"
                className={collapsibleActionClass()}
                onClick={() =>
                  router.push(`/projects/triage/${projectId}/quarantine`)
                }
                data-testid="triage-quarantine-button"
              >
                <ActionButtonContent
                  icon={ShieldAlert}
                  label={t("triage.quarantine.listButton", {
                    count: quarantinedCount ?? 0,
                  })}
                />
              </Button>
              {isProjectAdmin && (
                <Button
                  variant="outline"
                  className={collapsibleActionClass()}
                  onClick={() =>
                    router.push(`/projects/settings/${projectId}/triage`)
                  }
                  data-testid="triage-settings-button"
                >
                  <ActionButtonContent
                    icon={Settings}
                    label={t("common.tabs.settings")}
                  />
                </Button>
              )}
            </>
          }
          data-testid="triage-page-header"
        />
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex w-full min-w-[250px] grow flex-col">
              <div className="flex w-full flex-wrap items-center gap-2 text-muted-foreground">
                <Filter
                  key="triage-filter"
                  placeholder={t("triage.filters.searchPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                  className="grow shrink basis-[160px] min-w-[160px] max-w-lg"
                />
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger
                    className="h-8 w-[140px]"
                    data-testid="triage-status-filter"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STATUS_FILTER_ALL}>
                      {t("common.filters.all")}
                    </SelectItem>
                    {Object.values(FailureSignatureStatus).map((status) => (
                      <SelectItem key={status} value={status}>
                        {t(`triage.status.${status}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={classificationFilter}
                  onValueChange={setClassificationFilter}
                >
                  <SelectTrigger
                    className="h-8 w-[170px]"
                    data-testid="triage-classification-filter"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={CLASSIFICATION_FILTER_ALL}>
                      {t("common.filters.all")}
                    </SelectItem>
                    <SelectItem value={CLASSIFICATION_FILTER_NONE}>
                      {t("triage.unclassified")}
                    </SelectItem>
                    {(classifications ?? []).map((classification) => (
                      <SelectItem
                        key={classification.id}
                        value={String(classification.id)}
                      >
                        <ClassificationOption classification={classification} />
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sourceFilter} onValueChange={setSourceFilter}>
                  <SelectTrigger
                    className="h-8 w-[150px]"
                    data-testid="triage-source-filter"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SOURCE_FILTER_ALL}>
                      {t("triage.filters.sourceAll")}
                    </SelectItem>
                    <SelectItem value={FailureClassificationSource.AI}>
                      {t("triage.filters.sourceAi")}
                    </SelectItem>
                    <SelectItem value={FailureClassificationSource.MANUAL}>
                      {t("triage.filters.sourceManual")}
                    </SelectItem>
                    <SelectItem value={SOURCE_FILTER_NONE}>
                      {t("triage.filters.sourceNone")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Label className="flex items-center gap-2 text-sm font-normal">
                  <Switch
                    id="triage-flaky-only"
                    checked={flakyOnly}
                    onCheckedChange={setFlakyOnly}
                    data-testid="triage-flaky-filter"
                  />
                  {t("triage.filters.flakyOnly")}
                </Label>
              </div>
            </div>
            {rows.length > 0 && (
              <p className="shrink-0 text-sm text-muted-foreground">
                {t("admin.auditLogs.showing", {
                  loaded: rows.length.toLocaleString(locale),
                  total: (total ?? rows.length).toLocaleString(locale),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 w-full">
            <DataTable
              virtualized
              columns={columns}
              data={rows}
              onSortChange={handleSortChange}
              onSortColumn={handleSortColumn}
              sortConfig={sortConfig}
              isLoading={isLoading || isFetchingNextPage}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              hasMore={!!hasNextPage}
              onLoadMore={fetchNextPage}
              estimateSize={52}
              fillViewport
              resetKey={resetKey}
              emptyMessage={
                <div className="flex flex-col items-center gap-1 py-10 text-center">
                  <p className="font-medium">{t("triage.empty.title")}</p>
                  <p className="text-sm text-muted-foreground">
                    {t("triage.empty.description")}
                  </p>
                </div>
              }
              testIdPrefix="triage-table"
              rowTestIdPrefix="triage-row"
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
