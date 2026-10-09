"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { notFound, useParams, useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "~/lib/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Loading } from "@/components/Loading";
import { ColumnSelection } from "@/components/tables/ColumnSelection";
import { DataTable } from "@/components/tables/DataTable";
import { Filter } from "@/components/tables/Filter";
import { NotificationPreferencesCard } from "@/components/notifications/NotificationPreferencesCard";
import { AlertListFilters } from "@/components/alerts/AlertListFilters";
import {
  ALERT_FILTERS_STORAGE_KEY,
  type AlertFilters,
  EMPTY_ALERT_FILTERS,
  applyAlertFilters,
  isAnyAlertFilterActive,
  parseStoredAlertFilters,
} from "@/components/alerts/alertFilters";
import { AlertRuleDialog } from "@/components/alerts/AlertRuleDialog";
import { AlertRuleHistoryDialog } from "@/components/alerts/AlertRuleHistoryDialog";
import type { AlertScopeNames } from "@/components/alerts/AlertScopeLabel";
import {
  ALERT_SORT_COLUMNS,
  type AlertRow,
  type AlertSortColumn,
  sortAlertRows,
  useAlertRuleColumns,
} from "@/components/alerts/alertRuleColumns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageCardHeader } from "@/components/ui/page-card-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAlertProjectPermissions } from "~/app/actions/alertPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { AlertScopeType } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

/**
 * Alerts (#651): one page per user listing every alert they follow across
 * their projects, the other alerts in those projects they could follow, and
 * the place to create their own. Reached from the profile.
 */
