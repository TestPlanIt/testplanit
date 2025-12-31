import { ColumnDef } from "@tanstack/react-table";
import { Status } from "@prisma/client";
import { EditStatusModal } from "./EditStatus";
import { DeleteStatusModal } from "./DeleteStatus";
import { Switch } from "@/components/ui/switch";
import DynamicIcon from "@/components/DynamicIcon";
import { IconName } from "~/types/globals";
import { ProjectListDisplay } from "@/components/tables/ProjectListDisplay";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Trash2, SquarePen } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface ExtendedStatus extends Status {
  color: {
    id: number;
    value: string;
  };
  scope: {
    name: string;
    scopeId: number;
    scope: {
      id: number;
      name: string;
      icon?: string;
    };
  }[];
  projects: {
    projectId: number;
    name: string;
  }[];
}

export const getColumns = (
  handleToggleEnabled: (id: number, isEnabled: boolean) => void,
  handleToggleSuccess: (id: number, isSuccess: boolean) => void,
  handleToggleFailure: (id: number, isFailure: boolean) => void,
  handleToggleCompleted: (id: number, isCompleted: boolean) => void,
  tCommon: ReturnType<typeof useTranslations<"common">>
): ColumnDef<ExtendedStatus>[] => {
  return [
    {
      id: "name",
      accessorKey: "name",
      accessorFn: (row) => row.name,
      header: tCommon("name"),
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      meta: { isPinned: "left" },
      size: 500,
      cell: ({ row }) => (
        <div className="flex space-x-2">
          <div
            className="w-5 h-5 rounded-full"
            style={{
              backgroundColor: row.original.color
                ? row.original.color.value
                : "transparent",
            }}
          ></div>
          <div
            className={
              row.original.systemName === "untested" ? "opacity-50" : ""
            }
          >
            {row.original.name}
          </div>
        </div>
      ),
    },
    {
      id: "systemName",
      accessorKey: "systemName",
      accessorFn: (row) => row.systemName,
      header: tCommon("fields.systemName"),
      enableSorting: false,
      enableResizing: true,
      size: 150,
      cell: ({ row }) => (
        <div
          className={row.original.systemName === "untested" ? "opacity-50" : ""}
        >
          {row.original.systemName}
        </div>
      ),
    },
    {
      id: "aliases",
      accessorKey: "aliases",
      accessorFn: (row) => row.aliases,
      header: tCommon("fields.aliases"),
      enableSorting: false,
      enableResizing: true,
      size: 150,
      cell: ({ row }) => (
        <div
          className={row.original.systemName === "untested" ? "opacity-50" : ""}
        >
          {row.original.aliases}
        </div>
      ),
    },
    {
      id: "isEnabled",
      accessorKey: "isEnabled",
      accessorFn: (row) => row.isEnabled,
      header: tCommon("fields.enabled"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <Switch
            checked={row.original.isEnabled}
            onCheckedChange={(checked) =>
              handleToggleEnabled(row.original.id, checked)
            }
            disabled={row.original.systemName === "untested"}
          />
        </div>
      ),
    },
    {
      id: "isSuccess",
      accessorKey: "isSuccess",
      accessorFn: (row) => row.isSuccess,
      header: tCommon("fields.success"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <Switch
            checked={row.original.isSuccess}
            onCheckedChange={(checked) =>
              handleToggleSuccess(row.original.id, checked)
            }
            disabled={row.original.systemName === "untested"}
          />
        </div>
      ),
    },
    {
      id: "isFailure",
      accessorKey: "isFailure",
      accessorFn: (row) => row.isFailure,
      header: tCommon("fields.failure"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <Switch
            checked={row.original.isFailure}
            onCheckedChange={(checked) =>
              handleToggleFailure(row.original.id, checked)
            }
            disabled={row.original.systemName === "untested"}
          />
        </div>
      ),
    },
    {
      id: "isCompleted",
      accessorKey: "isCompleted",
      accessorFn: (row) => row.isCompleted,
      header: tCommon("fields.completed"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div className="text-center">
          <Switch
            checked={row.original.isCompleted}
            onCheckedChange={(checked) =>
              handleToggleCompleted(row.original.id, checked)
            }
            disabled={row.original.systemName === "untested"}
          />
        </div>
      ),
    },
    {
      id: "scope",
      accessorKey: "scope",
      accessorFn: (row) => row.scope,
      header: tCommon("fields.scope"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div
          className={`flex items-center gap-1 ${row.original.systemName === "untested" ? "opacity-50" : ""}`}
        >
          {row.original.scope.map((scope, index) => (
            <span key={index}>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger type="button" className="cursor-default">
                    <DynamicIcon
                      name={scope.scope.icon as IconName}
                      size={20}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <div>{scope.scope.name}</div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
          ))}
        </div>
      ),
    },
    {
      id: "projects",
      accessorKey: "projects",
      accessorFn: (row) => row.projects,
      header: tCommon("fields.projects"),
      enableSorting: false,
      enableResizing: true,
      size: 100,
      cell: ({ row }) => (
        <div
          className={`text-center ${row.original.systemName === "untested" ? "opacity-50" : ""}`}
        >
          <ProjectListDisplay projects={row.original.projects} />
        </div>
      ),
    },
    {
      id: "actions",
      header: tCommon("actions.actionsLabel"),
      enableResizing: true,
      enableSorting: false,
      enableHiding: false,
      meta: { isPinned: "right" },
      size: 80,
      cell: ({ row }) => (
        <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
          {row.original.systemName === "untested" ? (
            <Button
              variant="ghost"
              className="px-2 py-1 h-auto text-muted-foreground cursor-not-allowed"
              disabled
            >
              <SquarePen className="h-5 w-5" />
            </Button>
          ) : (
            <EditStatusModal
              key={`edit-${row.original.id}`}
              status={row.original}
            />
          )}
          {row.original.systemName !== "untested" ? (
            <DeleteStatusModal
              key={`delete-${row.original.id}`}
              status={row.original}
            />
          ) : (
            <Button
              variant="ghost"
              className="px-2 py-1 h-auto text-muted-foreground cursor-not-allowed"
              disabled
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          )}
        </div>
      ),
    },
  ];
};
