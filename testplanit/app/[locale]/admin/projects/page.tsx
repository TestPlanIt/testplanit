"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultPageSizeOptions, PaginationProvider, usePagination
} from "~/lib/contexts/PaginationContext";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import {
  ColumnSelection,
  CustomColumnDef
} from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { useFindManyProjects, useFindManyUser, useUpdateProjects } from "~/lib/hooks";
import { ExtendedProjects, getColumns } from "./columns";

import { CreateProjectWizard } from "@/admin/projects/CreateProjectWizard";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditProjectModal } from "./EditProject";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover, PopoverContent, PopoverTrigger
} from "@/components/ui/popover";
import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarDays, CirclePlus } from "lucide-react";
import { Resolver, SubmitHandler, useForm } from "react-hook-form";
import { z } from "zod/v4";
import {
  ProcessedProject, processProjectsWithEffectiveMembers
} from "~/utils/projectUtils";

type PageSizeOption = number | "All";

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
  return (
    <PaginationProvider>
      <ProjectAdmin />
    </PaginationProvider>
  );
}

function ProjectAdmin() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.projects");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const {
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    totalItems,
    setTotalItems,
    startIndex,
    endIndex,
    totalPages,
  } = usePagination();

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

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const { mutateAsync: updateProjects } = useUpdateProjects();

  // Stabilize mutation ref — ZenStack's mutateAsync changes identity every render
  const updateProjectsRef = useRef(updateProjects);
  // eslint-disable-next-line react-hooks/refs
  updateProjectsRef.current = updateProjects;

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isValid },
  } = useForm<FormData>({
    resolver: zodResolver(validationSchema) as Resolver<FormData>,
    mode: "onChange",
    defaultValues: {
      completedAt: null,
    },
  });

  const { data: allUsers } = useFindManyUser({
    where: { isActive: true, isDeleted: false },
    select: { id: true, access: true },
  });

  const handleToggleCompleted = useCallback(
    (id: number, isCompleted: boolean) => {
      setSelectedProjectId(id);
      if (isCompleted) {
        setIsAlertDialogOpen(true);
      } else {
        updateProjectsRef.current({
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

  // Columns that require client-side sorting (relation counts, not scalar DB fields)
  const clientSortColumns = new Set(["users", "milestoneTypes", "milestones", "integration"]);
  const needsClientSideSorting = clientSortColumns.has(sortConfig.column);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;
  const debouncedSearchString = useDebounce(searchString, 500);

  const { data: totalFilteredProjects } = useFindManyProjects(
    {
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
            isDeleted: false,
          },
        ],
      },
    },
    {
      enabled:
        (!!session?.user && debouncedSearchString.length === 0) ||
        debouncedSearchString.length > 0,
      refetchOnWindowFocus: true,
    }
  );

  // Update total items in pagination context
  useEffect(() => {
    if (totalFilteredProjects) {
      setTotalItems(totalFilteredProjects.length);
    }
  }, [totalFilteredProjects, setTotalItems]);

  // 1. Fetch Projects with refined include for direct/group users
  const { data: projectsRaw, isLoading: isLoadingProjects } =
    useFindManyProjects(
      {
        orderBy: !needsClientSideSorting && sortConfig
          ? { [sortConfig.column]: sortConfig.direction }
          : { name: "asc" },
        include: {
          creator: true,
          milestones: {
            include: { milestoneType: { include: { icon: true } } },
            where: { isDeleted: false },
            orderBy: [
              { isStarted: "desc" },
              { startedAt: "asc" },
              { isCompleted: "asc" },
              { completedAt: "desc" },
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
          defaultRole: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        where: {
          AND: [
            {
              name: {
                contains: debouncedSearchString,
                mode: "insensitive",
              },
              isDeleted: false,
            },
          ],
        },
        take: needsClientSideSorting ? undefined : effectivePageSize,
        skip: needsClientSideSorting ? undefined : skip,
      },
      {
        enabled:
          (!!session?.user && debouncedSearchString.length === 0) ||
          debouncedSearchString.length > 0,
        refetchOnWindowFocus: true,
      }
    );

  // Use the utility function (potentially within useMemo for optimization)
  const projects: ProcessedProject[] = useMemo(
    () => processProjectsWithEffectiveMembers(projectsRaw as any, allUsers), // Pass allUsers for default role calculation
    [projectsRaw, allUsers]
  );

  // Client-side sort by relation count, then paginate
  const displayedProjects = useMemo(() => {
    if (!needsClientSideSorting || !projects.length) return projects;

    const sorted = [...projects].sort((a, b) => {
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

    return sorted.slice(skip, skip + effectivePageSize);
  }, [projects, needsClientSideSorting, sortConfig, skip, effectivePageSize]);

  // Use only the project loading state now
  const isLoading = isLoadingProjects;

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  // Reset to first page when page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

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

  const columns: CustomColumnDef<ExtendedProjects>[] = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      getColumns(userPreferences, handleToggleCompleted, handleOpenEditModal, tCommon),
    [userPreferences, handleToggleCompleted, handleOpenEditModal, tCommon]
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
          <div className="flex flex-row items-start">
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
                    columns={columns}
                    onVisibilityChange={setColumnVisibility}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col w-full sm:w-2/3 items-end">
              {totalItems > 0 && (
                <>
                  <div className="justify-end">
                    <PaginationInfo
                      key="project-pagination-info"
                      startIndex={startIndex}
                      endIndex={endIndex}
                      totalRows={totalItems}
                      searchString={searchString}
                      pageSize={typeof pageSize === "number" ? pageSize : "All"}
                      pageSizeOptions={defaultPageSizeOptions}
                      handlePageSizeChange={(size) => setPageSize(size)}
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
          <div className="mt-4 flex justify-between">
            <DataTable
              columns={columns}
              data={(needsClientSideSorting ? displayedProjects : projects) || []}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              pageSize={typeof pageSize === "number" ? pageSize : totalItems}
              isLoading={isLoading}
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
                  <Button variant="outline" className="w-[240px]">
                    {completedAt
                      ? format(completedAt, "PPP")
                      : tGlobal("common.placeholders.date")}
                    <CalendarDays className="ml-auto h-4 w-4 opacity-50" />
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
