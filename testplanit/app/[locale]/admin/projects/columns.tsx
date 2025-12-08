import { ColumnDef } from "@tanstack/react-table";
import {
  Projects,
  User,
  MilestoneTypesAssignment,
  Integration,
  ProjectIntegration,
} from "@prisma/client";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { DateFormatter } from "@/components/DateFormatter";
import { Switch } from "@/components/ui/switch";
import { DeleteProjectModal } from "./DeleteProject";
import { UserListDisplay } from "@/components/tables/UserListDisplay";
import { ProjectIcon } from "@/components/ProjectIcon";
import { MilestoneTypeListDisplay } from "@/components/tables/MilestoneTypeListDisplay";
import {
  MilestonesWithTypes,
  MilestoneListDisplay,
} from "@/components/tables/MilestoneListDisplay";
import { useTranslations } from "next-intl";
import { Bug, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ExtendedProjects extends Projects {
  creator: User;
  assignedUsers: {
    userId: string;
    projectId: number;
  }[];
  milestones: MilestonesWithTypes[];
  milestoneTypes: MilestoneTypesAssignment[];
  projectIntegrations?: (ProjectIntegration & {
    integration: Integration;
  })[];
  effectiveUserIds: string[];
}

export const getColumns = (
  session: any,
  handleToggleCompleted: (id: number, isCompleted: boolean) => void,
  handleOpenEditModal: (project: ExtendedProjects) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedProjects>[] => {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: tCommon("fields.name"),
      enableSorting: true,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 500,
      cell: ({ row }) => (
        <div className="flex items-start gap-1">
          <span className="mt-1 shrink-0">
            <ProjectIcon iconUrl={row.original.iconUrl} />
          </span>
          <ProjectNameCell
            value={row.original.name}
            projectId={row.original.id}
            note={row.original.note}
          />
        </div>
      ),
    },
    {
      id: "users",
      accessorKey: "users",
      header: tCommon("fields.members"),
      enableResizing: true,
      enableHiding: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <UserListDisplay
            users={row.original.effectiveUserIds.map((id) => ({ userId: id }))}
          />
        </div>
      ),
    },
    {
      id: "milestoneTypes",
      accessorKey: "milestoneTypes",
      header: tCommon("fields.milestoneTypes"),
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <MilestoneTypeListDisplay
            milestoneTypes={row.original.milestoneTypes}
          />
        </div>
      ),
    },
    {
      id: "milestones",
      accessorKey: "milestones",
      header: tCommon("fields.milestones"),
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <MilestoneListDisplay milestones={row.original.milestones} />
        </div>
      ),
    },
    {
      id: "integration",
      accessorKey: "projectIntegrations",
      header: tCommon("fields.issueTracker"),
      enableResizing: true,
      size: 150,
      cell: ({ row }) => {
        const activeIntegration = row.original.projectIntegrations?.find(
          (pi) => pi.isActive
        );
        return (
          <div className="flex items-center gap-1">
            <div className="whitespace-nowrap">
              <Bug className="h-4 w-4 opacity-50" />
            </div>
            <div className="whitespace-nowrap">
              {activeIntegration?.integration.name ??
                tCommon("status.notApplicable")}
            </div>
          </div>
        );
      },
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: tCommon("fields.createdAt"),
      enableSorting: true,
      enableResizing: true,
      size: 100,
      cell: ({ getValue }) => (
        <div className="whitespace-nowrap">
          <DateFormatter
            date={getValue() as Date | string}
            formatString={
              session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"
            }
            timezone={session.user.preferences?.timezone || "Etc/UTC"}
          />
        </div>
      ),
    },
    {
      id: "isCompleted",
      accessorKey: "isCompleted",
      header: tCommon("fields.completed"),
      enableSorting: true,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <Switch
            checked={row.original.isCompleted}
            onCheckedChange={(checked) =>
              handleToggleCompleted(row.original.id, checked)
            }
          />
        </div>
      ),
    },
    {
      id: "completedAt",
      accessorKey: "completedAt",
      header: tCommon("fields.completedOn"),
      enableSorting: true,
      enableResizing: true,
      size: 100,
      cell: ({ getValue }) => (
        <div className="whitespace-nowrap">
          <DateFormatter
            date={getValue() as Date | string}
            formatString={
              session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"
            }
            timezone={session.user.preferences?.timezone || "Etc/UTC"}
          />
        </div>
      ),
    },
    {
      id: "createdBy",
      accessorKey: "createdBy",
      header: tCommon("fields.createdBy"),
      enableSorting: true,
      enableResizing: true,
      size: 150,
      cell: (info) => <UserNameCell userId={info.row.original.creator.id} />,
    },
    {
      id: "actions",
      header: tCommon("fields.actions"),
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "right" },
      size: 120,
      cell: ({ row }) => (
        <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => handleOpenEditModal(row.original)}
          >
            <SquarePen className="h-4 w-4" />
          </Button>
          <DeleteProjectModal
            key={`delete-${row.original.id}`}
            project={row.original}
          />
        </div>
      ),
    },
  ];
};
