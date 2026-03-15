import { DateFormatter } from "@/components/DateFormatter";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { LlmIntegration, LlmProviderConfig } from "@prisma/client";
import { ColumnDef } from "@tanstack/react-table";
import { CheckCircle, Sparkles, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { type MutableRefObject } from "react";
import { getProviderColor } from "~/lib/llm/provider-styles";
import { DeleteLlmIntegration } from "./DeleteLlmIntegration";
import { EditLlmIntegration } from "./EditLlmIntegration";
import { TestLlmIntegration } from "./TestLlmIntegration";

export interface ExtendedLlmIntegration extends LlmIntegration {
  llmProviderConfig?: LlmProviderConfig | null;
  isConnected?: boolean;
  projectLlmIntegrations?: { projectId: number }[];
}

export const getColumns = (
  userPreferences: any,
  handleToggle: (
    id: number,
    key: string,
    value: boolean,
    llmProviderConfigId?: number
  ) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  t: ReturnType<typeof useTranslations<"admin.llm">>,
  usageByIntegrationIdRef: MutableRefObject<Map<number, number>>,
  totalIntegrations: number = 0
): ColumnDef<ExtendedLlmIntegration>[] => [
  {
    id: "name",
    accessorKey: "name",
    header: () => (
      <div className="bg-primary-foreground">{tCommon("name")}</div>
    ),
    enableSorting: true,
    enableResizing: true,
    enableHiding: false,
    meta: { isPinned: "left" },
    size: 300,
    cell: ({ row }) => (
      <div className="bg-primary-foreground flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="font-medium">{row.original.name}</span>
      </div>
    ),
  },
  {
    id: "provider",
    accessorKey: "provider",
    header: tCommon("fields.provider"),
    enableSorting: true,
    enableResizing: true,
    size: 150,
    cell: ({ row }) => (
      <Badge className={getProviderColor(row.original.provider)}>
        {row.original.provider.replace("_", " ")}
      </Badge>
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
      const isActive = row.original.status === "ACTIVE";
      const isConnected = row.original.isConnected;

      return (
        <div className="flex items-center gap-2">
          <Badge variant={isActive ? "default" : "secondary"}>
            {row.original.status}
          </Badge>
          {isConnected !== undefined &&
            (isConnected ? (
              <CheckCircle className="h-4 w-4 text-success" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            ))}
        </div>
      );
    },
  },

  {
    id: "projects",
    accessorKey: "projectLlmIntegrations",
    header: tCommon("fields.projects"),
    enableSorting: false,
    enableResizing: true,
    size: 75,
    cell: ({ row }) => {
      const projects = row.original.projectLlmIntegrations || [];

      if (projects.length === 0) {
        return null;
      }

      return <ProjectListDisplay projects={projects} usePopover={true} />;
    },
  },
  {
    id: "defaultModel",
    accessorKey: "llmProviderConfig.defaultModel",
    header: t("defaultModel"),
    enableSorting: false,
    enableResizing: true,
    size: 200,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.llmProviderConfig?.defaultModel || t("notConfigured")}
      </span>
    ),
  },
  {
    id: "monthlyBudget",
    accessorKey: "llmProviderConfig.monthlyBudget",
    header: t("budgetUsage"),
    enableSorting: false,
    enableResizing: true,
    size: 200,
    cell: ({ row }) => {
      const budget = row.original.llmProviderConfig?.monthlyBudget;
      const usage = usageByIntegrationIdRef.current.get(row.original.id) ?? 0;

      if (!budget || Number(budget) === 0) {
        return (
          <span className="text-sm text-muted-foreground">
            {`$${usage.toFixed(4)}`}
          </span>
        );
      }

      const percentage = (usage / Number(budget)) * 100;
      const isOverBudget = percentage > 100;

      return (
        <div className="space-y-1">
          <div className="text-sm">
            {`$${usage.toFixed(4)} / $${Number(budget).toFixed(2)}`}
          </div>
          <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                isOverBudget
                  ? "bg-destructive"
                  : percentage > 80
                    ? "bg-warning"
                    : "bg-success"
              }`}
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>
        </div>
      );
    },
  },
  {
    id: "streamingEnabled",
    accessorKey: "llmProviderConfig.streamingEnabled",
    header: t("streaming"),
    enableSorting: false,
    enableResizing: true,
    enableHiding: true,
    meta: { isVisible: false },
    size: 100,
    cell: ({ row }) => (
      <div className="text-center">
        <Switch
          checked={row.original.llmProviderConfig?.streamingEnabled || false}
          onCheckedChange={(checked) =>
            handleToggle(
              row.original.id,
              "streamingEnabled",
              checked,
              row.original.llmProviderConfig?.id
            )
          }
        />
      </div>
    ),
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
    cell: ({ getValue, row }) => (
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
    id: "updatedAt",
    accessorKey: "updatedAt",
    header: tCommon("fields.updatedAt"),
    enableSorting: true,
    enableResizing: true,
    enableHiding: true,
    meta: { isVisible: false },
    size: 150,
    cell: ({ getValue, row }) => (
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
    id: "isDefault",
    accessorKey: "llmProviderConfig.isDefault",
    header: tCommon("fields.default"),
    enableSorting: false,
    enableResizing: true,
    size: 100,
    cell: ({ row }) => (
      <div className="text-center">
        <Switch
          checked={row.original.llmProviderConfig?.isDefault || false}
          disabled={row.original.llmProviderConfig?.isDefault}
          onCheckedChange={(checked) =>
            handleToggle(
              row.original.id,
              "isDefault",
              checked,
              row.original.llmProviderConfig?.id
            )
          }
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
    size: 150,
    meta: { isPinned: "right" },
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex">
        <TestLlmIntegration
          key={`test-${row.original.id}`}
          integration={row.original}
        />
        <EditLlmIntegration
          key={`edit-${row.original.id}`}
          integration={row.original}
          currentSpend={usageByIntegrationIdRef.current.get(row.original.id) ?? 0}
        />
        <DeleteLlmIntegration
          key={`delete-${row.original.id}`}
          integration={row.original}
          isOnlyIntegration={totalIntegrations <= 1}
        />
      </div>
    ),
  },
];
