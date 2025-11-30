import { ColumnDef } from "@tanstack/react-table";
import { Integration } from "@prisma/client";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { DateFormatter } from "@/components/DateFormatter";
import { Link, Plug } from "lucide-react";
import { siJira, siGithub } from "simple-icons";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { EditIntegrationButton } from "./EditIntegrationButton";
import { DeleteIntegrationButton } from "./DeleteIntegrationButton";
import { TestIntegrationButton } from "./TestIntegrationButton";
import { SyncIntegrationButton } from "./SyncIntegrationButton";

const JiraIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d={siJira.path} />
  </svg>
);

const GithubIcon = ({ className }: { className: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d={siGithub.path} />
  </svg>
);

const providerIcons: Record<string, React.ReactNode> = {
  JIRA: <JiraIcon className="h-4 w-4" />,
  GITHUB: <GithubIcon className="h-4 w-4" />,
  AZURE_DEVOPS: <JiraIcon className="h-4 w-4" />,
  SIMPLE_URL: <Link className="h-4 w-4" />,
};

export interface ExtendedIntegration extends Integration {
  projectIntegrations?: { projectId: number }[];
}

export const getColumns = (
  session: any,
  handleEditIntegration: (integration: Integration) => void,
  handleDeleteClick: (integration: Integration) => void,
  handleTestConnection: (integration: Integration) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  t: ReturnType<typeof useTranslations<"admin.integrations">>
): ColumnDef<ExtendedIntegration>[] => [
  {
    id: "provider",
    accessorKey: "provider",
    header: () => (
      <div className="bg-primary-foreground">{t("table.provider")}</div>
    ),
    enableSorting: true,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "left" },
    size: 150,
    cell: ({ row }) => (
      <div className="bg-primary-foreground flex items-center gap-2">
        {providerIcons[row.original.provider]}
        <span className="font-medium">{row.original.provider}</span>
      </div>
    ),
  },
  {
    id: "name",
    accessorKey: "name",
    header: tCommon("fields.name"),
    enableSorting: true,
    enableResizing: true,
    size: 200,
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <Plug className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{row.original.name}</span>
      </div>
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: tCommon("fields.status"),
    enableSorting: true,
    enableResizing: true,
    size: 150,
    cell: ({ row }) => {
      const statusColors: Record<string, string> = {
        ACTIVE: "default",
        INACTIVE: "secondary",
        ERROR: "destructive",
      };

      return (
        <Badge variant={statusColors[row.original.status] as any}>
          {t(`status.${row.original.status.toLowerCase()}` as any)}
        </Badge>
      );
    },
  },
  {
    id: "projects",
    accessorKey: "projectIntegrations",
    header: t("assignedProjects"),
    enableSorting: false,
    enableResizing: true,
    size: 75,
    cell: ({ row }) => {
      const projects = row.original.projectIntegrations || [];

      if (projects.length === 0) {
        return null;
      }

      return <ProjectListDisplay projects={projects} usePopover={true} />;
    },
  },
  {
    id: "lastSyncAt",
    accessorKey: "lastSyncAt",
    header: t("table.lastSync"),
    enableSorting: true,
    enableResizing: true,
    size: 180,
    cell: ({ getValue }) => {
      const lastSyncAt = getValue() as Date | string | null;

      if (!lastSyncAt) {
        return (
          <span className="text-sm text-muted-foreground">
            {t("table.never")}
          </span>
        );
      }

      return (
        <div className="whitespace-nowrap">
          <DateFormatter
            date={lastSyncAt}
            formatString={session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"}
            timezone={session.user.preferences?.timezone || "Etc/UTC"}
          />
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
    enableHiding: true,
    meta: { isVisible: false },
    size: 150,
    cell: ({ getValue }) => (
      <div className="whitespace-nowrap">
        <DateFormatter
          date={getValue() as Date | string}
          formatString={session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"}
          timezone={session.user.preferences?.timezone || "Etc/UTC"}
        />
      </div>
    ),
  },
  {
    id: "updatedAt",
    accessorKey: "updatedAt",
    header: tCommon("fields.updatedAt"),
    enableSorting: true,
    enableResizing: true,
    enableHiding: true,
    meta: { isVisible: false },
    size: 150,
    cell: ({ getValue }) => (
      <div className="whitespace-nowrap">
        <DateFormatter
          date={getValue() as Date | string}
          formatString={session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"}
          timezone={session.user.preferences?.timezone || "Etc/UTC"}
        />
      </div>
    ),
  },
  {
    id: "actions",
    header: tCommon("fields.actions"),
    enableResizing: true,
    enableSorting: false,
    enableHiding: false,
    size: 200,
    meta: { isPinned: "right" },
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
        <SyncIntegrationButton
          key={`sync-${row.original.id}`}
          integration={row.original}
        />
        <TestIntegrationButton
          key={`test-${row.original.id}`}
          integration={row.original}
          onTest={handleTestConnection}
        />
        <EditIntegrationButton
          key={`edit-${row.original.id}`}
          integration={row.original}
          onEdit={handleEditIntegration}
        />
        <DeleteIntegrationButton
          key={`delete-${row.original.id}`}
          integration={row.original}
          onDelete={handleDeleteClick}
        />
      </div>
    ),
  },
];
