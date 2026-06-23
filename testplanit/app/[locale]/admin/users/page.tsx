"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PaginationProvider,
  usePagination,
} from "~/lib/contexts/PaginationContext";
import { usePageSizeOptions } from "~/hooks/usePageSizeOptions";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import type { UserFindManyArgs } from "~/zenstack/input";
import { ExtendedUser, useColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";

import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CirclePlus } from "lucide-react";
import { toast } from "sonner";
import { AddUser } from "./AddUser";
import { DeleteUser } from "./DeleteUser";
import { EditUser } from "./EditUser";

export default function UserListPage() {
  return (
    <PaginationProvider>
      <UserList />
    </PaginationProvider>
  );
}

function UserList() {
  const t = useTranslations("admin.users");
  const tAdmin = useTranslations("admin.users");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
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
  const [showInactiveUsers, setShowInactiveUsers] = useState<boolean>(false);
  const [addUserOpen, setAddUserOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ExtendedUser | null>(null);
  const [deletingUser, setDeletingUser] = useState<ExtendedUser | null>(null);
  const [forcingUser, setForcingUser] = useState<ExtendedUser | null>(null);
  const [revokingUser, setRevokingUser] = useState<ExtendedUser | null>(null);
  const [isForceLoading, setIsForceLoading] = useState(false);
  const [isRevokeLoading, setIsRevokeLoading] = useState(false);

  // Calculate skip and take based on pageSize
  const effectivePageSize =
    typeof pageSize === "number" ? pageSize : totalItems;
  const skip = (currentPage - 1) * effectivePageSize;

  const handleToggle = useCallback(
    async (id: string, key: keyof ExtendedUser, value: boolean) => {
      try {
        // Use dedicated update API endpoint instead of ZenStack
        // (ZenStack 2.21+ has issues with nested update operations)
        const response = await fetch(`/api/users/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: value }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to update user");
        }

        // Refetch all queries to refresh the table data immediately
        void queryClient.refetchQueries();
      } catch (error) {
        console.error(`Failed to update ${key} for User ${id}`, error);
      }
    },
    [queryClient]
  );

  const handleForceChangePassword = useCallback(async () => {
    if (!forcingUser) return;
    setIsForceLoading(true);
    try {
      const response = await fetch(
        `/api/admin/users/${forcingUser.id}/force-change-password`,
        { method: "POST" }
      );
      if (response.ok) {
        toast.success(
          tAdmin("forcePasswordChangeSuccess", { name: forcingUser.name })
        );
        setForcingUser(null);
      } else {
        toast.error(tAdmin("forcePasswordChangeFailed"));
      }
    } catch {
      toast.error(tAdmin("forcePasswordChangeFailed"));
    } finally {
      setIsForceLoading(false);
    }
  }, [forcingUser, tAdmin]);

  const handleRevokePassword = useCallback(async () => {
    if (!revokingUser) return;
    setIsRevokeLoading(true);
    try {
      const response = await fetch(
        `/api/admin/users/${revokingUser.id}/revoke-password`,
        { method: "POST" }
      );
      if (response.ok) {
        toast.success(
          tAdmin("revokePasswordSuccess", { name: revokingUser.name })
        );
        setRevokingUser(null);
      } else {
        toast.error(tAdmin("revokePasswordFailed"));
      }
    } catch {
      toast.error(tAdmin("revokePasswordFailed"));
    } finally {
      setIsRevokeLoading(false);
    }
  }, [revokingUser, tAdmin]);

  // Sort by `scimGivenName` always puts nulls last so the SCIM-managed users
  // (the non-null rows) appear at the top regardless of asc/desc direction —
  // matches the "SCIM" column UX of "click to find SCIM users."
  const orderBy: NonNullable<UserFindManyArgs["orderBy"]> =
    sortConfig?.column === "scimGivenName"
      ? {
          scimGivenName: {
            sort: sortConfig.direction,
            nulls: "last",
          },
        }
      : sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" };

  const { data: totalFilteredUsers } = useClientQueries(schema).user.useFindMany(
    {
      orderBy,
      include: {
        role: true,
        groups: true,
        projects: true,
        createdBy: true,
      },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          showInactiveUsers ? {} : { isActive: true },
          {
            isDeleted: false,
          },
        ],
      },
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  // Update total items in pagination context
  useEffect(() => {
    if (totalFilteredUsers) {
      setTotalItems(totalFilteredUsers.length);
    }
  }, [totalFilteredUsers, setTotalItems]);

  const { data: users, isLoading } = useClientQueries(schema).user.useFindMany(
    {
      orderBy,
      include: {
        role: true,
        groups: true,
        projects: true,
        createdBy: true,
      },
      where: {
        AND: [
          {
            name: {
              contains: debouncedSearchString,
              mode: "insensitive",
            },
          },
          showInactiveUsers ? {} : { isActive: true },
          {
            isDeleted: false,
          },
        ],
      },
      take: effectivePageSize,
      skip: skip,
    },
    {
      enabled: !!session?.user,
      refetchOnWindowFocus: true,
    }
  );

  const pageSizeOptions = usePageSizeOptions(totalItems);

  const prevSearchStringRef = useRef(searchString);
  const prevPageSizeRef = useRef(pageSize);

  // Reset to first page when search changes
  useEffect(() => {
    if (searchString === prevSearchStringRef.current) return;
    prevSearchStringRef.current = searchString;
    setCurrentPage(1);
  }, [searchString, setCurrentPage]);

  // Reset to first page when page size changes
  useEffect(() => {
    if (pageSize === prevPageSizeRef.current) return;
    prevPageSizeRef.current = pageSize;
    setCurrentPage(1);
  }, [pageSize, setCurrentPage]);

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  // Extract stable primitives from session to avoid column remounts when session object changes
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;
  const userId = session?.user?.id;
  const userPreferences = useMemo(
    () => ({ user: { id: userId, preferences: { dateFormat, timezone } } }),
    [userId, dateFormat, timezone]
  );

  const columns = useColumns(
    userPreferences,
    handleToggle,
    tCommon,
    tAdmin,
    setEditingUser,
    setDeletingUser,
    setForcingUser,
    setRevokingUser
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
    setCurrentPage(1); // Reset to first page when sorting changes
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle data-testid="users-page-title">
                {tGlobal("common.fields.users")}
              </CardTitle>
            </div>
            <div>
              <Button onClick={() => setAddUserOpen(true)}>
                <CirclePlus className="w-4" />
                <span className="hidden md:inline">{t("add.button")}</span>
              </Button>
              {addUserOpen && (
                <AddUser
                  open={addUserOpen}
                  onClose={() => setAddUserOpen(false)}
                />
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="users-filter"
                  placeholder={tGlobal("users.filter")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
                <div className="flex flex-row items-center gap-2 mt-2">
                  <div className="m-2">
                    <ColumnSelection
                      key="project-column-selection"
                      storageKey="admin-users"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor="active-users-checkbox"
                      className="flex items-center gap-2"
                    >
                      <Switch
                        id="active-users-checkbox"
                        checked={showInactiveUsers}
                        onCheckedChange={(checked) => {
                          setShowInactiveUsers(checked);
                        }}
                      />
                      {t("showInactive")}
                    </Label>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col w-full sm:w-2/3 items-end">
              {totalItems > 0 && (
                <>
                  <div className="justify-end">
                    <PaginationInfo
                      key="users-pagination-info"
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
            <DataTable<ExtendedUser, unknown>
              columns={columns}
              data={users || []}
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
      {editingUser && (
        <EditUser
          user={editingUser}
          open={true}
          onClose={() => setEditingUser(null)}
        />
      )}
      {deletingUser && (
        <DeleteUser
          user={deletingUser}
          open={true}
          onClose={() => setDeletingUser(null)}
        />
      )}
      <Dialog
        open={!!forcingUser}
        onOpenChange={(open) => !open && setForcingUser(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tAdmin("forcePasswordChangeDialogTitle")}
            </DialogTitle>
            <DialogDescription>
              {tAdmin("forcePasswordChangeDialogDescription", {
                name: forcingUser?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setForcingUser(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleForceChangePassword}
              disabled={isForceLoading}
            >
              {tAdmin("confirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!revokingUser}
        onOpenChange={(open) => !open && setRevokingUser(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tAdmin("revokePasswordDialogTitle")}</DialogTitle>
            <DialogDescription>
              {tAdmin("revokePasswordDialogDescription", {
                name: revokingUser?.name ?? "",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokingUser(null)}>
              {tCommon("cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevokePassword}
              disabled={isRevokeLoading}
            >
              {tAdmin("confirmAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
