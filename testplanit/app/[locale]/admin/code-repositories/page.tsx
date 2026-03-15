"use client";

import { CodeRepositoryModal } from "@/components/admin/code-repositories/CodeRepositoryModal";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { CirclePlus, GitBranch, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  PaginationProvider, usePagination
} from "~/lib/contexts/PaginationContext";
import {
  useFindManyCodeRepository,
  useUpdateCodeRepository
} from "~/lib/hooks";
import { useRouter } from "~/lib/navigation";
import { CodeRepositoryRow, getColumns } from "./columns";

type PageSizeOption = number | "All";

export default function CodeRepositoriesPage() {
  return (
    <PaginationProvider>
      <CodeRepositoryList />
    </PaginationProvider>
  );
}

function CodeRepositoryList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const tCommon = useTranslations("common");
  const t = useTranslations("admin.codeRepositories");
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
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<CodeRepositoryRow | null>(
    null
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [repoToDelete, setRepoToDelete] = useState<CodeRepositoryRow | null>(
    null
  );

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const queryWhere = useMemo(
    () => ({
      AND: [
        {
          name: {
            contains: debouncedSearchString,
            mode: "insensitive" as const,
          },
        },
        { isDeleted: false },
      ],
    }),
    [debouncedSearchString]
  );

  const queryOrderBy = useMemo(
    () =>
      sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" as const },
    [sortConfig]
  );

  // Query for total filtered repositories (for pagination)
  const { data: totalFilteredRepos } = useFindManyCodeRepository(
    {
      orderBy: queryOrderBy,
      where: queryWhere,
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  // Update total items in pagination context
  useEffect(() => {
    if (totalFilteredRepos) {
      setTotalItems(totalFilteredRepos.length);
    }
  }, [totalFilteredRepos, setTotalItems]);

  // Query for paginated repositories
  const {
    data: repositories,
    isLoading,
    refetch,
  } = useFindManyCodeRepository(
    {
      orderBy: queryOrderBy,
      where: queryWhere,
      take: effectivePageSize,
      skip: skip,
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

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

  // Soft-delete and status update via ZenStack hook
  const { mutate: updateCodeRepository } = useUpdateCodeRepository();

  // Stabilize mutation ref -- ZenStack's mutate changes identity every render
  const updateRef = useRef(updateCodeRepository);
  // eslint-disable-next-line react-hooks/refs
  updateRef.current = updateCodeRepository;

  const handleToggleStatus = useCallback(
    (id: number, currentStatus: string) => {
      const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      updateRef.current(
        { where: { id }, data: { status: newStatus as any } },
        {
          onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["CodeRepository"] }),
          onError: () => toast.error("Failed to update repository status"),
        }
      );
    },
    [queryClient]
  );

  const handleAddRepo = useCallback(() => {
    setSelectedRepo(null);
    setModalOpen(true);
  }, []);

  const handleEditRepo = useCallback((repo: CodeRepositoryRow) => {
    setSelectedRepo(repo);
    setModalOpen(true);
  }, []);

  const handleDeleteClick = useCallback((repo: CodeRepositoryRow) => {
    setRepoToDelete(repo);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!repoToDelete) return;

    updateRef.current(
      {
        where: { id: repoToDelete.id },
        data: { isDeleted: true },
      },
      {
        onSuccess: () => {
          toast.success("Repository deleted");
          refetch();
        },
        onError: (error) => {
          toast.error("Failed to delete repository", {
            description: error.message,
          });
        },
      }
    );
    setDeleteDialogOpen(false);
    setRepoToDelete(null);
  }, [repoToDelete, refetch]);

  // Extract stable primitives from session to avoid column remounts
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userPreferences = useMemo(
    () => ({ user: { preferences: { dateFormat, timezone } } }),
    [dateFormat, timezone]
  );

  const columns = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      getColumns({
        onEdit: handleEditRepo,
        onDelete: handleDeleteClick,
        onToggleStatus: handleToggleStatus,
        tCommon,
        userPreferences,
      }),
    [
      handleEditRepo,
      handleDeleteClick,
      handleToggleStatus,
      tCommon,
      userPreferences,
    ]
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  if (status === "loading") return null;

  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
    setCurrentPage(1);
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle
                data-testid="code-repositories-admin-page-title"
                className="items-center flex"
              >
                <GitBranch className="inline mr-2 h-8 w-8" />
                {t("title")}
              </CardTitle>
              <CardDescription data-testid="code-repositories-admin-page-description">
                {t("description")}
              </CardDescription>
            </div>
            <Button onClick={handleAddRepo}>
              <CirclePlus className="h-4 w-4" />
              <span className="hidden md:inline">{tCommon("add")}</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="code-repo-filter"
                  placeholder="Filter by name..."
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="code-repo-column-selection"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col w-full sm:w-2/3 items-end">
              {totalItems > 0 && (
                <>
                  <div className="justify-end">
                    <PaginationInfo
                      key="code-repo-pagination-info"
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

          {!isLoading && totalItems === 0 && !debouncedSearchString ? (
            <div className="mt-8 flex flex-col items-center justify-center gap-4 py-16 text-center">
              <GitBranch className="h-12 w-12 text-muted-foreground/40" />
              <div>
                <p className="text-lg font-medium">
                  {t("noRepos.title")}
                </p>
                <p className="mt-1 text-sm text-muted-foreground max-w-sm">
                  {t("noRepos.description")}
                </p>
              </div>
              <Button onClick={handleAddRepo}>
                <CirclePlus className="h-4 w-4" />
                {t("addRepository")}
              </Button>
            </div>
          ) : (
            <div className="mt-4 flex justify-between">
              <DataTable<CodeRepositoryRow, unknown>
                columns={columns}
                data={(repositories as unknown as CodeRepositoryRow[]) || []}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                pageSize={typeof pageSize === "number" ? pageSize : totalItems}
                isLoading={isLoading}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {modalOpen && (
        <CodeRepositoryModal
          repository={selectedRepo ?? undefined}
          onClose={() => {
            setModalOpen(false);
            setSelectedRepo(null);
          }}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["CodeRepository"] });
            setModalOpen(false);
            setSelectedRepo(null);
          }}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="max-w-md border-destructive">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              {t("delete.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                {t.rich("delete.confirmMessage", {
                  name: repoToDelete?.name ?? t("delete.fallbackName"),
                  strong: (chunks) => (
                    <span className="font-medium">{chunks}</span>
                  ),
                })}
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
