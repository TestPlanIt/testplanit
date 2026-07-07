"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import {
  ColumnSelection,
  CustomColumnDef,
} from "@/components/tables/ColumnSelection";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { ExtendedProjects, useColumns } from "./columns";

import { CreateProjectWizard } from "@/admin/projects/CreateProjectWizard";
import { Filter } from "@/components/tables/Filter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteProject } from "./DeleteProject";
import { EditProjectModal } from "./EditProject";

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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { format } from "date-fns";
import { CalendarDays, CirclePlus } from "lucide-react";
import { Resolver, SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod/v4";
import {
  ProcessedProject,
  processProjectsWithEffectiveMembers,
} from "~/utils/projectUtils";

const validationSchema = z.object({
  completedAt: z
    .date({
      error: (issue) =>
        issue.input === undefined ? "Completion date is required." : undefined,
    })
    .nullable()
    .refine((date) => date !== null, "Completion date is required."),
});

interface FormData {
  completedAt: Date | null;
}

export default function ProjectAdminPage() {
  return <ProjectAdmin />;
}

const PAGE_SIZE = 50;

function ProjectAdmin() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.projects");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");

  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({
    column: "name",
    direction: "asc",
  });
  const [searchString, setSearchString] = useState("");
  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<
    number | undefined
  >(undefined);
  const [completedAt, setCompletedAt] = useState<Date | null>(null);
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const [editingProject, setEditingProject] = useState<ExtendedProjects | null>(
    null
  );
  const [deletingProject, setDeletingProject] =
    useState<ExtendedProjects | null>(null);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { mutateAsync: updateProjects } =
    useClientQueries(schema).projects.useUpdate();

  // Stabilize mutation ref — ZenStack's mutateAsync changes identity every render
  const updateProjectsRef = useRef(updateProjects);
  useEffect(() => {
    updateProjectsRef.current = updateProjects;
  });

  const {
    handleSubmit,
    setValue,
    formState: { errors, isValid },
  } = useForm<FormData>({
    resolver: standardSchemaResolver(validationSchema) as Resolver<FormData>,
    mode: "onChange",
    defaultValues: {
      completedAt: null,
    },
  });

  const { data: allUsers } = useClientQueries(schema).user.useFindMany({
    where: { isActive: true, isDeleted: false },
    select: { id: true, access: true },
  });

  const handleToggleCompleted = useCallback(
    (id: number, isCompleted: boolean) => {
      setSelectedProjectId(id);
      if (isCompleted) {
        setIsAlertDialogOpen(true);
      } else {
        void updateProjectsRef.current({
          where: { id },
          data: { isCompleted, completedAt: null },
        });
      }
    },
    []
  );

  const handleOpenEditModal = useCallback((project: ExtendedProjects) => {
    setEditingProject(project);
  }, []);

  const handleCloseEditModal = useCallback(() => {
    setEditingProject(null);
  }, []);

  const handleOpenAddModal = useCallback(() => {
    setIsAddModalOpen(true);
  }, []);

  const handleCloseAddModal = useCallback(() => {
    setIsAddModalOpen(false);
  }, []);

  // Columns that require client-side sorting (relation counts, not scalar DB
  // fields). Sorting one fetches the full set and sorts it in memory; every
  // other column drives a genuine infinite fetch.
  const clientSortColumns = new Set([
    "users",
    "milestoneTypes",
    "milestones",
    "integration",
  ]);
  const isCountSort = clientSortColumns.has(sortConfig.column);
  const debouncedSearchString = useDebounce(searchString, 500);

  const projectsWhere = useMemo(
    () => ({
      AND: [
        {
          name: {
            contains: debouncedSearchString,
            mode: "insensitive" as const,
          },
          isDeleted: false,
        },
      ],
    }),
    [debouncedSearchString]
  );

  const { data: totalCount } = useClientQueries(schema).projects.useCount(
    { where: projectsWhere },
    { enabled: !!session?.user, refetchOnWindowFocus: true }
  );

  // Heavy include shared by both fetch modes: hydrates the members / milestones
  // / integrations each row's columns render.
  const include = useMemo(
    () => ({
      creator: true,
      milestones: {
        include: { milestoneType: { include: { icon: true } } },
        where: { isDeleted: false },
        orderBy: [
          { isStarted: "desc" as const },
          { startedAt: "asc" as const },
          { isCompleted: "asc" as const },
          { completedAt: "desc" as const },
        ],
      },
      milestoneTypes: true,
      projectIntegrations: {
        include: {
          integration: true,
        },
      },

      // Refined includes for user IDs with filtering
      assignedUsers: {
        // Direct assignments
        where: {
          // Filter ProjectAssignment records
          user: {
            // Based on the related User's status
            isActive: true,
            isDeleted: false,
          },
        },
        select: { userId: true }, // Select only the ID of active/not-deleted users
      },
      groupPermissions: {
        // Group permissions link for the project
        select: {
          groupId: true, // Expose groupId for GroupListDisplay column
          accessType: true, // Include accessType to filter later if needed
          // Select only the group relation from the permission
          group: {
            // The actual group
            select: {
              // Select only the user assignments from the group
              assignedUsers: {
                // The GroupAssignment records linking users to this group
                where: {
                  // Filter GroupAssignment records
                  user: {
                    // Based on the related User's status
                    isActive: true,
                    isDeleted: false,
                  },
                },
                select: { userId: true }, // Select the userId from the filtered assignments
              },
            },
          },
        },
      },
      codeRepositoryConfig: {
        select: {
          id: true,
          repository: {
            select: { name: true },
          },
        },
      },
      projectLlmIntegrations: {
        select: {
          isActive: true,
          llmIntegration: {
            select: { name: true, provider: true },
          },
        },
      },
      defaultRole: {
        select: {
          id: true,
          name: true,
        },
      },
    }),
    []
  );

  const orderBy = useMemo(
    () =>
      isCountSort
        ? { name: "asc" as const }
        : { [sortConfig.column]: sortConfig.direction },
    [isCountSort, sortConfig]
  );

  const infiniteBaseArgs = useMemo(
    () => ({ orderBy, include, where: projectsWhere, take: PAGE_SIZE }),
    [orderBy, include, projectsWhere]
  );

  const {
    data: infinitePages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: isLoadingInfinite,
  } = useClientQueries(schema).projects.useInfiniteFindMany(infiniteBaseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return { ...infiniteBaseArgs, skip: allPages.flat().length };
    },
    enabled: !!session?.user && !isCountSort,
    refetchOnWindowFocus: true,
  });

  const { data: allProjectsRaw, isLoading: isLoadingAll } = useClientQueries(
    schema
  ).projects.useFindMany(
    { orderBy: { name: "asc" }, include, where: projectsWhere },
    { enabled: !!session?.user && isCountSort, refetchOnWindowFocus: true }
  );

  const projectsRaw = useMemo(() => {
    if (isCountSort) return allProjectsRaw;
    return infinitePages?.pages.flat();
  }, [isCountSort, allProjectsRaw, infinitePages]);

  const isLoading = isCountSort ? isLoadingAll : isLoadingInfinite;

  // Use the utility function (potentially within useMemo for optimization)
  const projects: ProcessedProject[] = useMemo(
    () => processProjectsWithEffectiveMembers(projectsRaw as any, allUsers), // Pass allUsers for default role calculation
    [projectsRaw, allUsers]
  );

  // Client-side sort by relation count over the full set (count columns only).
  const displayedProjects = useMemo(() => {
    if (!isCountSort || !projects.length) return projects;

    return [...projects].sort((a, b) => {
      let aValue = 0;
      let bValue = 0;
      switch (sortConfig.column) {
        case "users":
          aValue = a.effectiveUserIds?.length ?? 0;
          bValue = b.effectiveUserIds?.length ?? 0;
          break;
        case "milestoneTypes":
          aValue = a.milestoneTypes?.length ?? 0;
          bValue = b.milestoneTypes?.length ?? 0;
          break;
        case "milestones":
          aValue = a.milestones?.length ?? 0;
          bValue = b.milestones?.length ?? 0;
          break;
        case "integration":
          aValue = a.projectIntegrations?.length ?? 0;
          bValue = b.projectIntegrations?.length ?? 0;
          break;
        default:
          return 0;
      }
      return sortConfig.direction === "asc" ? aValue - bValue : bValue - aValue;
    });
  }, [projects, isCountSort, sortConfig]);

  const tableData = isCountSort ? displayedProjects : projects;

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (data.completedAt) {
      setIsAlertDialogOpen(false);
      try {
        if (selectedProjectId !== undefined) {
          await updateProjects({
            where: { id: selectedProjectId },
            data: { isCompleted: true, completedAt: data.completedAt },
          });
        }
      } catch (error) {
        console.error("Failed to update project:", error);
      }
    }
  };

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  const columns: CustomColumnDef<ExtendedProjects>[] = useColumns(
    userPreferences,

    handleToggleCompleted,
    handleOpenEditModal,
    tCommon,
    setDeletingProject
  );

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  if (status === "loading") return null;

  const AddProjectButton = () => (
    <Button onClick={handleOpenAddModal}>
      <CirclePlus className="w-4" />
      <span className="hidden md:inline">{t("add.button")}</span>
    </Button>
  );

  const renderProjectAdminContent = (
    <>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle data-testid="admin-projects-page-title">
                {tGlobal("common.fields.projects")}
              </CardTitle>
            </div>
            <div>
              <AddProjectButton />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col grow w-full sm:w-1/3 min-w-[150px]">
              <div className="">
                <Filter
                  key="project-filter"
                  placeholder={t("filter.placeholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="m-2">
                  <ColumnSelection
                    key="project-column-selection"
                    storageKey="admin-projects"
                    columns={columns}
                    onVisibilityChange={setColumnVisibility}
                  />
                </div>
              </div>
            </div>
            {tableData.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: tableData.length.toLocaleString(),
                  total: (totalCount ?? tableData.length).toLocaleString(),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 w-full">
            <VirtualizedDataTable
              fillViewport
              columns={columns}
              data={tableData || []}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading || isFetchingNextPage}
              hasMore={isCountSort ? false : !!hasNextPage}
              onLoadMore={fetchNextPage}
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-projects-table"
              rowTestIdPrefix="admin-project-row"
            />
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={isAlertDialogOpen} onOpenChange={setIsAlertDialogOpen}>
        <AlertDialogContent className="sm:max-w-[425px] lg:max-w-[400px] border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center">
              {t("complete.title")}
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            {t("complete.description")}
          </AlertDialogDescription>
          <form onSubmit={handleSubmit(onSubmit)}>
            <div className="flex flex-col items-start space-y-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" className="w-[240px]">
                    {completedAt
                      ? format(completedAt, "PPP")
                      : tGlobal("common.placeholders.date")}
                    <CalendarDays className="ms-auto h-4 w-4 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={completedAt ?? undefined}
                    onSelect={(date) => {
                      setCompletedAt(date ?? null);
                      setValue("completedAt", date ?? null, {
                        shouldValidate: true,
                      });
                    }}
                    disabled={(date: any) =>
                      date > new Date() || date < new Date("1900-01-01")
                    }
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
              {errors.completedAt && (
                <p className="text-destructive">{errors.completedAt.message}</p>
              )}
            </div>
            <AlertDialogFooter className="mt-4">
              <AlertDialogCancel onClick={() => setIsAlertDialogOpen(false)}>
                {tCommon("cancel")}
              </AlertDialogCancel>
              <AlertDialogAction
                type="submit"
                className="bg-destructive"
                disabled={!isValid}
              >
                {tCommon("actions.submit")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>

      {editingProject && (
        <EditProjectModal
          key={editingProject.id}
          project={editingProject}
          isOpen={!!editingProject}
          onClose={handleCloseEditModal}
        />
      )}

      {deletingProject && (
        <DeleteProject
          project={deletingProject}
          open={true}
          onClose={() => setDeletingProject(null)}
        />
      )}

      {isAddModalOpen && (
        <CreateProjectWizard
          isOpen={isAddModalOpen}
          onClose={handleCloseAddModal}
        />
      )}
    </>
  );

  return (
    <main>
      {session && session.user.access === "ADMIN" && renderProjectAdminContent}
    </main>
  );
}
