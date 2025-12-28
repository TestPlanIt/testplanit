import { ColumnDef } from "@tanstack/react-table";
import { AuditLog, AuditAction } from "@prisma/client";
import { useTranslations } from "next-intl";
import { DateFormatter } from "@/components/DateFormatter";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";

export interface ExtendedAuditLog extends AuditLog {
  project?: {
    name: string;
  } | null;
}

/**
 * Get badge variant based on action type
 */
function getActionBadgeVariant(
  action: AuditAction
): "default" | "secondary" | "destructive" | "outline" {
  switch (action) {
    case "CREATE":
    case "BULK_CREATE":
    case "API_KEY_CREATED":
      return "default";
    case "UPDATE":
    case "BULK_UPDATE":
    case "API_KEY_REGENERATED":
      return "secondary";
    case "DELETE":
    case "BULK_DELETE":
    case "API_KEY_DELETED":
    case "API_KEY_REVOKED":
      return "destructive";
    case "LOGIN":
    case "LOGOUT":
      return "outline";
    case "LOGIN_FAILED":
      return "destructive";
    case "PERMISSION_GRANT":
    case "PERMISSION_REVOKE":
    case "ROLE_CHANGED":
      return "secondary";
    default:
      return "outline";
  }
}

/**
 * Format action name for display
 */
function formatAction(action: AuditAction): string {
  return action.replace(/_/g, " ");
}

export const getColumns = (
  session: any,
  onViewDetails: (log: ExtendedAuditLog) => void,
  t: ReturnType<typeof useTranslations<"admin.auditLogs">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  tUserMenu: ReturnType<typeof useTranslations<"userMenu">>
): ColumnDef<ExtendedAuditLog>[] => [
  {
    id: "timestamp",
    accessorKey: "timestamp",
    header: t("columns.timestamp"),
    enableSorting: true,
    size: 180,
    cell: ({ row, getValue }) => (
      <div className="whitespace-nowrap text-sm">
        <DateFormatter
          date={getValue() as Date | string}
          formatString="MM-dd-yyyy HH:mm:ss"
          timezone={session?.user?.preferences?.timezone || "Etc/UTC"}
        />
      </div>
    ),
  },
  {
    id: "action",
    accessorKey: "action",
    header: t("filterAction"),
    enableSorting: true,
    size: 150,
    cell: ({ getValue }) => {
      const action = getValue() as AuditAction;
      return (
        <Badge variant={getActionBadgeVariant(action)}>
          {formatAction(action)}
        </Badge>
      );
    },
  },
  {
    id: "entityType",
    accessorKey: "entityType",
    header: t("filterEntityType"),
    enableSorting: true,
    size: 150,
    cell: ({ getValue }) => (
      <span className="font-mono text-sm">{getValue() as string}</span>
    ),
  },
  {
    id: "entityName",
    accessorKey: "entityName",
    header: t("columns.entityName"),
    enableSorting: false,
    size: 200,
    cell: ({ getValue }) => {
      const name = getValue() as string | null;
      return name ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate max-w-[200px] block">{name}</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{name}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    },
  },
  {
    id: "userEmail",
    accessorKey: "userEmail",
    header: tCommon("access.user"),
    enableSorting: true,
    size: 200,
    cell: ({ row }) => {
      const email = row.original.userEmail;
      const name = row.original.userName;
      return (
        <div className="flex flex-col">
          {name && <span className="font-medium text-sm">{name}</span>}
          {email && (
            <span className="text-xs text-muted-foreground">{email}</span>
          )}
          {!name && !email && (
            <span className="text-muted-foreground">{tUserMenu("themes.system")}</span>
          )}
        </div>
      );
    },
  },
  {
    id: "project",
    accessorKey: "project",
    header: tCommon("fields.project"),
    enableSorting: false,
    size: 150,
    cell: ({ row }) => {
      const project = row.original.project;
      return project?.name ? (
        <span className="text-sm">{project.name}</span>
      ) : (
        <span className="text-muted-foreground">-</span>
      );
    },
  },
  {
    id: "actions",
    header: "",
    size: 50,
    cell: ({ row }) => (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onViewDetails(row.original)}
        title={t("viewDetails")}
      >
        <Eye className="h-4 w-4" />
      </Button>
    ),
  },
];
