"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "~/lib/navigation";
import { useTranslations } from "next-intl";
import {
  usePagination,
  PaginationProvider,
} from "~/lib/contexts/PaginationContext";

import {
  useFindManyMilestoneTypes,
  useUpdateMilestoneTypes,
  useUpdateManyMilestoneTypes,
  useCreateManyMilestoneTypesAssignment,
  useDeleteManyMilestoneTypesAssignment,
  useFindManyProjects,
} from "~/lib/hooks";
import { DataTable } from "@/components/tables/DataTable";
import { ExtendedMilestoneTypes, getColumns } from "./columns";
import { useDebounce } from "@/components/Debounce";
import {
  ColumnSelection,
  CustomColumnDef,
} from "@/components/tables/ColumnSelection";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { AddMilestoneTypeModal } from "./AddMilestoneTypes";
import AddMilestonesToProjectsWizard from "./AddMilestonesToProjectsWizard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

type PageSizeOption = number | "All";

export default function MilestoneTypesListPage() {
  return (
    <PaginationProvider>
      <MilestoneTypesList />
    </PaginationProvider>
  );
}

function MilestoneTypesList() {
  return <MilestoneTypes />;
}

function MilestoneTypes() {
  const t = useTranslations("admin.milestones");
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
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
  const debouncedSearchString = useDebounce(searchString, 500);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const { data: totalFilteredMilestoneTypes } = useFindManyMilestoneTypes(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          {
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
    if (totalFilteredMilestoneTypes) {
      setTotalItems(totalFilteredMilestoneTypes.length);
    }
  }, [totalFilteredMilestoneTypes, setTotalItems]);

  const { data, isLoading } = useFindManyMilestoneTypes(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          {
            isDeleted: false,
          },
        ],
      },
      include: {
        projects: {
          where: {
            project: {
              isDeleted: false,
            },
          },
        },
        icon: true,
      },
      take: effectivePageSize,
      skip: skip,
    },
    {
      enabled:
        (!!session?.user && debouncedSearchString.length === 0) ||
        debouncedSearchString.length > 0,
      refetchOnWindowFocus: true,
    }
  );

  const milestoneTypes = data as ExtendedMilestoneTypes[];

  const { data: projects } = useFindManyProjects({
    where: { isDeleted: false },
  });

  const pageSizeOptions: PageSizeOption[] = useMemo(() => {
    if (totalItems <= 10) {
      return ["All"];
    }
    const options: PageSizeOption[] = [10, 25, 50, 100, 250].filter(
      (size) => size < totalItems || totalItems === 0
    );
    options.push("All");
    return options;
  }, [totalItems]);

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  // Reset to first page when page size changes
  useEffect(() => {
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const [isAlertDialogOpen, setIsAlertDialogOpen] = useState(false);
  const [selectedMilestoneTypeId, setSelectedMilestoneTypeId] = useState<
    number | undefined
  >(undefined);

  const { mutateAsync: updateMilestoneType } = useUpdateMilestoneTypes();
  const { mutateAsync: updateManyMilestoneTypes } =
    useUpdateManyMilestoneTypes();
  const { mutateAsync: createManyMilestoneTypeProjectAssignment } =
    useCreateManyMilestoneTypesAssignment();
  const { mutateAsync: deleteManyMilestoneTypesAssignment } =
    useDeleteManyMilestoneTypesAssignment();

  const handleToggleDefault = useCallback((id: number, isDefault: boolean) => {
    setSelectedMilestoneTypeId(id);
    setIsAlertDialogOpen(true);
  }, []);

  const handleConfirmToggleDefault = async () => {
    setIsAlertDialogOpen(false);
    try {
      if (selectedMilestoneTypeId !== undefined) {
        await updateManyMilestoneTypes({
          where: { isDefault: true },
          data: { isDefault: false },
        });
        await updateMilestoneType({
          where: { id: selectedMilestoneTypeId },
          data: { isDefault: true },
        });

        await deleteManyMilestoneTypesAssignment({
          where: { milestoneTypeId: selectedMilestoneTypeId },
        });

        if (Array.isArray(projects)) {
          await createManyMilestoneTypeProjectAssignment({
            data: projects.map((project) => ({
              projectId: project.id,
              milestoneTypeId: selectedMilestoneTypeId,
            })),
          });
        }
      }
    } catch (error) {
      console.error("Failed to update milestone type:", error);
    }
  };

  const columns: CustomColumnDef<ExtendedMilestoneTypes>[] = useMemo(
    () => getColumns(session, handleToggleDefault, tCommon),
    [session, handleToggleDefault, tCommon]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >(() => {
    const initialVisibility: Record<string, boolean> = {};
    columns.forEach((column) => {
      initialVisibility[column.id as string] = column.meta?.isVisible ?? true;
    });
    return initialVisibility;
  });

  if (status === "loading") return null;

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

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle data-testid="milestones-page-title">
                {t("title")}
              </CardTitle>
            </div>
            <div className="flex gap-2">
              <AddMilestonesToProjectsWizard />
              <AddMilestoneTypeModal />
            </div>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="milestone-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
              </div>
            </div>

            <div className="flex flex-col w-full sm:w-2/3 items-end">
              {totalItems > 0 && (
                <>
                  <div className="justify-end">
                    <PaginationInfo
                      key="milestone-pagination-info"
                      startIndex={startIndex}
                      endIndex={endIndex}
                      totalRows={totalItems}
                      searchString={searchString}
                      pageSize={typeof pageSize === "number" ? pageSize : "All"}
                      pageSizeOptions={pageSizeOptions}
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
            <ColumnSelection
              key="milestone-column-selection"
              columns={columns}
              onVisibilityChange={setColumnVisibility}
            />
          </div>
          <div className="mt-4 flex justify-between">
            <DataTable
              columns={columns}
              data={milestoneTypes}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
              pageSize={effectivePageSize}
            />
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={isAlertDialogOpen} onOpenChange={setIsAlertDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("confirmDefault")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("confirmDefaultDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {t("warning")}
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setSelectedMilestoneTypeId(undefined)}
            >
              {tCommon("actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmToggleDefault}>
              {tCommon("actions.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
