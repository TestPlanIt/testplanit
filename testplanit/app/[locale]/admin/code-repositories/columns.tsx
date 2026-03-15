"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

export interface CodeRepositoryRow {
  id: number;
  name: string;
  provider: string;
  credentials: Record<string, string> | null;
  settings: Record<string, string> | null;
  status: string;
  lastTestedAt: Date | string | null;
  createdAt: Date | string;
  [key: string]: any;
}

const providerLabel: Record<string, string> = {
  GITHUB: "GitHub",
  GITLAB: "GitLab",
  BITBUCKET: "Bitbucket",
  AZURE_DEVOPS: "Azure DevOps",
};

interface ColumnActions {
  onEdit: (repo: CodeRepositoryRow) => void;
  onDelete: (repo: CodeRepositoryRow) => void;
  onToggleStatus: (id: number, currentStatus: string) => void;
  tCommon: ReturnType<typeof useTranslations<"common">>;
  userPreferences?: {
    user: {
      preferences: { dateFormat?: string; timezone?: string };
    };
  };
}

export function getColumns({
  onEdit,
  onDelete,
  onToggleStatus,
  tCommon,
  userPreferences,
}: ColumnActions): ColumnDef<CodeRepositoryRow>[] {
  return [
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
      size: 250,
      cell: ({ row }) => (
        <div className="bg-primary-foreground flex items-center gap-2">
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
      cell: ({ row }) =>
        providerLabel[row.original.provider] ?? row.original.provider,
    },
    {
      id: "status",
      accessorKey: "status",
      header: tCommon("fields.isActive"),
      enableSorting: true,
      enableResizing: true,
      size: 120,
      cell: ({ row }) => {
        const status = row.original.status;
        if (status === "ERROR") {
          return (
            <div className="flex items-center gap-2">
              <Switch checked={false} disabled />
              <Badge variant="destructive">{tCommon("errors.error")}</Badge>
            </div>
          );
        }
        return (
          <Switch
            checked={status === "ACTIVE"}
            onCheckedChange={() => onToggleStatus(row.original.id, status)}
          />
        );
      },
    },
    {
      id: "lastTestedAt",
      accessorKey: "lastTestedAt",
      header: "Last Tested",
      enableSorting: true,
      enableResizing: true,
      size: 150,
      cell: ({ row }) => {
        const lastTestedAt = row.original.lastTestedAt;
        if (!lastTestedAt) {
          return (
            <span className="text-sm text-muted-foreground">{tCommon("never")}</span>
          );
        }
        return (
          <div className="whitespace-nowrap">
            <DateFormatter
              date={lastTestedAt}
              formatString={
                userPreferences?.user.preferences?.dateFormat ??
                "MM_DD_YYYY_DASH"
              }
              timezone={
                userPreferences?.user.preferences?.timezone ?? "Etc/UTC"
              }
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
      cell: ({ row }) => (
        <div className="whitespace-nowrap">
          <DateFormatter
            date={row.original.createdAt}
            formatString={
              userPreferences?.user.preferences?.dateFormat ??
              "MM_DD_YYYY_DASH"
            }
            timezone={
              userPreferences?.user.preferences?.timezone ?? "Etc/UTC"
            }
          />
        </div>
      ),
    },
    {
      id: "actions",
      header: tCommon("actions.actionsLabel"),
      enableSorting: false,
      enableResizing: true,
      enableHiding: false,
      size: 100,
      meta: { isPinned: "right" },
      cell: ({ row }) => (
        <div className="bg-primary-foreground whitespace-nowrap flex justify-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="px-2 py-1 h-auto"
            onClick={() => onEdit(row.original)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="destructive"
            size="icon"
            className="px-2 py-1 h-auto"
            onClick={() => onDelete(row.original)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];
}
