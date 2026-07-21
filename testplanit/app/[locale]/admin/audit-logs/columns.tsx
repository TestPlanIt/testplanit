import { DateFormatter } from "@/components/DateFormatter";
import { RecordId } from "@/components/RecordId";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AuditAction } from "~/zenstack/models";
import type { AuditLog } from "~/zenstack/models";
import { useRecordKeyConfig } from "~/hooks/useRecordKeyConfig";
import { parseRecordId, RECORD_TYPES, type RecordType } from "~/lib/recordKey";
import { ColumnDef } from "@tanstack/react-table";
import { Cog, Eye } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { SYSTEM_ACTOR_ID } from "~/lib/auditContextConstants";

/**
 * Audit `entityType` values (the CDC source-table names) that carry a cosmetic
 * project-prefixed record key. Only these map to a {@link RecordType}; every
 * other audit entity type renders no extra key.
 */
const AUDIT_ENTITY_RECORD_TYPES: Record<string, RecordType> = {
  RepositoryCases: RECORD_TYPES.TEST_CASE,
  TestRuns: RECORD_TYPES.TEST_RUN,
  Sessions: RECORD_TYPES.SESSION,
  Milestones: RECORD_TYPES.MILESTONE,
};

/** Map an audit `entityType` to a {@link RecordType}, or `undefined` if unmapped. */
export function auditRecordType(
  entityType: string | null | undefined
): RecordType | undefined {
  return entityType ? AUDIT_ENTITY_RECORD_TYPES[entityType] : undefined;
}

export interface ExtendedAuditLog extends AuditLog {
  project?: {
    name: string;
    key?: string | null;
  } | null;
  // operationId / sourceTable are now part of the generated AuditLog (regenerated
  // Prisma client): operationId groups multi-request logical saves in the UI and
  // sourceTable is the Postgres table for CDC-sourced rows; both are null for
  // legacy and semantic (captureAuditEvent) rows.
  // Populated only on a grouped lead row (see lib/audit/groupAuditRows): the
  // other AuditLog rows that share this lead's operationId, rendered as
  // expandable sub-rows by VirtualizedDataTable's getSubRows. Absent on
  // singletons.
  auditChildren?: ExtendedAuditLog[];
}

export interface AuditLogSort {
  column: string;
  direction: "asc" | "desc";
}

/**
 * Translate a sort selection into a Prisma `orderBy`. The project column sorts
 * by the related project's name; every other column is a scalar field.
 */
export function buildAuditLogOrderBy(sort: AuditLogSort): Record<string, any> {
  if (sort.column === "project") {
    return { project: { name: sort.direction } };
  }
  return { [sort.column]: sort.direction };
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

export const useColumns = (
  userPreferences: { user: { preferences: { timezone?: string } } },
  onViewDetails: (log: ExtendedAuditLog) => void,
  t: ReturnType<typeof useTranslations<"admin.auditLogs">>,
  tCommon: ReturnType<typeof useTranslations<"common">>,
  tUserMenu: ReturnType<typeof useTranslations<"userMenu">>
): ColumnDef<ExtendedAuditLog>[] => {
  const { formatKey } = useRecordKeyConfig();
  return useMemo(
    () => [
      {
        id: "timestamp",
        accessorKey: "timestamp",
        header: t("columns.timestamp"),
        enableSorting: true,
        enableHiding: false,
        size: 180,
        cell: ({ row: _row, getValue }) => (
          <div className="whitespace-nowrap text-sm">
            <DateFormatter
              date={getValue() as Date | string}
              formatString="MM-dd-yyyy HH:mm:ss"
              timezone={
                userPreferences?.user?.preferences?.timezone || "Etc/UTC"
              }
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
        cell: ({ getValue }) => {
          const entityType = getValue() as string;
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="font-mono text-sm truncate max-w-[130px] block">
                  {entityType}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{entityType}</p>
              </TooltipContent>
            </Tooltip>
          );
        },
      },
      {
        id: "entityName",
        accessorKey: "entityName",
        header: t("columns.entityName"),
        enableSorting: false,
        size: 300,
        minSize: 150,
        cell: ({ row, getValue }) => {
          const name = getValue() as string | null;
          // Only the mapped, project-scoped root entities show a cosmetic key,
          // and only when the feature is on and the project has a code
          // (formatKey returns null otherwise).
          const recordType = auditRecordType(row.original.entityType);
          const numericId = parseRecordId(row.original.entityId);
          const projectKey = row.original.project?.key;
          // Bulk operations record a synthetic batch id (not a real record id),
          // so don't render a misleading key for them.
          const isBulkAction = String(row.original.action).startsWith("BULK");
          const displayKey =
            recordType && numericId != null && projectKey && !isBulkAction
              ? formatKey(recordType, projectKey, numericId)
              : null;
          return (
            <div className="flex min-w-0 flex-col gap-0.5">
              {name ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="truncate block w-full">{name}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>{name}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                !displayKey && <span className="text-muted-foreground">-</span>
              )}
              {displayKey && recordType && numericId != null && (
                <RecordId
                  type={recordType}
                  id={numericId}
                  projectKey={projectKey}
                  className="text-xs text-muted-foreground"
                />
              )}
            </div>
          );
        },
      },
      {
        id: "userEmail",
        accessorKey: "userEmail",
        header: tCommon("access.user"),
        enableSorting: true,
        size: 200,
        minSize: 150,
        cell: ({ row }) => {
          const userId = row.original.userId;
          const email = row.original.userEmail;
          const name = row.original.userName;
          const isSystemActor = userId === SYSTEM_ACTOR_ID;
          if (isSystemActor) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="gap-1 font-medium"
                    data-testid="audit-log-system-actor-badge"
                  >
                    <Cog className="h-3 w-3" aria-hidden="true" />
                    {t("systemActor")}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{t("systemActorTooltip")}</TooltipContent>
              </Tooltip>
            );
          }
          return (
            <div className="flex flex-col">
              {name && <span className="font-medium text-sm">{name}</span>}
              {email && (
                <span className="text-xs text-muted-foreground">{email}</span>
              )}
              {!name && !email && (
                <span className="text-muted-foreground">
                  {tUserMenu("themes.system")}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: "project",
        // A string accessor (the related project's name) so the table's
        // client-side sort of loaded rows agrees with the server orderBy
        // (`{ project: { name } }`); a relation accessor can't be sorted.
        accessorFn: (row) => row.project?.name ?? "",
        header: tCommon("fields.project"),
        enableSorting: true,
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
        enableSorting: false,
        enableHiding: false,
        size: 55,
        minSize: 55,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            className="px-2 py-1 h-auto"
            onClick={() => onViewDetails(row.original)}
            title={t("viewDetails")}
            data-testid="audit-log-view-details"
          >
            <Eye className="h-4 w-4" />
          </Button>
        ),
      },
    ],
    [userPreferences, onViewDetails, t, tCommon, tUserMenu, formatKey]
  );
};
