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
import { Copy, MoreVertical, Ban, Trash2, Eye, Loader2, CheckCircle2 } from "lucide-react";
import { format, isPast } from "date-fns";
import { useToast } from "@/components/ui/use-toast";
import { ShareLinkEntityType } from "@prisma/client";
import { revokeShareLink } from "@/actions/share-links";

interface ShareLinkListProps {
  projectId?: number; // Optional for cross-project reports
  entityType?: ShareLinkEntityType;
}

export function ShareLinkList({ projectId, entityType }: ShareLinkListProps) {
  const { toast } = useToast();
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [selectedShareId, setSelectedShareId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Fetch shares
  const { data: shares, isLoading, refetch } = useFindManyShareLink({
    where: {
      ...(projectId !== undefined && { projectId }),
      ...(entityType && { entityType }),
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
      toast({
        title: "Link copied!",
        description: "The share link has been copied to your clipboard.",
      });
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please copy the link manually.",
        variant: "destructive",
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

      toast({
        title: "Share link revoked",
        description: "The share link has been revoked and is no longer accessible.",
      });

      refetch();
      setRevokeDialogOpen(false);
      setSelectedShareId(null);
    } catch (error) {
      toast({
        title: "Failed to revoke",
        description: "An error occurred while revoking the share link.",
        variant: "destructive",
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
        <p>No share links created yet.</p>
        <p className="text-sm mt-1">Create your first share link to get started.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Views</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shares.map((share: any) => {
              const isExpired = share.expiresAt && isPast(new Date(share.expiresAt));
              const isActive = !share.isRevoked && !isExpired;

              return (
                <TableRow key={share.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">
                        {share.title || `${share.entityType} share`}
                      </p>
                      {share.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {share.description}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {share.mode.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Eye className="h-3 w-3 text-muted-foreground" />
                      <span>{share.viewCount}</span>
                    </div>
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
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {share.isRevoked ? (
                      <Badge variant="destructive">Revoked</Badge>
                    ) : isExpired ? (
                      <Badge variant="secondary">Expired</Badge>
                    ) : (
                      <Badge variant="default" className="bg-green-500">
                        Active
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => handleCopyLink(share.shareKey, share.id)}
                        >
                          {copiedId === share.id ? (
                            <>
                              <CheckCircle2 className="mr-2 h-4 w-4" />
                              Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="mr-2 h-4 w-4" />
                              Copy Link
                            </>
                          )}
                        </DropdownMenuItem>
                        {isActive && (
                          <DropdownMenuItem
                            onClick={() => {
                              setSelectedShareId(share.id);
                              setRevokeDialogOpen(true);
                            }}
                            className="text-destructive"
                          >
                            <Ban className="mr-2 h-4 w-4" />
                            Revoke
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
            <AlertDialogTitle>Revoke share link?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke the share link. Anyone attempting to access it
              will see an error message. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevoke}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Revoking...
                </>
              ) : (
                "Revoke Link"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
