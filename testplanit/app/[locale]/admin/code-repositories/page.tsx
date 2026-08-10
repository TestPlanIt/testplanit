"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { CodeRepositoryModal } from "@/components/admin/code-repositories/CodeRepositoryModal";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
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
import { SectionHeader } from "@/components/ui/typography";
import { HelpPopover } from "@/components/ui/help-popover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { CirclePlus, GitBranch, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "~/lib/navigation";
import { CodeRepositoryRow, getColumns } from "./columns";

export default function CodeRepositoriesPage() {
  return <CodeRepositoryList />;
}

function CodeRepositoryList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const locale = useLocale();
  const tCommon = useTranslations("common");
  const t = useTranslations("admin.codeRepositories");
  const tGlobal = useTranslations();
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

  // Single full-set fetch feeds the virtualized table directly; the table
  // renders only the visible window so there's no page seam and no need for a
  // separate count query (the loaded array length IS the total).
  const {
    data: repositories,
    isLoading,
    refetch,
  } = useClientQueries(schema).codeRepository.useFindMany(
    {
      orderBy: queryOrderBy,
      where: queryWhere,
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  const repoRows = useMemo(
    () => (repositories as unknown as CodeRepositoryRow[]) || [],
    [repositories]
  );

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  // Soft-delete and status update via ZenStack hook
  const { mutate: updateCodeRepository } =
    useClientQueries(schema).codeRepository.useUpdate();

  // Stabilize mutation ref -- ZenStack's mutate changes identity every render
  const updateRef = useRef(updateCodeRepository);
  useEffect(() => {
    updateRef.current = updateCodeRepository;
  });

  const handleToggleStatus = useCallback(
    (id: number, currentStatus: string) => {
      const newStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      updateRef.current(
        { where: { id }, data: { status: newStatus as any } },
        {
          onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ["CodeRepository"] }),
          onError: () =>
            toast.error(tCommon("errors.failedToUpdateRepositoryStatus")),
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
          toast.success(tCommon("errors.repositoryDeleted"));
          void refetch();
        },
        onError: (error) => {
          toast.error(tCommon("errors.failedToDeleteRepository"), {
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
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="code-repositories-admin-page-title">
                {t("title")}
              </CardTitle>
              <HelpPopover helpKey="codeRepositories" />
            </SectionHeader>
            <Button
              onClick={handleAddRepo}
              aria-label={tCommon("add")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <CirclePlus className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {tCommon("add")}
              </span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="code-repo-filter"
                  placeholder={tCommon("placeholders.filterByName")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="code-repo-column-selection"
                      storageKey="admin-code-repositories"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                </div>
              </div>
            </div>

            {repoRows.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: repoRows.length.toLocaleString(locale),
                  total: repoRows.length.toLocaleString(locale),
                })}
              </p>
            )}
          </div>

          {!isLoading && repoRows.length === 0 && !debouncedSearchString ? (
            <div className="mt-8 flex flex-col items-center justify-center gap-4 py-16 text-center">
              <GitBranch className="h-12 w-12 text-muted-foreground/40" />
              <div>
                <p className="text-lg font-medium">{t("noRepos.title")}</p>
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
            <div className="mt-4 w-full">
              <DataTable
                virtualized
                fillViewport
                columns={columns as any}
                data={repoRows}
                onSortChange={handleSortChange}
                sortConfig={sortConfig}
                columnVisibility={columnVisibility}
                onColumnVisibilityChange={setColumnVisibility}
                isLoading={isLoading}
                resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
                testIdPrefix="admin-code-repositories-table"
                rowTestIdPrefix="admin-code-repository-row"
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
            void queryClient.invalidateQueries({
              queryKey: ["CodeRepository"],
            });
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
                    <span className="font-medium break-all">{chunks}</span>
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
