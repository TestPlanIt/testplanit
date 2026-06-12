import { DateFormatter } from "@/components/DateFormatter";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { Badge } from "@/components/ui/badge";
import { Integration } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { GiteaPlatformIcon } from "@/components/shared/gitea-family-icon";
import { Link, Plug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { siGithub, siGitlab, siJira, siRedmine } from "simple-icons";
import { DeleteIntegrationButton } from "./DeleteIntegrationButton";
import { EditIntegrationButton } from "./EditIntegrationButton";
import { SyncIntegrationButton } from "./SyncIntegrationButton";
import { TestIntegrationButton } from "./TestIntegrationButton";

const providerIcons: Record<string, React.ReactNode> = {
  JIRA: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d={siJira.path} />
    </svg>
  ),
  GITHUB: (
    <div className="h-4 w-4 rounded bg-gray-900 dark:bg-gray-700 flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="white">
        <path d={siGithub.path} />
      </svg>
    </div>
  ),
  AZURE_DEVOPS: (
    <svg viewBox="0 0 18 18" className="h-4 w-4" fill="currentColor">
      <path d="M17,4v9.74l-4,3.28-6.2-2.26V17L3.29,12.41l10.23.8V4.44Zm-3.41.49L7.85,1V3.29L2.58,4.84,1,6.87v4.61l2.26,1V6.57Z" />
    </svg>
  ),
  GITLAB: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d={siGitlab.path} />
    </svg>
  ),
  REDMINE: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d={siRedmine.path} />
    </svg>
  ),
  SIMPLE_URL: <Link className="h-4 w-4" />,
};

export interface ExtendedIntegration extends Integration {
  projectIntegrations?: { projectId: number }[];
}

export const useColumns = (
  userPreferences: any,
  handleEditIntegration: (integration: Integration) => void,
  handleDeleteClick: (integration: Integration) => void,
  handleTestConnection: (integration: Integration) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  t: ReturnType<typeof useTranslations<"admin.integrations">>,
  _tApiTokens: ReturnType<typeof useTranslations<"admin.apiTokens">>
): ColumnDef<ExtendedIntegration>[] => {
  const dateFormat =
    userPreferences.user.preferences?.dateFormat || "MM_DD_YYYY_DASH";
  const timezone = userPreferences.user.preferences?.timezone || "Etc/UTC";

  return useMemo(
    () => [
      {
        id: "provider",
        accessorKey: "provider",
        header: () => (
          <div className="bg-primary-foreground">
            {tCommon("fields.provider")}
          </div>
        ),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 150,
        cell: ({ row }) => {
          const { provider, settings } = row.original;
          const platform =
            provider === "GITEA" &&
            typeof settings === "object" &&
            settings !== null &&
            "platform" in settings
              ? String((settings as Record<string, unknown>).platform)
              : undefined;
          return (
            <div className="bg-primary-foreground flex items-center gap-2">
              {provider === "GITEA" ? (
                <GiteaPlatformIcon platform={platform} className="h-4 w-4" />
              ) : (
                providerIcons[provider]
              )}
              <span className="font-medium">{provider}</span>
            </div>
          );
        },
      },
      {
        id: "name",
        accessorKey: "name",
        header: tCommon("name"),
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
        header: tCommon("actions.status"),
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
        header: tCommon("fields.projects"),
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
                {tCommon("never")}
              </span>
            );
          }

          return (
            <div className="whitespace-nowrap">
              <DateFormatter
                date={lastSyncAt}
                formatString={dateFormat}
                timezone={timezone}
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
              formatString={dateFormat}
              timezone={timezone}
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
              formatString={dateFormat}
              timezone={timezone}
            />
          </div>
        ),
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
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
    ],
    [
      dateFormat,
      timezone,
      handleEditIntegration,
      handleDeleteClick,
      handleTestConnection,
      tCommon,
      t,
    ]
  );
};
