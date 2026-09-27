import { EmailCell } from "@/components/EmailDisplay";
import type { ColumnDef } from "@/components/tables/tableFeatures";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { RoleNameDisplay } from "~/components/RoleNameDisplay";
import type { ProjectAccessRosterEntry } from "~/hooks/useProjectAccessRoster";

/** A roster entry keyed the way DataTable expects (`id`). */
export type AccessRow = ProjectAccessRosterEntry & { id: string };

export const ACCESS_SORT_COLUMNS = ["name", "email", "role", "source"] as const;
export type AccessSortColumn = (typeof ACCESS_SORT_COLUMNS)[number];

const SYSTEM_ACCESS_RANK: Record<AccessRow["systemAccess"], number> = {
  ADMIN: 0,
  PROJECTADMIN: 1,
  USER: 2,
};

/** Client-side sort: the roster is one unpaged fetch, so the page sorts. */
export function sortAccessRows(
  rows: AccessRow[],
  column: AccessSortColumn,
  direction: "asc" | "desc"
): AccessRow[] {
  const sorted = [...rows].sort((a, b) => {
    switch (column) {
      // System admins and project admins lead, then roles alphabetically.
      case "role":
        return (
          SYSTEM_ACCESS_RANK[a.systemAccess] -
            SYSTEM_ACCESS_RANK[b.systemAccess] ||
          (a.effectiveRole?.name ?? "").localeCompare(
            b.effectiveRole?.name ?? ""
          ) ||
          a.name.localeCompare(b.name)
        );
      case "source":
        return a.source.localeCompare(b.source) || a.name.localeCompare(b.name);
      case "email":
        return (
          (a.email ?? "").localeCompare(b.email ?? "") ||
          a.name.localeCompare(b.name)
        );
      default:
        return a.name.localeCompare(b.name);
    }
  });
  return direction === "asc" ? sorted : sorted.reverse();
}

/** The role governing the user here; system access shows as a badge. */
function RoleCell({ row }: { row: AccessRow }) {
  const tCommon = useTranslations("common");
  if (row.systemAccess === "ADMIN") {
    return <Badge variant="default">{tCommon("access.admin")}</Badge>;
  }
  if (row.systemAccess === "PROJECTADMIN") {
    return <Badge variant="secondary">{tCommon("access.projectAdmin")}</Badge>;
  }
  return <RoleNameDisplay role={row.effectiveRole} />;
}

/** Which grant decides the user's access, in the Edit Project dialog's terms. */
function SourceCell({ source }: { source: AccessRow["source"] }) {
  const tCommon = useTranslations("common");
  const tEdit = useTranslations("admin.projects.edit.labels");
  let label: string;
  switch (source) {
    case "SYSTEM_ADMIN":
    case "SYSTEM_PROJECT_ADMIN":
      label = tCommon("fields.systemAccess");
      break;
    case "USER_PERMISSION":
      label = tEdit("userPermissions");
      break;
    case "GROUP_PERMISSION":
      label = tEdit("groupPermissions");
      break;
    default:
      label = tCommon("labels.access.projectDefault");
  }
  return <span className="text-muted-foreground">{label}</span>;
}

export function useAccessColumns(): ColumnDef<AccessRow>[] {
  const tCommon = useTranslations("common");
  const tEdit = useTranslations("admin.projects.edit.labels");
  return useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 320,
        cell: ({ row }) => (
          <div className="flex items-center">
            <UserNameCell userId={row.original.userId} />
          </div>
        ),
      },
      {
        id: "email",
        accessorKey: "email",
        header: tCommon("fields.email"),
        enableSorting: true,
        enableResizing: true,
        size: 240,
        cell: ({ row }) =>
          row.original.email ? <EmailCell email={row.original.email} /> : null,
      },
      {
        id: "role",
        header: tCommon("fields.role"),
        enableSorting: true,
        enableResizing: true,
        size: 220,
        cell: ({ row }) => <RoleCell row={row.original} />,
      },
      {
        id: "source",
        accessorKey: "source",
        header: tEdit("access.effectiveAccess"),
        enableSorting: true,
        enableResizing: true,
        size: 220,
        cell: ({ row }) => <SourceCell source={row.original.source} />,
      },
    ],
    [tCommon, tEdit]
  );
}
