"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "~/lib/navigation";

import { useDebounce } from "@/components/Debounce";
import { VirtualizedDataTable } from "@/components/tables/VirtualizedDataTable";
import { ExtendedRoles, useColumns } from "./columns";

import { Filter } from "@/components/tables/Filter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CirclePlus } from "lucide-react";
import { AddRole } from "./AddRoles";
import { DeleteRole } from "./DeleteRoles";
import { EditRole } from "./EditRoles";

export default function RoleListPage() {
  return <RoleList />;
}

function RoleList() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const t = useTranslations("admin.roles");
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
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<ExtendedRoles | null>(null);
  const [deletingRole, setDeletingRole] = useState<ExtendedRoles | null>(null);
  const debouncedSearchString = useDebounce(searchString, 500);

  const { data: roles, isLoading } = useClientQueries(schema).roles.useFindMany(
    {
      orderBy: sortConfig
        ? { [sortConfig.column]: sortConfig.direction }
        : { name: "asc" },
      include: {
        users: true,
      },
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

  const rolesData = (roles ?? []) as ExtendedRoles[];

  useEffect(() => {
    if (status !== "loading" && !session) {
      router.push("/");
    }
  }, [status, session, router]);

  const { mutateAsync: updateRole } =
    useClientQueries(schema).roles.useUpdate();

  // Stabilize mutation refs — ZenStack's mutateAsync changes identity every render
  const updateRoleRef = useRef(updateRole);
  useEffect(() => {
    updateRoleRef.current = updateRole;
  });

  const handleToggleDefault = useCallback(
    async (id: number, isDefault: boolean) => {
      try {
        if (isDefault) {
          // The single-default DB trigger (tpl_single_default_roles) clears the
          // previous default atomically.
          await updateRoleRef.current({
            where: { id },
            data: { isDefault: true },
          });
        }
      } catch (error) {
        console.error("Failed to update role:", error);
      }
    },
    []
  );

  const columns = useColumns(
    handleToggleDefault,
    tCommon,
    setEditingRole,
    setDeletingRole
  );

  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  if (status === "loading") return null;

  const handleSortChange = (column: string) => {
    const direction =
      sortConfig &&
      sortConfig.column === column &&
      sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };

  if (!session || session.user.access !== "ADMIN") {
    return null;
  }

  return (
    <main>
      <Card>
        <CardHeader className="w-full">
          <div className="flex items-center justify-between text-primary text-2xl md:text-4xl">
            <div>
              <CardTitle>{tGlobal("common.labels.roles")}</CardTitle>
            </div>
            <div>
              <Button onClick={() => setAddRoleOpen(true)}>
                <CirclePlus className="w-4" />
                <span className="hidden md:inline">{t("add.button")}</span>
              </Button>
              {addRoleOpen && (
                <AddRole
                  open={addRoleOpen}
                  onClose={() => setAddRoleOpen(false)}
                />
              )}
            </div>
          </div>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-row items-start justify-between gap-4">
            <div className="flex flex-col grow w-full sm:w-1/2 min-w-[250px]">
              <div className="text-muted-foreground w-full text-nowrap">
                <Filter
                  key="role-filter"
                  placeholder={t("filterPlaceholder")}
                  initialSearchString={searchString}
                  onSearchChange={setSearchString}
                />
              </div>
            </div>

            {rolesData.length > 0 && (
              <p className="text-sm text-muted-foreground shrink-0">
                {tGlobal("admin.auditLogs.showing", {
                  loaded: rolesData.length.toLocaleString(),
                  total: rolesData.length.toLocaleString(),
                })}
              </p>
            )}
          </div>
          <div className="mt-4 w-full">
            <VirtualizedDataTable
              fillViewport
              columns={columns as any}
              data={rolesData}
              onSortChange={handleSortChange}
              sortConfig={sortConfig}
              columnVisibility={columnVisibility}
              onColumnVisibilityChange={setColumnVisibility}
              isLoading={isLoading}
              resetKey={`${debouncedSearchString}|${sortConfig.column}|${sortConfig.direction}`}
              testIdPrefix="admin-roles-table"
              rowTestIdPrefix="admin-role-row"
            />
          </div>
        </CardContent>
      </Card>
      {editingRole && (
        <EditRole
          role={editingRole}
          open={true}
          onClose={() => setEditingRole(null)}
        />
      )}
      {deletingRole && (
        <DeleteRole
          role={deletingRole}
          open={true}
          onClose={() => setDeletingRole(null)}
        />
      )}
    </main>
  );
}
