import { ColumnDef } from "@tanstack/react-table";
import { User } from "@prisma/client";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { EmailCell } from "@/components/EmailDisplay";
import { UserProjectsDisplay } from "@/components/tables/UserProjectsDisplay";

export interface ExtendedUser extends User {
  projects: {
    projectId: number;
  }[];
}

// Remove the hooks and only accept the translation function
export const getColumns = (tCommon: any): ColumnDef<ExtendedUser>[] => [
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
        <UserProjectsDisplay userId={row.original.id} />
      </div>
    ),
  },
];
