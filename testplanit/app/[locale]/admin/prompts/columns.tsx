import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { DateFormatter } from "@/components/DateFormatter";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type {
  Projects,
  PromptConfig,
  PromptConfigPrompt,
} from "~/zenstack/models";
import { ColumnDef } from "@tanstack/react-table";
import { Edit, MessageSquareCode, Trash } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

export interface PromptConfigPromptWithIntegration extends PromptConfigPrompt {
  llmIntegration?: { id: number; name: string } | null;
}

export interface ExtendedPromptConfig extends PromptConfig {
  prompts?: PromptConfigPromptWithIntegration[];
  projects?: Projects[];
}

/** Wrapper component that fetches the count of projects using the default prompt config (explicitly assigned or null promptConfigId). */
function DefaultPromptProjectList({ configId }: { configId: string }) {
  const filter = {
    OR: [{ promptConfigId: configId }, { promptConfigId: null }],
  };
  const { data: count } = useClientQueries(schema).projects.useCount({
    where: { isDeleted: false, ...filter },
  });

  return (
    <ProjectListDisplay
      filter={filter}
      count={typeof count === "number" ? count : undefined}
    />
  );
}

export const useColumns = (
  userPreferences: any,
  handleToggleDefault: (id: string, currentIsDefault: boolean) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  t: ReturnType<typeof useTranslations<"admin.prompts">>,
  onEditConfig?: (config: ExtendedPromptConfig) => void,
  onDeleteConfig?: (config: ExtendedPromptConfig) => void
): ColumnDef<ExtendedPromptConfig>[] => {
  const dateFormat = userPreferences?.user?.preferences?.dateFormat;
  const timezone = userPreferences?.user?.preferences?.timezone;

  return useMemo(
    () => [
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
        size: 240,
        cell: ({ row }) => (
          <div className="bg-primary-foreground flex items-center gap-2">
            <MessageSquareCode className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{row.original.name}</span>
            {row.original.isDefault && (
              <Badge variant="secondary" className="text-xs">
                {tCommon("fields.default")}
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "description",
        accessorKey: "description",
        header: tCommon("fields.description"),
        enableSorting: true,
        enableResizing: true,
        size: 250,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.description || "-"}
          </span>
        ),
      },
      {
        id: "llmIntegrations",
        header: t("llmColumn"),
        enableSorting: false,
        enableResizing: true,
        size: 160,
        cell: ({ row }) => {
          const prompts = row.original.prompts || [];
          // Collect unique non-null integration IDs with names
          const integrationMap = new Map<number, string>();
          for (const p of prompts) {
            if (p.llmIntegrationId && p.llmIntegration) {
              integrationMap.set(p.llmIntegrationId, p.llmIntegration.name);
            }
          }

          if (integrationMap.size === 0) {
            return (
              <span className="text-sm text-muted-foreground">
                {t("llmIntegrationPlaceholder")}
              </span>
            );
          }

          if (integrationMap.size === 1) {
            const [, name] = [...integrationMap.entries()][0];
            return (
              <Badge variant="outline" className="text-xs">
                {name}
              </Badge>
            );
          }

          // Mixed integrations
          return (
            <Badge variant="secondary" className="text-xs">
              {t("mixedLlms", { count: integrationMap.size })}
            </Badge>
          );
        },
      },
      {
        id: "projects",
        header: tCommon("fields.projects"),
        enableSorting: false,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => {
          if (row.original.isDefault) {
            return (
              <div className="text-center">
                <DefaultPromptProjectList configId={row.original.id} />
              </div>
            );
          }
          const projects = row.original.projects || [];
          return (
            <div className="text-center">
              <ProjectListDisplay projects={projects} />
            </div>
          );
        },
      },
      {
        id: "isDefault",
        accessorKey: "isDefault",
        header: tCommon("fields.default"),
        enableSorting: false,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <div className="text-center">
            <Switch
              aria-label={tCommon("fields.default")}
              checked={row.original.isDefault}
              disabled={row.original.isDefault}
              onCheckedChange={() =>
                handleToggleDefault(row.original.id, row.original.isDefault)
              }
            />
          </div>
        ),
      },
      {
        id: "isActive",
        accessorKey: "isActive",
        header: tCommon("fields.isActive"),
        enableSorting: true,
        enableResizing: true,
        size: 100,
        cell: ({ row }) => (
          <Badge variant={row.original.isActive ? "default" : "secondary"}>
            {row.original.isActive ? "Active" : "Inactive"}
          </Badge>
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
        cell: ({ getValue }) => (
          <div className="whitespace-nowrap">
            <DateFormatter
              date={getValue() as Date | string}
              formatString={dateFormat || "MM_DD_YYYY_DASH"}
              timezone={timezone || "Etc/UTC"}
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
              formatString={dateFormat || "MM_DD_YYYY_DASH"}
              timezone={timezone || "Etc/UTC"}
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
        size: 100,
        meta: { isPinned: "right" },
        cell: ({ row }) => (
          <div className="bg-primary-foreground whitespace-nowrap flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onEditConfig?.(row.original)}
              className="px-2 py-1 h-auto"
              aria-label={tCommon("actions.edit")}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="destructive"
              size="icon"
              onClick={() => onDeleteConfig?.(row.original)}
              className="px-2 py-1 h-auto"
              disabled={row.original.isDefault}
              title={
                row.original.isDefault ? t("cannotDeleteDefault") : undefined
              }
              aria-label={tCommon("actions.delete")}
            >
              <Trash className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [
      tCommon,
      t,
      handleToggleDefault,
      onEditConfig,
      onDeleteConfig,
      dateFormat,
      timezone,
    ]
  );
};
