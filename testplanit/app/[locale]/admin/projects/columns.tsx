import { DateFormatter } from "@/components/DateFormatter";
import { RelativeTimeTooltip } from "@/components/RelativeTimeTooltip";
import { ProjectIcon } from "@/components/ProjectIcon";
import { GroupListDisplay } from "@/components/tables/GroupListDisplay";
import {
  MilestoneListDisplay, MilestonesWithTypes
} from "@/components/tables/MilestoneListDisplay";
import { MilestoneTypeListDisplay } from "@/components/tables/MilestoneTypeListDisplay";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { UserListDisplay } from "@/components/tables/UserListDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Integration, MilestoneTypesAssignment, ProjectIntegration, Projects,
  User
} from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { Bug, GitBranchIcon, SquarePen } from "lucide-react";
import { useTranslations } from "next-intl";
import { LlmProviderBadge } from "~/lib/llm/provider-styles";
import { DeleteProjectModal } from "./DeleteProject";

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
  groupPermissions: {
    groupId: number;
  }[];
  codeRepositoryConfig: {
    id: number;
    repository: { name: string };
  } | null;
  projectLlmIntegrations: {
    isActive: boolean;
    llmIntegration: { name: string; provider: string };
  }[];
  effectiveUserIds: string[];
}

export const getColumns = (
  userPreferences: any,
  handleToggleCompleted: (id: number, isCompleted: boolean) => void,
  handleOpenEditModal: (project: ExtendedProjects) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedProjects>[] => {
  return [
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
      enableSorting: true,
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
      id: "groups",
      accessorKey: "groups",
      accessorFn: (row) => row.groupPermissions,
      header: tCommon("fields.groups"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <GroupListDisplay groups={row.original.groupPermissions} />
        </div>
      ),
    },
    {
      id: "milestoneTypes",
      accessorKey: "milestoneTypes",
      header: tCommon("fields.milestoneTypes"),
      enableSorting: true,
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
      enableSorting: true,
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
      enableSorting: true,
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
      id: "codeRepository",
      accessorKey: "codeRepositoryConfig",
      header: tCommon("fields.codeRepository"),
      enableSorting: false,
      enableResizing: true,
      size: 150,
      cell: ({ row }) => {
        const config = row.original.codeRepositoryConfig;
        return (
          <div
            className="flex items-center gap-1"
            data-testid="code-repo-indicator"
            data-active={!!config}
          >
            <GitBranchIcon
              className={`h-4 w-4 shrink-0 ${config ? "text-primary" : "opacity-25"}`}
            />
            <span className="truncate whitespace-nowrap">
              {config
                ? config.repository.name
                : tCommon("status.notApplicable")}
            </span>
          </div>
        );
      },
    },
    {
      id: "aiModels",
      accessorKey: "projectLlmIntegrations",
      accessorFn: (row) => row.projectLlmIntegrations,
      header: tCommon("fields.aiModels"),
      enableSorting: false,
      enableResizing: true,
      size: 150,
      cell: ({ row }) => {
        const activeModels = row.original.projectLlmIntegrations?.filter(
          (i) => i.isActive
        );
        const hasActive = activeModels && activeModels.length > 0;
        if (!hasActive) {
          return (
            <span className="text-muted-foreground text-sm" data-testid="ai-model-indicator" data-active={false}>
              {tCommon("status.notApplicable")}
            </span>
          );
        }
        return (
          <div className="flex flex-wrap gap-1" data-testid="ai-model-indicator" data-active={true}>
            {activeModels.map((m) => (
              <LlmProviderBadge
                key={m.llmIntegration.name}
                provider={m.llmIntegration.provider}
                name={m.llmIntegration.name}
                showIcon
              />
            ))}
          </div>
        );
      },
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: tCommon("fields.created"),
      enableSorting: true,
      enableResizing: true,
      size: 100,
      cell: ({ getValue }) => {
        const date = getValue() as Date | string;
        return date ? (
          <div className="whitespace-nowrap">
            <RelativeTimeTooltip date={date} />
          </div>
        ) : null;
      },
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
              userPreferences.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"
            }
            timezone={userPreferences.user.preferences?.timezone || "Etc/UTC"}
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
      header: tCommon("actions.actionsLabel"),
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "right" },
      size: 80,
      cell: ({ row }) => (
        <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleOpenEditModal(row.original)}
            className="px-2 py-1 h-auto"
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
