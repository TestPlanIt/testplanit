"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { revokeShareLink } from "@/actions/share-links";
import { DateFormatter } from "@/components/DateFormatter";
import { EditShareLinkDialog } from "@/components/share/EditShareLinkDialog";
import { DataTable } from "@/components/tables/DataTable";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShareLinkEntityType } from "~/zenstack/models";
import type { ColumnDef } from "@tanstack/react-table";
import { isPast } from "date-fns";
import {
  Ban,
  Bell,
  BellOff,
  CheckCircle2,
  Copy,
  Eye,
  Loader2,
  MoreVertical,
  Pencil,
  Trash,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Link } from "~/lib/navigation";

interface ShareLinkListProps {
  projectId?: number; // Optional for cross-project reports
  entityType?: ShareLinkEntityType;
  showProjectColumn?: boolean;
}

type ShareRow = {
  id: string;
  name: string;
  [key: string]: any;
};

// Sortable columns → the ShareLink DB field the server should order by.
const COLUMN_TO_FIELD: Record<string, string> = {
  title: "title",
  views: "viewCount",
  created: "createdAt",
  expires: "expiresAt",
};

export function ShareLinkList({
  projectId,
  entityType,
  showProjectColumn = false,
}: ShareLinkListProps) {
  const t = useTranslations("reports.shareDialog.shareList");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();
  const dateFormat = session?.user?.preferences?.dateFormat;
  const timezone = session?.user?.preferences?.timezone;

  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedShareId, setSelectedShareId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedShare, setSelectedShare] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{
    column: string;
    direction: "asc" | "desc";
  }>({ column: "created", direction: "desc" });
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});

  const sortField = COLUMN_TO_FIELD[sortConfig.column] ?? "createdAt";

  // Fetch shares (exclude deleted)
  const {
    data: shares,
    isLoading,
    refetch,
  } = useClientQueries(schema).shareLink.useFindMany({
    where: {
      ...(projectId !== undefined && { projectId }),
      ...(entityType && { entityType }),
      isDeleted: false, // Exclude soft-deleted shares
    },
    include: {
      project: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      [sortField]: sortConfig.direction,
    },
  });

  const { mutateAsync: updateShareLink, isPending: isRevoking } =
    useClientQueries(schema).shareLink.useUpdate();

  // Stabilize mutation + refetch so the memoized column cells never go stale
  // and never force a columns rebuild (which would loop DataTable's visibility
  // effect).
  const updateShareLinkRef = useRef(updateShareLink);
  const refetchRef = useRef(refetch);
  useEffect(() => {
    updateShareLinkRef.current = updateShareLink;
    refetchRef.current = refetch;
  });

  const handleCopyLink = useCallback(
    async (shareKey: string, shareId: string) => {
      const protocol = window.location.protocol;
      const host = window.location.host;
      const shareUrl = `${protocol}//${host}/share/${shareKey}`;

      try {
        await navigator.clipboard.writeText(shareUrl);
        setCopiedId(shareId);
        toast.success(t("toast.linkCopied"), {
          description: t("toast.linkCopiedDescription"),
        });
        setTimeout(() => setCopiedId(null), 2000);
      } catch {
        toast.error(t("toast.copyFailed"), {
          description: t("toast.copyFailedDescription"),
        });
      }
    },
    [t]
  );

  const handleRevoke = async () => {
    if (!selectedShareId) return;

    try {
      // Update share link using ZenStack hook
      await updateShareLinkRef.current({
        where: { id: selectedShareId },
        data: { isRevoked: true },
      });

      // Create audit log via server action
      await revokeShareLink(selectedShareId);

      toast.success(t("toast.linkRevoked"), {
        description: t("toast.linkRevokedDescription"),
      });

      void refetchRef.current();
      setRevokeDialogOpen(false);
      setSelectedShareId(null);
    } catch {
      toast.error(t("toast.revokeFailed"), {
        description: t("toast.revokeFailedDescription"),
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedShareId) return;

    try {
      // Soft delete share link using ZenStack hook
      await updateShareLinkRef.current({
        where: { id: selectedShareId },
        data: { isDeleted: true },
      });

      toast.success(t("toast.linkDeleted"), {
        description: t("toast.linkDeletedDescription"),
      });

      void refetchRef.current();
      setDeleteDialogOpen(false);
      setSelectedShareId(null);
    } catch {
      toast.error(t("toast.deleteFailed"), {
        description: t("toast.deleteFailedDescription"),
      });
    }
  };

  const handleToggleNotifications = useCallback(
    async (shareId: string, currentValue: boolean) => {
      try {
        await updateShareLinkRef.current({
          where: { id: shareId },
          data: { notifyOnView: !currentValue },
        });

        toast.success(
          currentValue
            ? t("toast.notificationsDisabled")
            : t("toast.notificationsEnabled"),
          {
            description: currentValue
              ? t("toast.notificationsDisabledDescription")
              : t("toast.notificationsEnabledDescription"),
          }
        );

        void refetchRef.current();
      } catch {
        toast.error(t("toast.notificationUpdateFailed"), {
          description: t("toast.notificationUpdateFailedDescription"),
        });
      }
    },
    [t]
  );

  const handleSortChange = useCallback((column: string) => {
    setSortConfig((prev) =>
      prev.column === column && prev.direction === "asc"
        ? { column, direction: "desc" }
        : { column, direction: "asc" }
    );
  }, []);

  // Explicit-direction sort from the header column menu; `null` (Remove sort)
  // restores the default order.
  const handleSortColumn = useCallback(
    (column: string, direction: "asc" | "desc" | null) => {
      if (direction === null) {
        setSortConfig({ column: "created", direction: "desc" });
      } else {
        setSortConfig({ column, direction });
      }
    },
    []
  );

  const data = useMemo<ShareRow[]>(
    () =>
      (shares ?? []).map((share: any) => ({
        ...share,
        name: share.title ?? "",
      })),
    [shares]
  );

  const columns = useMemo<ColumnDef<ShareRow>[]>(() => {
    const cols: ColumnDef<ShareRow>[] = [];

    if (showProjectColumn) {
      cols.push({
        id: "project",
        accessorKey: "project",
        header: tCommon("fields.project"),
        enableSorting: false,
        size: 140,
        meta: { isPinned: "left" },
        cell: ({ row }) => (
          <span className="block truncate text-sm">
            {row.original.project?.name || t("noProject")}
          </span>
        ),
      });
    }

    cols.push(
      {
        id: "title",
        accessorKey: "title",
        header: tCommon("fields.title"),
        enableSorting: true,
        enableHiding: false,
        size: 260,
        // Pin the title left only when it is the first column. When the project
        // column is shown it takes the pinned-first slot instead.
        meta: showProjectColumn ? undefined : { isPinned: "left" },
        cell: ({ row }) => {
          const share = row.original;
          return (
            <div className="min-w-0">
              <Link
                href={`/share/${share.shareKey}`}
                className="block truncate font-medium hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {share.title ||
                  t("defaultTitle", { entityType: share.entityType })}
              </Link>
              {share.description && (
                <p className="truncate text-sm text-muted-foreground">
                  {share.description}
                </p>
              )}
            </div>
          );
        },
      },
      {
        id: "mode",
        accessorKey: "mode",
        header: t("columns.mode"),
        enableSorting: false,
        size: 150,
        cell: ({ row }) => (
          <Badge
            variant="secondary"
            className="text-xs w-fit whitespace-nowrap"
          >
            {row.original.mode.replace("_", " ")}
          </Badge>
        ),
      },
      {
        id: "views",
        accessorKey: "viewCount",
        header: t("columns.views"),
        enableSorting: true,
        size: 90,
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Eye className="h-3 w-3 text-muted-foreground" />
            <span>{row.original.viewCount}</span>
          </div>
        ),
      },
      {
        id: "notifications",
        accessorKey: "notifyOnView",
        header: tCommon("fields.notificationMode"),
        enableSorting: false,
        size: 140,
        cell: ({ row }) => {
          const share = row.original;
          const isExpired =
            share.expiresAt && isPast(new Date(share.expiresAt));
          const isActive = !share.isRevoked && !isExpired;
          return (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                handleToggleNotifications(share.id, share.notifyOnView)
              }
              disabled={!isActive}
              className="h-8 gap-2"
            >
              {share.notifyOnView ? (
                <>
                  <Bell className="h-4 w-4 text-primary" />
                  <span className="text-xs">{t("notifications.enabled")}</span>
                </>
              ) : (
                <>
                  <BellOff className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {t("notifications.disabled")}
                  </span>
                </>
              )}
            </Button>
          );
        },
      },
      {
        id: "created",
        accessorKey: "createdAt",
        header: tCommon("fields.created"),
        enableSorting: true,
        size: 130,
        cell: ({ row }) => (
          <div className="text-sm text-muted-foreground whitespace-nowrap">
            <DateFormatter
              date={row.original.createdAt}
              formatString={dateFormat}
              timezone={timezone}
            />
          </div>
        ),
      },
      {
        id: "expires",
        accessorKey: "expiresAt",
        header: t("columns.expires"),
        enableSorting: true,
        size: 130,
        cell: ({ row }) => {
          const share = row.original;
          const isExpired =
            share.expiresAt && isPast(new Date(share.expiresAt));
          return share.expiresAt ? (
            <span
              className={`text-sm whitespace-nowrap ${
                isExpired ? "text-destructive" : ""
              }`}
            >
              <DateFormatter
                date={share.expiresAt}
                formatString={dateFormat}
                timezone={timezone}
              />
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              {tCommon("never")}
            </span>
          );
        },
      },
      {
        id: "status",
        accessorKey: "isRevoked",
        header: tCommon("actions.status"),
        enableSorting: false,
        size: 100,
        cell: ({ row }) => {
          const share = row.original;
          const isExpired =
            share.expiresAt && isPast(new Date(share.expiresAt));
          if (share.isRevoked) {
            return <Badge variant="destructive">{t("status.revoked")}</Badge>;
          }
          if (isExpired) {
            return <Badge variant="secondary">{t("status.expired")}</Badge>;
          }
          return (
            <Badge variant="default" className="bg-success">
              {tCommon("fields.isActive")}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        enableSorting: false,
        enableHiding: false,
        meta: { isPinned: "right" },
        size: 80,
        cell: ({ row }) => {
          const share = row.original;
          const isExpired =
            share.expiresAt && isPast(new Date(share.expiresAt));
          const isActive = !share.isRevoked && !isExpired;
          return (
            <div className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-testid={`share-actions-${share.id}`}
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                  >
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">
                      {tCommon("actions.actionsLabel")}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    data-testid={`share-copy-${share.id}`}
                    onClick={() => handleCopyLink(share.shareKey, share.id)}
                  >
                    {copiedId === share.id ? (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        {tCommon("actions.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="me-1 h-4 w-4" />
                        {t("actions.copyLink")}
                      </>
                    )}
                  </DropdownMenuItem>
                  {isActive ? (
                    <>
                      <DropdownMenuItem
                        data-testid={`share-edit-${share.id}`}
                        onClick={() => {
                          setSelectedShare(share);
                          setEditDialogOpen(true);
                        }}
                      >
                        <Pencil className="me-1 h-4 w-4" />
                        {tCommon("actions.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid={`share-revoke-${share.id}`}
                        onClick={() => {
                          setSelectedShareId(share.id);
                          setRevokeDialogOpen(true);
                        }}
                        className="text-destructive"
                      >
                        <Ban className="me-1 h-4 w-4" />
                        {t("actions.revoke")}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid={`share-delete-${share.id}`}
                        onClick={() => {
                          setSelectedShareId(share.id);
                          setDeleteDialogOpen(true);
                        }}
                        className="text-destructive"
                      >
                        <Trash className="me-1 h-4 w-4" />
                        {tCommon("actions.delete")}
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem
                      data-testid={`share-delete-${share.id}`}
                      onClick={() => {
                        setSelectedShareId(share.id);
                        setDeleteDialogOpen(true);
                      }}
                      className="text-destructive"
                    >
                      <Trash className="me-1 h-4 w-4" />
                      {tCommon("actions.delete")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }
    );

    return cols;
  }, [
    t,
    tCommon,
    showProjectColumn,
    copiedId,
    dateFormat,
    timezone,
    handleCopyLink,
    handleToggleNotifications,
  ]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!shares || shares.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>{t("empty.title")}</p>
        <p className="text-sm mt-1">{t("empty.description")}</p>
      </div>
    );
  }

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        onSortChange={handleSortChange}
        onSortColumn={handleSortColumn}
        sortConfig={sortConfig}
        columnVisibility={columnVisibility}
        onColumnVisibilityChange={setColumnVisibility}
        rowTestIdPrefix="share-row"
      />

      {/* Revoke confirmation dialog */}
      <AlertDialog open={revokeDialogOpen} onOpenChange={setRevokeDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("revokeDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("revokeDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("revokeDialog.revoking")}
                </>
              ) : (
                t("revokeDialog.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tCommon("actions.deleting")}
                </>
              ) : (
                t("deleteDialog.confirm")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit share link dialog */}
      {selectedShare && (
        <EditShareLinkDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          shareLink={selectedShare}
          onSuccess={() => {
            void refetch();
            setEditDialogOpen(false);
            setSelectedShare(null);
          }}
        />
      )}
    </>
  );
}
