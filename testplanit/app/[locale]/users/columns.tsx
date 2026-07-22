import { EmailCell } from "@/components/EmailDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import type { AccessibleProject } from "~/app/actions/getUserAccessibleProjects";
import type { User } from "~/zenstack/models";
import { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";

export interface ExtendedUser extends User {
  // Effective accessible projects, batched by the page and rendered by the
  // Projects column. `undefined` while the batch is still loading.
  accessibleProjects?: AccessibleProject[];
}

// Remove the hooks and only accept the translation function
export const useUserColumns = (tCommon: any): ColumnDef<ExtendedUser>[] =>
  useMemo(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 500,
        cell: ({ row }) => (
          <div className="flex items-center">
            <UserNameCell userId={row.original.id} />
          </div>
        ),
      },
      {
        id: "email",
        accessorKey: "email",
        header: tCommon("fields.email"),
        enableSorting: true,
        enableResizing: true,
        size: 200,
        cell: ({ row }) => <EmailCell email={row.original.email} />,
      },
      {
        id: "projects",
        accessorKey: "projects",
        header: tCommon("fields.projects"),
        enableSorting: false,
        enableResizing: true,
        size: 75,
        cell: ({ row }) => (
          <div className="bg-primary-foreground text-center">
            <ProjectListDisplay
              projects={row.original.accessibleProjects ?? []}
              isLoading={row.original.accessibleProjects === undefined}
            />
          </div>
        ),
      },
    ],
    [tCommon]
  );