export default function UserAlertsPage() {
  const params = useParams();
  const profileUserId = params.userId as string;
  const { session, isLoading: isAuthLoading } = useRequireAuth();
  const viewerId = session?.user?.id;
  const isAdmin = session?.user?.access === "ADMIN";
  const isOwn = viewerId === profileUserId;
  const t = useTranslations("alerts");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const locale = useLocale();
  const client = useClientQueries(schema);

  const { data: profileUser, isLoading: userLoading } =
    client.user.useFindUnique(
      { where: { id: profileUserId }, select: { id: true, name: true } },
      { enabled: !!viewerId && !!profileUserId }
    );

  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Notifications is the default tab: every user has preferences, fewer
  // follow alerts. The alerts tab is linked as ?tab=alerts.
  const pageTab =
    searchParams?.get("tab") === "alerts" ? "alerts" : "notifications";
  const handlePageTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === "notifications") next.delete("tab");
    else next.set("tab", value);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  const include = {
    project: { select: { id: true, name: true, iconUrl: true } },
    subscribers: { select: { id: true, userId: true } },
    createdBy: { select: { id: true, name: true, email: true } },
  } as const;
  // One list of every alert in the projects this user can see; the Notify
  // me switch toggles a subscription in place so rows never move.
  const {
    data: rules,
    isLoading: loading,
    refetch: refetchRules,
  } = client.alertRule.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: [{ project: { name: "asc" } }, { name: "asc" }],
      include,
    },
    { enabled: !!viewerId && !!profileUserId }
  );
  const refetch = () => {
    void refetchRules();
  };

  // A rule whose project relation resolves to null belongs to a project the
  // viewer can no longer read (deleted, or access revoked while the cached
  // accessible-project list still lists it); it has nothing to show.
  const allRows = useMemo(
    () => ((rules ?? []) as AlertRow[]).filter((r) => r.project != null),
    [rules]
  );

  // Permissions per project, one round trip for everything on the page.
  const projectIds = useMemo(
    () => [...new Set(allRows.map((r) => r.projectId))].sort((a, b) => a - b),
    [allRows]
  );
  const { data: projectPermissions } = useQuery({
    queryKey: ["alertProjectPermissions", viewerId, projectIds],
    queryFn: () => getAlertProjectPermissions(projectIds),
    enabled: !!viewerId && projectIds.length > 0,
    staleTime: 30_000,
  });

  // Projects the viewer can create alerts in, for the Add Alert dialog.
  const { data: projects } = client.projects.useFindMany(
    {
      where: { isDeleted: false },
      orderBy: { name: "asc" },
      select: { id: true, name: true, iconUrl: true },
    },
    { enabled: !!viewerId && isOwn }
  );
  const projectIdsForCreate = useMemo(
    () => (projects ?? []).map((p) => p.id),
    [projects]
  );
  const { data: createPermissions } = useQuery({
    queryKey: [
      "alertProjectPermissions",
      viewerId,
      "create",
      projectIdsForCreate,
    ],
    queryFn: () => getAlertProjectPermissions(projectIdsForCreate),
    enabled: !!viewerId && isOwn && projectIdsForCreate.length > 0,
    staleTime: 30_000,
  });
  const creatableProjects = useMemo(
    () => (projects ?? []).filter((p) => createPermissions?.[p.id]?.canCreate),
    [projects, createPermissions]
  );
  const mergedPermissions = useMemo(
    () => ({ ...(createPermissions ?? {}), ...(projectPermissions ?? {}) }),
    [createPermissions, projectPermissions]
  );

  // Scope names, one query per type.
  const idsByScope = useMemo(() => {
    const collect = (type: AlertScopeType) =>
      allRows
        .filter((r) => r.scopeType === type && r.scopeId != null)
        .map((r) => r.scopeId as number);
    return {
      folders: collect(AlertScopeType.FOLDER),
      tags: collect(AlertScopeType.TAG),
      cases: collect(AlertScopeType.CASE),
      milestones: collect(AlertScopeType.MILESTONE),
      webhooks: [
        ...new Set(
          allRows
            .filter(
              (r) => r.scopeType === AlertScopeType.WEBHOOK && r.scopeText
            )
            .map((r) => r.scopeText as string)
        ),
      ],
    };
  }, [allRows]);
  const { data: folderRows } = client.repositoryFolders.useFindMany(
    {
      where: { id: { in: idsByScope.folders } },
      select: { id: true, name: true },
    },
    { enabled: idsByScope.folders.length > 0 }
  );
  const { data: tagRows } = client.tags.useFindMany(
    {
      where: { id: { in: idsByScope.tags } },
      select: { id: true, name: true },
    },
    { enabled: idsByScope.tags.length > 0 }
  );
  const { data: caseRows } = client.repositoryCases.useFindMany(
    {
      where: { id: { in: idsByScope.cases } },
      select: { id: true, name: true },
    },
    { enabled: idsByScope.cases.length > 0 }
  );
  const { data: milestoneRows } = client.milestones.useFindMany(
    {
      where: { id: { in: idsByScope.milestones } },
      select: { id: true, name: true },
    },
    { enabled: idsByScope.milestones.length > 0 }
  );
  const { data: webhookRows } = client.webhookConfig.useFindMany(
    {
      where: { id: { in: idsByScope.webhooks } },
      select: { id: true, name: true, url: true },
    },
    { enabled: idsByScope.webhooks.length > 0 }
  );
  const scopeNames: AlertScopeNames = useMemo(
    () => ({
      folders: new Map((folderRows ?? []).map((r) => [r.id, r.name])),
      tags: new Map((tagRows ?? []).map((r) => [r.id, r.name])),
      cases: new Map((caseRows ?? []).map((r) => [r.id, r.name])),
      milestones: new Map((milestoneRows ?? []).map((r) => [r.id, r.name])),
      webhooks: new Map(
        (webhookRows ?? []).map((r) => [r.id, r.name || r.url || r.id])
      ),
    }),
    [folderRows, tagRows, caseRows, milestoneRows, webhookRows]
  );

  const updateRule = client.alertRule.useUpdate();
  const subscribe = client.alertSubscriber.useCreate();
  const unsubscribe = client.alertSubscriber.useDeleteMany();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AlertRow | null>(null);
  const [historyRule, setHistoryRule] = useState<AlertRow | null>(null);
  const [deleting, setDeleting] = useState<AlertRow | null>(null);
  const [pausing, setPausing] = useState<AlertRow | null>(null);
  const [busyRuleId, setBusyRuleId] = useState<number | null>(null);

  // Table state: the list is one unpaged fetch, so filter and sort run here.
  const [searchString, setSearchString] = useState("");
  const [listFilters, setListFilters] =
    useState<AlertFilters>(EMPTY_ALERT_FILTERS);
  // Read in an effect, not in the initializer: localStorage isn't available
  // during SSR and reading it inline would hydrate-mismatch.
  useEffect(() => {
    try {
      setListFilters(
        parseStoredAlertFilters(
          window.localStorage.getItem(ALERT_FILTERS_STORAGE_KEY)
        )
      );
    } catch {
      // localStorage unavailable (private mode) — no filters.
    }
  }, []);
  const handleListFiltersChange = (next: AlertFilters) => {
    setListFilters(next);
    try {
      window.localStorage.setItem(
        ALERT_FILTERS_STORAGE_KEY,
        JSON.stringify(next)
      );
    } catch {
      // Storage may be unavailable; the filters still apply for this visit.
    }
  };
  const [sortConfig, setSortConfig] = useState<{
    column: AlertSortColumn;
    direction: "asc" | "desc";
  }>({ column: "project", direction: "asc" });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  // Hide-column requests from the header menu route through the Columns
  // control (the visibility owner) so persistence and its checkboxes agree.
  const hideColumnRef = useRef<((columnId: string) => void) | null>(null);

  const canManage = useCallback(
    (rule: AlertRow) =>
      isAdmin ||
      mergedPermissions[rule.projectId]?.isProjectAdmin === true ||
      (rule.createdById === viewerId &&
        mergedPermissions[rule.projectId]?.canCreate === true),
    [isAdmin, mergedPermissions, viewerId]
  );
  const canToggleFollow = isOwn || isAdmin;
  const following = useCallback(
    (rule: AlertRow) =>
      rule.subscribers.some((s) => s.userId === profileUserId),
    [profileUserId]
  );
  const metricLabel = useCallback(
    (rule: AlertRow) => t(`metrics.${rule.metric}.label` as never),
    [t]
  );
  const rowContext = useMemo(
    () => ({
      following,
      manageable: canManage,
      canToggleFollow,
      busyRuleId,
      metricLabel,
    }),
    [following, canManage, canToggleFollow, busyRuleId, metricLabel]
  );

  // Only people who created a listed alert are offered in the filter.
  const creators = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; email?: string | null }
    >();
    for (const rule of allRows) {
      if (rule.createdBy && !byId.has(rule.createdBy.id)) {
        byId.set(rule.createdBy.id, rule.createdBy);
      }
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [allRows]);

  const rows = useMemo(() => {
    const needle = searchString.trim().toLowerCase();
    const matching = applyAlertFilters(allRows, listFilters, following).filter(
      (rule) =>
        needle.length === 0 ||
        rule.name.toLowerCase().includes(needle) ||
        (rule.description ?? "").toLowerCase().includes(needle) ||
        rule.project.name.toLowerCase().includes(needle) ||
        (rule.createdBy?.name ?? "").toLowerCase().includes(needle) ||
        metricLabel(rule).toLowerCase().includes(needle) ||
        (rule.scopeText ?? "").toLowerCase().includes(needle)
    );
    return sortAlertRows(matching, sortConfig.column, sortConfig.direction, {
      following,
      metricLabel,
    });
  }, [allRows, searchString, listFilters, sortConfig, following, metricLabel]);

  const isSortColumn = (column: string): column is AlertSortColumn =>
    (ALERT_SORT_COLUMNS as readonly string[]).includes(column);
  const handleSortChange = (column: string) => {
    if (!isSortColumn(column)) return;
    const direction =
      sortConfig.column === column && sortConfig.direction === "asc"
        ? "desc"
        : "asc";
    setSortConfig({ column, direction });
  };
  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = (
    column: string,
    direction: "asc" | "desc" | null
  ) => {
    if (direction === null) {
      setSortConfig({ column: "project", direction: "asc" });
    } else if (isSortColumn(column)) {
      setSortConfig({ column, direction });
    }
  };

  const setEnabled = async (rule: AlertRow, enabled: boolean) => {
    setBusyRuleId(rule.id);
    try {
      await updateRule.mutateAsync({
        where: { id: rule.id },
        data: { isEnabled: enabled },
      });
      toast.success(enabled ? t("toasts.enabled") : t("toasts.disabled"));
      refetch();
    } catch {
      toast.error(t("toasts.saveError"));
    } finally {
      setBusyRuleId(null);
    }
  };
  const setEnabledRef = useRef(setEnabled);
  useEffect(() => {
    setEnabledRef.current = setEnabled;
  });
  // Pausing stops the alert for every subscriber, so it asks first.
  const toggleEnabled = useCallback((rule: AlertRow, enabled: boolean) => {
    if (enabled) void setEnabledRef.current(rule, true);
    else setPausing(rule);
  }, []);
  const confirmPause = async () => {
    if (!pausing) return;
    const rule = pausing;
    setPausing(null);
    await setEnabled(rule, false);
  };

  const toggleFollow = async (rule: AlertRow, follow: boolean) => {
    setBusyRuleId(rule.id);
    try {
      if (follow) {
        await subscribe.mutateAsync({
          data: {
            rule: { connect: { id: rule.id } },
            user: { connect: { id: profileUserId } },
            ...(viewerId && viewerId !== profileUserId
              ? { addedBy: { connect: { id: viewerId } } }
              : {}),
          },
        });
        toast.success(t("toasts.subscribed"));
      } else {
        await unsubscribe.mutateAsync({
          where: { ruleId: rule.id, userId: profileUserId },
        });
        toast.success(t("toasts.unsubscribed"));
      }
      refetch();
    } catch {
      toast.error(t("toasts.subscriptionError"));
    } finally {
      setBusyRuleId(null);
    }
  };

  // The column cells call these through refs so the column defs stay stable
  // while the mutation hooks change identity every render.
  const toggleFollowRef = useRef(toggleFollow);
  useEffect(() => {
    toggleFollowRef.current = toggleFollow;
  });
  const handleToggleFollow = useCallback(
    (rule: AlertRow, follow: boolean) =>
      void toggleFollowRef.current(rule, follow),
    []
  );
  const handleHistory = useCallback(
    (rule: AlertRow) => setHistoryRule(rule),
    []
  );
  const handleEdit = useCallback((rule: AlertRow) => {
    setEditing(rule);
    setDialogOpen(true);
  }, []);
  const handleDelete = useCallback((rule: AlertRow) => setDeleting(rule), []);

  const columns = useAlertRuleColumns({
    ctx: rowContext,
    scopeNames,
    onToggleEnabled: toggleEnabled,
    onToggleFollow: handleToggleFollow,
    onHistory: handleHistory,
    onEdit: handleEdit,
    onDelete: handleDelete,
  });

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusyRuleId(deleting.id);
    try {
      await updateRule.mutateAsync({
        where: { id: deleting.id },
        data: { isDeleted: true },
      });
      toast.success(t("toasts.deleted"));
      refetch();
    } catch {
      toast.error(t("toasts.saveError"));
    } finally {
      setBusyRuleId(null);
      setDeleting(null);
    }
  };

  if (isAuthLoading || userLoading) {
    return <Loading />;
  }
  if (!profileUser) {
    notFound();
  }

  const editingRule = editing
    ? (allRows.find((r) => r.id === editing.id) ?? editing)
    : null;

  const addAlertButton =
    isOwn && creatableProjects.length > 0 ? (
      <Button
        onClick={() => {
          setEditing(null);
          setDialogOpen(true);
        }}
        data-testid="alert-add-rule"
      >
        <Plus />
        {t("addRule")}
      </Button>
    ) : null;

  return (
    <main data-testid="alerts-page">
      <Card>
        <PageCardHeader
          className="w-full"
          title={tCommon("pageTitles.alerts")}
          helpKey="userAlerts"
          backHref={`/users/profile/${profileUserId}`}
          description={
            isOwn
              ? t("pageDescription")
              : t("pageDescriptionFor", { name: profileUser.name })
          }
        />
        <CardContent className="space-y-4">
          <Tabs value={pageTab} onValueChange={handlePageTabChange}>
            <TabsList className="w-full">
              <TabsTrigger
                className="w-1/2"
                value="notifications"
                data-testid="page-tab-notifications"
              >
                {t("pageTabs.notifications")}
              </TabsTrigger>
              <TabsTrigger
                className="w-1/2"
                value="alerts"
                data-testid="page-tab-alerts"
              >
                {t("pageTabs.alerts")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="notifications" className="pt-4">
              <NotificationPreferencesCard
                userId={profileUserId}
                canEdit={isOwn || isAdmin}
              />
            </TabsContent>
            <TabsContent value="alerts" className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                {isOwn
                  ? t("description")
                  : t("descriptionFor", { name: profileUser.name })}
              </p>
              <div className="flex flex-row items-start justify-between gap-4">
                <div className="flex grow flex-col">
                  <div className="flex flex-wrap items-center gap-4">
                    <Filter
                      key="alerts-filter"
                      initialSearchString={searchString}
                      onSearchChange={setSearchString}
                      dataTestId="alerts-filter"
                      className="min-w-[150px] sm:w-1/3"
                    />
                    <AlertListFilters
                      filters={listFilters}
                      onChange={handleListFiltersChange}
                      creators={creators}
                    />
                  </div>
                  <div className="m-2">
                    <ColumnSelection
                      key="alerts-column-selection"
                      storageKey="user-alerts"
                      columns={columns}
                      onVisibilityChange={setColumnVisibility}
                      hideColumnRef={hideColumnRef}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {addAlertButton}
                  {allRows.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {tGlobal("admin.auditLogs.showing", {
                        loaded: rows.length.toLocaleString(locale),
                        total: allRows.length.toLocaleString(locale),
                      })}
                    </p>
                  )}
                </div>
              </div>
              <div className="w-full">
                <DataTable
                  virtualized
                  fillViewport
                  columns={columns}
                  data={rows}
                  onSortChange={handleSortChange}
                  onSortColumn={handleSortColumn}
                  onHideColumn={(columnId) => hideColumnRef.current?.(columnId)}
                  sortConfig={sortConfig}
                  columnVisibility={columnVisibility}
                  onColumnVisibilityChange={setColumnVisibility}
                  isLoading={loading}
                  emptyMessage={
                    searchString.trim() || isAnyAlertFilterActive(listFilters)
                      ? tCommon("labels.noResults")
                      : creatableProjects.length > 0
                        ? t("emptyCanCreate")
                        : t("empty")
                  }
                  resetKey={`${searchString}|${sortConfig.column}|${sortConfig.direction}`}
                  testIdPrefix="alerts-table"
                  rowTestIdPrefix="alert-rule-row"
                />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <AlertRuleDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        projectId={editingRule?.projectId ?? null}
        projectOptions={creatableProjects}
        rule={editingRule}
        canSubscribeOthers={
          editingRule
            ? isAdmin ||
              mergedPermissions[editingRule.projectId]?.isProjectAdmin === true
            : false
        }
        canSubscribeOthersFor={(projectId) =>
          isAdmin || mergedPermissions[projectId]?.isProjectAdmin === true
        }
        onSaved={refetch}
      />

      <AlertRuleHistoryDialog
        open={historyRule != null}
        onOpenChange={(open) => {
          if (!open) setHistoryRule(null);
        }}
        rule={historyRule}
        projectId={historyRule?.projectId ?? 0}
      />

      <AlertDialog
        open={deleting != null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent data-testid="alert-delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteRule")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirm", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              data-testid="alert-delete-confirm"
            >
              {tCommon("actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pausing != null}
        onOpenChange={(open) => {
          if (!open) setPausing(null);
        }}
      >
        <AlertDialogContent data-testid="alert-pause-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pauseTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pauseConfirm", {
                name: pausing?.name ?? "",
                count: pausing?.subscribers.length ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmPause()}
              data-testid="alert-pause-confirm"
            >
              {tCommon("actions.pause")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
