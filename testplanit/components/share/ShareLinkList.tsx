"use client";

import { useState } from "react";
import { useFindManyShareLink, useUpdateShareLink } from "~/lib/hooks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Copy, MoreVertical, Ban, Trash2, Eye, Loader2, CheckCircle2, Bell, BellOff, Pencil } from "lucide-react";
import { format, isPast } from "date-fns";
import { toast } from "sonner";
import { ShareLinkEntityType } from "@prisma/client";
import { revokeShareLink } from "@/actions/share-links";
import { useTranslations } from "next-intl";
import { EditShareLinkDialog } from "@/components/share/EditShareLinkDialog";
import { Link } from "~/lib/navigation";

interface ShareLinkListProps {
  projectId?: number; // Optional for cross-project reports
  entityType?: ShareLinkEntityType;
  showProjectColumn?: boolean;
}

export function ShareLinkList({ projectId, entityType, showProjectColumn = false }: ShareLinkListProps) {
  const t = useTranslations("reports.shareDialog.shareList");
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedShareId, setSelectedShareId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedShare, setSelectedShare] = useState<any>(null);

  // Fetch shares (exclude deleted)
  const { data: shares, isLoading, refetch } = useFindManyShareLink({
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
      createdAt: "desc",
    },
  });

  const { mutateAsync: updateShareLink, isPending: isRevoking } = useUpdateShareLink();

  const handleCopyLink = async (shareKey: string, shareId: string) => {
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
    } catch (error) {
      toast.error(t("toast.copyFailed"), {
        description: t("toast.copyFailedDescription"),
      });
    }
  };

  const handleRevoke = async () => {
    if (!selectedShareId) return;

    try {
      // Update share link using ZenStack hook
      await updateShareLink({
        where: { id: selectedShareId },
        data: { isRevoked: true },
      });

      // Create audit log via server action
      await revokeShareLink(selectedShareId);

      toast.success(t("toast.linkRevoked"), {
        description: t("toast.linkRevokedDescription"),
      });

      refetch();
      setRevokeDialogOpen(false);
      setSelectedShareId(null);
    } catch (error) {
      toast.error(t("toast.revokeFailed"), {
        description: t("toast.revokeFailedDescription"),
      });
    }
  };

  const handleDelete = async () => {
    if (!selectedShareId) return;

    try {
      // Soft delete share link using ZenStack hook
      await updateShareLink({
        where: { id: selectedShareId },
        data: { isDeleted: true },
      });

      toast.success(t("toast.linkDeleted"), {
        description: t("toast.linkDeletedDescription"),
      });

      refetch();
      setDeleteDialogOpen(false);
      setSelectedShareId(null);
    } catch (error) {
      toast.error(t("toast.deleteFailed"), {
        description: t("toast.deleteFailedDescription"),
      });
    }
  };

  const handleToggleNotifications = async (shareId: string, currentValue: boolean) => {
    try {
      await updateShareLink({
        where: { id: shareId },
        data: { notifyOnView: !currentValue },
      });

      toast.success(
        currentValue ? t("toast.notificationsDisabled") : t("toast.notificationsEnabled"),
        {
          description: currentValue
            ? t("toast.notificationsDisabledDescription")
            : t("toast.notificationsEnabledDescription"),
        }
      );

      refetch();
    } catch (error) {
      toast.error(t("toast.notificationUpdateFailed"), {
        description: t("toast.notificationUpdateFailedDescription"),
      });
    }
  };

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
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {showProjectColumn && <TableHead>{t("columns.project")}</TableHead>}
              <TableHead>{t("columns.title")}</TableHead>
              <TableHead>{t("columns.mode")}</TableHead>
              <TableHead className="text-right">{t("columns.views")}</TableHead>
              <TableHead>{t("columns.notifications")}</TableHead>
              <TableHead>{t("columns.created")}</TableHead>
              <TableHead>{t("columns.expires")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shares.map((share: any) => {
              const isExpired = share.expiresAt && isPast(new Date(share.expiresAt));
              const isActive = !share.isRevoked && !isExpired;

              return (
                <TableRow key={share.id}>
                  {showProjectColumn && (
                    <TableCell className="text-sm">
                      {share.project?.name || t("noProject")}
                    </TableCell>
                  )}
                  <TableCell>
                    <div>
                      <Link
                        href={`/share/${share.shareKey}`}
                        className="font-medium hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {share.title || t("defaultTitle", { entityType: share.entityType })}
                      </Link>
                      {share.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {share.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs w-fit whitespace-nowrap">
                      {share.mode.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <Eye className="h-3 w-3 text-muted-foreground" />
                      <span>{share.viewCount}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleNotifications(share.id, share.notifyOnView)}
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
                          <span className="text-xs text-muted-foreground">{t("notifications.disabled")}</span>
                        </>
                      )}
                    </Button>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(share.createdAt), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell className="text-sm">
                    {share.expiresAt ? (
                      <span className={isExpired ? "text-destructive" : ""}>
                        {format(new Date(share.expiresAt), "MMM d, yyyy")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t("expires.never")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {share.isRevoked ? (
                      <Badge variant="destructive">{t("status.revoked")}</Badge>
                    ) : isExpired ? (
                      <Badge variant="secondary">{t("status.expired")}</Badge>
                    ) : (
                      <Badge variant="default" className="bg-green-500">
                        {t("status.active")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">{t("actions.label")}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleCopyLink(share.shareKey, share.id)}
                        >
                          {copiedId === share.id ? (
                            <>
                              <CheckCircle2 className="h-4 w-4" />
                              {t("actions.copied")}
                            </>
                          ) : (
                            <>
                              <Copy className="mr-1 h-4 w-4" />
                              {t("actions.copyLink")}
                            </>
                          )}
                        </DropdownMenuItem>
                        {isActive ? (
                          <>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedShare(share);
                                setEditDialogOpen(true);
                              }}
                            >
                              <Pencil className="mr-1 h-4 w-4" />
                              {t("actions.edit")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedShareId(share.id);
                                setRevokeDialogOpen(true);
                              }}
                              className="text-destructive"
                            >
                              <Ban className="mr-1 h-4 w-4" />
                              {t("actions.revoke")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                setSelectedShareId(share.id);
                                setDeleteDialogOpen(true);
                              }}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-1 h-4 w-4" />
                              {t("actions.delete")}
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedShareId(share.id);
                              setDeleteDialogOpen(true);
                            }}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            {t("actions.delete")}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

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
            <AlertDialogCancel>{t("revokeDialog.cancel")}</AlertDialogCancel>
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
            <AlertDialogCancel>{t("deleteDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("deleteDialog.deleting")}
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
            refetch();
            setEditDialogOpen(false);
            setSelectedShare(null);
          }}
        />
      )}
    </>
  );
}
