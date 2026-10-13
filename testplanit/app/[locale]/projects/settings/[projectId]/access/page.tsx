"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { Loading } from "@/components/Loading";
import { ProjectIcon } from "@/components/ProjectIcon";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { PageTitle, SectionHeader } from "@/components/ui/typography";
import { Info, SquarePen } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { notFound, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApplicationArea } from "~/zenstack/models";
import { useProjectAccessRoster } from "~/hooks/useProjectAccessRoster";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { useRouter } from "~/lib/navigation";
import {
  ACCESS_SORT_COLUMNS,
  sortAccessRows,
  useAccessColumns,
  type AccessRow,
  type AccessSortColumn,
} from "./columns";

export default function ProjectAccessPage() {
  const params = useParams();
  const projectId = parseInt(params.projectId as string);
  const { session, status, isLoading: isAuthLoading } = useRequireAuth();
  const router = useRouter();
  const locale = useLocale();
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const { data: project, isLoading: projectLoading } = useClientQueries(
    schema
  ).projects.useFindFirst(
    {
      where: { id: projectId },
      select: { id: true, name: true, iconUrl: true },
    },
    { enabled: status === "authenticated", retry: 3, retryDelay: 1000 }
  );

  // Project-admin authority, resolved server-side the same way the settings
  // APIs gate: system ADMIN, the project's creator, a holder of the
  // per-project role with Settings canAddEdit, or a system PROJECTADMIN assigned here.
  const { isProjectAdmin, isLoading: permissionsLoading } =
    useProjectPermissions(projectId, ApplicationArea.Settings);

  const {
    data: roster,
    isLoading: rosterLoading,
    error: rosterError,
  } = useProjectAccessRoster(projectId, {
    enabled: status === "authenticated" && isProjectAdmin,
  });

  const [sortConfig, setSortConfig] = useState<{
    column: AccessSortColumn;
    direction: "asc" | "desc";
  }>({ column: "name", direction: "asc" });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const columns = useAccessColumns();

  // The roster is one unpaged fetch, so the name/email filter runs here;
  // `Filter` debounces the input itself.
  const [searchString, setSearchString] = useState("");
  const rows = useMemo<AccessRow[]>(() => {
    const needle = searchString.trim().toLowerCase();
    const matching = (roster ?? []).filter(
      (entry) =>
        needle.length === 0 ||
        entry.name.toLowerCase().includes(needle) ||
        (entry.email ?? "").toLowerCase().includes(needle)
    );
    return sortAccessRows(
      matching.map((entry) => ({ ...entry, id: entry.userId })),
      sortConfig.column,
      sortConfig.direction
    );
  }, [roster, searchString, sortConfig]);

  useEffect(() => {
    if (projectLoading || permissionsLoading || !session?.user) return;
    if (!project || !isProjectAdmin) {
      notFound();
    }
  }, [project, projectLoading, permissionsLoading, isProjectAdmin, session]);

  if (isAuthLoading || projectLoading || permissionsLoading) {
    return <Loading />;
  }

  if (!project) {
    return (
      <Card className="flex flex-col w-full min-w-100 h-full">
        <CardContent className="flex flex-col items-center justify-center h-full">
          <PageTitle className="mb-2">
            {tCommon("errors.projectNotFound")}
          </PageTitle>
          <p className="text-muted-foreground">
            {tCommon("errors.projectNotFoundDescription")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const isSortColumn = (column: string): column is AccessSortColumn =>
    (ACCESS_SORT_COLUMNS as readonly string[]).includes(column);

  const handleSortChange = (column: string) => {
    if (!isSortColumn(column)) return;
    const direction =
      sortConfig.column === column && sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig({ column: "name", direction: "asc" });
    } else if (isSortColumn(column)) {
      setSortConfig({ column, direction });
    }
  };

  // Only system ADMINs can reach Administration → Projects, so the edit
  // button is offered to them alone; everyone else with settings access is
  // told who can change access.
  const isSystemAdmin = session?.user?.access === "ADMIN";
  const editButtonLabel = tGlobal("projects.settings.access.editButton");

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="project-access-title">
                {tCommon("fields.access")}
              </CardTitle>
              <HelpPopover helpKey="projectAccess" />
            </SectionHeader>
            {isSystemAdmin && (
              <Button
                onClick={() =>
                  router.push(`/admin/projects?edit=${projectId}&tab=users`)
                }
                aria-label={editButtonLabel}
                className="group gap-0 transition-all duration-200 hover:gap-2"
                data-testid="project-access-edit-button"
              >
                <SquarePen className="h-4 w-4" />
                <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                  {editButtonLabel}
                </span>
              </Button>
            )}
          </div>
          <CardDescription>
            <span className="flex items-center gap-2">
              <ProjectIcon iconUrl={project.iconUrl} />
              {project.name}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isSystemAdmin && (
            <p
              className="flex items-center gap-1.5 text-sm text-muted-foreground"
              data-testid="project-access-admin-note"
            >
              <Info className="h-4 w-4" aria-hidden="true" />
              {tGlobal("projects.settings.access.adminOnlyNote")}
            </p>
          )}

          {rosterError ? (
            <p className="text-sm text-destructive" role="alert">
              {tCommon("errors.unknown")}
            </p>
          ) : (
            <div>
              <div className="flex flex-row items-start justify-between gap-4">
                <div className="flex flex-col grow w-full sm:w-1/3 min-w-[150px]">
                  <Filter
                    key="project-access-filter"
                    placeholder={tGlobal("users.filter")}
                    initialSearchString={searchString}
                    onSearchChange={setSearchString}
                    dataTestId="project-access-filter"
                  />
                </div>
                {roster && roster.length > 0 && (
                  <p className="text-sm text-muted-foreground shrink-0">
                    {tGlobal("admin.auditLogs.showing", {
                      loaded: rows.length.toLocaleString(locale),
                      total: roster.length.toLocaleString(locale),
                    })}
                  </p>
                )}
              </div>
              <div className="mt-4 w-full">
                <DataTable
                  virtualized
                  fillViewport
                  columns={columns}
                  data={rows}
                  onSortChange={handleSortChange}
                  onSortColumn={handleSortColumn}
                  sortConfig={sortConfig}
                  columnVisibility={columnVisibility}
                  onColumnVisibilityChange={setColumnVisibility}
                  isLoading={rosterLoading}
                  resetKey={`${searchString}|${sortConfig.column}|${sortConfig.direction}`}
                  testIdPrefix="project-access-table"
                  rowTestIdPrefix="project-access-row"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
