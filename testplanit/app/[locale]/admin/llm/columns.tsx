import { ColumnDef } from "@tanstack/react-table";
import { LlmIntegration, LlmProviderConfig } from "@prisma/client";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { DateFormatter } from "@/components/DateFormatter";
import { Sparkles, CheckCircle, XCircle } from "lucide-react";
import { EditLlmIntegration } from "./EditLlmIntegration";
import { DeleteLlmIntegration } from "./DeleteLlmIntegration";
import { TestLlmIntegration } from "./TestLlmIntegration";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";

export interface ExtendedLlmIntegration extends LlmIntegration {
  llmProviderConfig?: LlmProviderConfig | null;
  isConnected?: boolean;
  projectLlmIntegrations?: { projectId: number }[];
}

export const getColumns = (
  session: any,
  handleToggle: (
    id: number,
    key: string,
    value: boolean,
    llmProviderConfigId?: number
  ) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  t: ReturnType<typeof useTranslations<"admin.llm">>
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
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{row.original.name}</span>
        {row.original.llmProviderConfig?.isDefault && (
          <Badge variant="secondary" className="text-xs">
            {tCommon("fields.default")}
          </Badge>
        )}
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
    cell: ({ row }) => {
      const providerColors: Record<string, string> = {
        OPENAI:
          "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
        ANTHROPIC:
          "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
        AZURE_OPENAI:
          "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
        OLLAMA:
          "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
        CUSTOM_LLM:
          "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
      };

      return (
        <Badge className={providerColors[row.original.provider] || ""}>
          {row.original.provider.replace("_", " ")}
        </Badge>
      );
    },
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
              <CheckCircle className="h-4 w-4 text-green-600" />
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
      const usage = 0; // TODO: Add currentMonthUsage to database schema

      if (!budget || Number(budget) === 0) {
        return (
          <span className="text-sm text-muted-foreground">{t("noBudget")}</span>
        );
      }

      const percentage = (usage / Number(budget)) * 100;
      const isOverBudget = percentage > 100;

      return (
        <div className="space-y-1">
          <div className="text-sm">
            {`$${usage.toFixed(2)} / $${budget.toFixed(2)}`}
          </div>
          <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                isOverBudget
                  ? "bg-red-500"
                  : percentage > 80
                    ? "bg-yellow-500"
                    : "bg-green-500"
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
            session.user.preferences?.dateFormat || "MM_DD_YYYY_DASH"
          }
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
    cell: ({ getValue, row }) => (
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
    id: "actions",
    header: tCommon("actions.actionsLabel"),
    enableResizing: true,
    enableSorting: false,
    enableHiding: false,
    size: 150,
    meta: { isPinned: "right" },
    cell: ({ row }) => (
      <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
        <TestLlmIntegration
          key={`test-${row.original.id}`}
          integration={row.original}
        />
        <EditLlmIntegration
          key={`edit-${row.original.id}`}
          integration={row.original}
        />
        <DeleteLlmIntegration
          key={`delete-${row.original.id}`}
          integration={row.original}
        />
      </div>
    ),
  },
];
