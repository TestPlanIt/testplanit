"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useAccessibleProjectsForUsers } from "~/hooks/useAccessibleProjectsForUsers";
import { useDebounce } from "@/components/Debounce";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import type { UserFindManyArgs } from "~/zenstack/input";
import { ExtendedUser, useColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";

import { Button } from "@/components/ui/button";
import { HelpPopover } from "@/components/ui/help-popover";
import { SectionHeader } from "@/components/ui/typography";
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
  return <UserList />;
}

const PAGE_SIZE = 50;

function UserList() {
  const locale = useLocale();
  const t = useTranslations("admin.users");
  const tAdmin = useTranslations("admin.users");
  const tGlobal = useTranslations();
  const tCommon = useTranslations("common");
  const { data: session, status } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
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

  // The SCIM column displays Yes/No, so it sorts by SCIM-ness like a boolean:
  // ascending puts non-SCIM (No) first, descending puts SCIM-managed (Yes)
  // first. The nulls placement is what encodes that — the given name only
  // orders rows within the SCIM block.
  // A trailing `id` tiebreaker keeps offset pagination stable when the primary
  // sort key isn't unique (otherwise pages can duplicate or skip rows).
  const orderBy: NonNullable<UserFindManyArgs["orderBy"]> = useMemo(
    () =>
      sortConfig?.column === "scimGivenName"
        ? [
            sortConfig.direction === "asc"
              ? {
                  scimGivenName: {
                    sort: "asc" as const,
                    nulls: "first" as const,
                  },
                }
              : {
                  scimGivenName: {
                    sort: "desc" as const,
                    nulls: "last" as const,
                  },
                },
            { id: "asc" },
          ]
        : sortConfig
          ? [{ [sortConfig.column]: sortConfig.direction }, { id: "asc" }]
          : [{ name: "asc" }, { id: "asc" }],
    [sortConfig]
  );

  const usersWhere = useMemo(
    () => ({
      AND: [
        {
          name: {
            contains: debouncedSearchString,
            mode: "insensitive" as const,
          },
        },
        showInactiveUsers ? {} : { isActive: true },
        { isDeleted: false },
      ],
    }),
    [debouncedSearchString, showInactiveUsers]
  );

  // `groups` and `projects` (assignments) prefill the Edit dialog; only
  // `createdBy.id` is read by the Created By column.
  const include = useMemo(
    () => ({
      groups: true,
      projects: true,
      createdBy: { select: { id: true } },
    }),
    []
  );

  const infiniteBaseArgs = useMemo(
    () => ({ orderBy, include, where: usersWhere, take: PAGE_SIZE }),
    [orderBy, include, usersWhere]
  );

  const { data: totalCount } = useClientQueries(schema).user.useCount(
    { where: usersWhere },
    { enabled: !!session?.user, refetchOnWindowFocus: true }
  );

  // Fetch-on-scroll: pages of users load as the sentinel scrolls into view, so
  // an instance with tens of thousands of users never loads the full set.
  const {
    data: infinitePages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useClientQueries(schema).user.useInfiniteFindMany(infiniteBaseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return { ...infiniteBaseArgs, skip: allPages.flat().length };
    },
    enabled: !!session?.user,
    refetchOnWindowFocus: true,
  });

  const baseRows = useMemo(
    () => infinitePages?.pages.flat() ?? [],
    [infinitePages]
  );

  const resetKey = `${debouncedSearchString}|${showInactiveUsers}|${sortConfig.column}|${sortConfig.direction}`;

  // Resolve each loaded page's effective accessible projects incrementally
  // (bounded per-page batches), instead of one ~8-query action per rendered row.
  const userIds = useMemo(() => baseRows.map((u) => u.id), [baseRows]);
  const projectsByUser = useAccessibleProjectsForUsers(userIds, resetKey);

  const userRows = useMemo(
    () =>
      baseRows.map((u) => ({
        ...u,
        accessibleProjects: projectsByUser[u.id],
      })) as unknown as ExtendedUser[],
    [baseRows, projectsByUser]
  );

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
  // Hide-column requests from the table's header menu are routed through the
  // Columns control (the visibility owner) so persistence and its checkboxes
  // stay in sync.
  const hideColumnRef = useRef<((columnId: string) => void) | null>(null);

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

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // returns to the default name order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig({ column: "name", direction: "asc" });
    } else {
      setSortConfig({ column, direction });
    }
  };

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between gap-2">
            <SectionHeader className="flex items-center gap-2">
              <CardTitle data-testid="users-page-title">
                {tGlobal("common.fields.users")}
              </CardTitle>
              <HelpPopover helpKey="users" />
            </SectionHeader>
            <Button
              onClick={() => setAddUserOpen(true)}
              aria-label={t("add.button")}
              className="group gap-0 transition-all duration-200 hover:gap-2"
            >
              <CirclePlus className="h-4 w-4" />
              <span className="max-w-0 overflow-hidden whitespace-nowrap transition-all duration-200 group-hover:max-w-xs">
                {t("add.button")}
              </span>
            </Button>
          </div>
          {addUserOpen && (
            <AddUser open={addUserOpen} onClose={() => setAddUserOpen(false)} />
          )}
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
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
                      hideColumnRef={hideColumnRef}
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

            {userRows.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: userRows.length.toLocaleString(locale),
                  total: (totalCount ?? userRows.length).toLocaleString(locale),
                })}
              </p>
            )}
          </div>

          <div className="mt-4 w-full">
            <DataTable
              virtualized
              fillViewport
              columns={columns as any}
              data={userRows}
              onSortChange={handleSortChange}
              onSortColumn={handleSortColumn}
              onHideColumn={(columnId) => hideColumnRef.current?.(columnId)}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading || isFetchingNextPage}
              hasMore={!!hasNextPage}
              onLoadMore={fetchNextPage}
              resetKey={resetKey}
              testIdPrefix="admin-users-table"
              rowTestIdPrefix="admin-user-row"
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
