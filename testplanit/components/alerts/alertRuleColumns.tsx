"use client";

import { History, SquarePen, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { DateFormatter } from "@/components/DateFormatter";
import { ProjectIcon } from "@/components/ProjectIcon";
import type { AlertRuleDialogRule } from "@/components/alerts/AlertRuleDialog";
import { AlertRuleSummary } from "@/components/alerts/AlertRuleSummary";
import {
  AlertScopeLabel,
  type AlertScopeNames,
} from "@/components/alerts/AlertScopeLabel";
import { ProjectNameCell } from "@/components/tables/ProjectNameCell";
import { UserListDisplay } from "@/components/tables/UserListDisplay";
import type { ColumnDef } from "@/components/tables/tableFeatures";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** One alert as the Notifications & Alerts table lists it. */
export type AlertRow = AlertRuleDialogRule & {
  projectId: number;
  createdById: string;
  project: { id: number; name: string; iconUrl?: string | null };
};

export const ALERT_SORT_COLUMNS = [
  "enabled",
  "project",
  "name",
  "description",
  "condition",
  "scope",
  "subscribers",
  "lastFired",
  "notifyMe",
] as const;
export type AlertSortColumn = (typeof ALERT_SORT_COLUMNS)[number];

export interface AlertRowContext {
  /** Whether this row's Notify me switch reflects the viewer's own subscription. */
  following: (rule: AlertRow) => boolean;
  manageable: (rule: AlertRow) => boolean;
  canToggleFollow: boolean;
  busyRuleId: number | null;
  /** Label for the sort/filter on the condition column. */
  metricLabel: (rule: AlertRow) => string;
}

/**
 * Client-side sort: the list is one unpaged fetch of every alert the user
 * can see, so the page sorts. Ties fall back to project then rule name so
 * the order is stable while switches flip.
 */
export function sortAlertRows(
  rows: AlertRow[],
  column: AlertSortColumn,
  direction: "asc" | "desc",
  ctx: Pick<AlertRowContext, "following" | "metricLabel">
): AlertRow[] {
  const byName = (a: AlertRow, b: AlertRow) =>
    (a.project?.name ?? "").localeCompare(b.project?.name ?? "") ||
    a.name.localeCompare(b.name);
  const sorted = [...rows].sort((a, b) => {
    switch (column) {
      case "enabled":
        return Number(b.isEnabled) - Number(a.isEnabled) || byName(a, b);
      case "name":
        return a.name.localeCompare(b.name) || byName(a, b);
      case "description":
        return (
          (a.description ?? "").localeCompare(b.description ?? "") ||
          byName(a, b)
        );
      case "condition":
        return (
          ctx.metricLabel(a).localeCompare(ctx.metricLabel(b)) || byName(a, b)
        );
      case "scope":
        return (
          a.scopeType.localeCompare(b.scopeType) ||
          (a.scopeText ?? "").localeCompare(b.scopeText ?? "") ||
          byName(a, b)
        );
      case "subscribers":
        return a.subscribers.length - b.subscribers.length || byName(a, b);
      case "lastFired": {
        const ta = a.lastFiredAt ? new Date(a.lastFiredAt).getTime() : 0;
        const tb = b.lastFiredAt ? new Date(b.lastFiredAt).getTime() : 0;
        return ta - tb || byName(a, b);
      }
      case "notifyMe":
        return (
          Number(ctx.following(b)) - Number(ctx.following(a)) || byName(a, b)
        );
      default:
        return byName(a, b);
    }
  });
  return direction === "asc" ? sorted : sorted.reverse();
}

export function useAlertRuleColumns({
  ctx,
  scopeNames,
  onToggleEnabled,
  onToggleFollow,
  onHistory,
  onEdit,
  onDelete,
}: {
  ctx: AlertRowContext;
  scopeNames: AlertScopeNames;
  onToggleEnabled: (rule: AlertRow, enabled: boolean) => void;
  onToggleFollow: (rule: AlertRow, follow: boolean) => void;
  onHistory: (rule: AlertRow) => void;
  onEdit: (rule: AlertRow) => void;
  onDelete: (rule: AlertRow) => void;
}): ColumnDef<AlertRow>[] {
  const t = useTranslations("alerts");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const preferences = session?.user?.preferences;

  return useMemo<ColumnDef<AlertRow>[]>(
    () => [
      {
        id: "enabled",
        accessorKey: "isEnabled",
        header: t("columns.enabled"),
        enableSorting: true,
        enableResizing: true,
        size: 140,
        cell: ({ row }) => (
          <div className="text-center">
            <Switch
              checked={row.original.isEnabled}
              disabled={
                ctx.busyRuleId === row.original.id ||
                !ctx.manageable(row.original)
              }
              onCheckedChange={(checked) =>
                onToggleEnabled(row.original, checked)
              }
              aria-label={t("columns.enabled")}
              data-testid={`alert-rule-enabled-${row.original.id}`}
            />
          </div>
        ),
      },
      {
        id: "notifyMe",
        accessorKey: "notifyMe",
        accessorFn: (row) => ctx.following(row),
        header: t("columns.notifyMe"),
        enableSorting: true,
        enableResizing: true,
        size: 150,
        cell: ({ row }) => (
          <div className="text-center">
            <Switch
              checked={ctx.following(row.original)}
              disabled={
                ctx.busyRuleId === row.original.id || !ctx.canToggleFollow
              }
              onCheckedChange={(checked) =>
                onToggleFollow(row.original, checked)
              }
              aria-label={t("columns.notifyMe")}
              data-testid={`alert-rule-follow-${row.original.id}`}
            />
          </div>
        ),
      },
      {
        id: "project",
        accessorKey: "project",
        accessorFn: (row) => row.project.name,
        header: t("columns.project"),
        enableSorting: true,
        enableResizing: true,
        size: 200,
        cell: ({ row }) => (
          <div className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0">
              <ProjectIcon
                iconUrl={row.original.project.iconUrl}
                width={16}
                height={16}
              />
            </span>
            <ProjectNameCell
              projectId={row.original.projectId}
              value={row.original.project.name}
              size="sm"
            />
          </div>
        ),
      },
      {
        id: "name",
        accessorKey: "name",
        header: t("columns.name"),
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        size: 220,
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">{row.original.name}</div>
            {!row.original.isEnabled && (
              <Badge variant="outline" className="mt-1">
                {t("paused")}
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
        meta: { isVisible: false },
        size: 260,
        cell: ({ row }) => (
          <div className="truncate text-sm text-muted-foreground">
            {row.original.description ?? ""}
          </div>
        ),
      },
      {
        id: "condition",
        accessorKey: "metric",
        header: t("columns.condition"),
        enableSorting: true,
        enableResizing: true,
        size: 380,
        cell: ({ row }) => (
          <div className="min-w-0 whitespace-normal text-sm">
            <div className="text-xs font-medium text-muted-foreground">
              {ctx.metricLabel(row.original)}
            </div>
            <AlertRuleSummary rule={row.original} />
          </div>
        ),
      },
      {
        id: "scope",
        accessorKey: "scopeType",
        header: t("columns.scope"),
        enableSorting: true,
        enableResizing: true,
        size: 160,
        cell: ({ row }) => (
          <div className="truncate text-sm">
            <AlertScopeLabel
              scopeType={row.original.scopeType}
              scopeId={row.original.scopeId}
              scopeText={row.original.scopeText}
              names={scopeNames}
            />
          </div>
        ),
      },
      {
        id: "subscribers",
        accessorKey: "subscribers",
        accessorFn: (row) => row.subscribers.length,
        header: t("columns.subscribers"),
        enableSorting: true,
        enableResizing: true,
        size: 120,
        cell: ({ row }) => (
          <div
            className="flex justify-center"
            data-testid={`alert-rule-subscribers-${row.original.id}`}
          >
            {row.original.subscribers.length === 0 ? (
              <span className="text-sm text-muted-foreground">
                {row.original.subscribers.length}
              </span>
            ) : (
              <UserListDisplay
                // Remount when the audience changes so the count refetches.
                key={row.original.subscribers.length}
                filter={{
                  alertSubscriptions: { some: { ruleId: row.original.id } },
                }}
              />
            )}
          </div>
        ),
      },
      {
        id: "lastFired",
        accessorKey: "lastFiredAt",
        header: t("columns.lastFired"),
        enableSorting: true,
        enableResizing: true,
        size: 170,
        cell: ({ row }) =>
          row.original.lastFiredAt ? (
            <div className="whitespace-nowrap text-sm">
              <DateFormatter
                date={row.original.lastFiredAt}
                formatString={`${preferences?.dateFormat || "MM-dd-yyyy"} ${preferences?.timeFormat || "HH:mm"}`}
                timezone={preferences?.timezone || "Etc/UTC"}
              />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t("neverFired")}
            </span>
          ),
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        enableSorting: false,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 130,
        cell: ({ row }) => {
          const rule = row.original;
          const manageable = ctx.manageable(rule);
          return (
            <div className="flex items-center justify-end gap-1 whitespace-nowrap">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("history")}
                    onClick={() => onHistory(rule)}
                    data-testid={`alert-rule-history-${rule.id}`}
                  >
                    <History className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("history")}</TooltipContent>
              </Tooltip>
              {manageable && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("editRule")}
                        onClick={() => onEdit(rule)}
                        data-testid={`alert-rule-edit-${rule.id}`}
                      >
                        <SquarePen className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("editRule")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("deleteRule")}
                        onClick={() => onDelete(rule)}
                        data-testid={`alert-rule-delete-${rule.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("deleteRule")}</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [
      t,
      tCommon,
      preferences,
      ctx,
      scopeNames,
      onToggleEnabled,
      onToggleFollow,
      onHistory,
      onEdit,
      onDelete,
    ]
  );
}
