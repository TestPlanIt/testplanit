"use client";

import { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { formatDistanceToNow } from "date-fns";
import {
  Ban,
  CheckCircle2,
  Edit,
  MessageCircleWarning,
  MessageSquareWarning,
  MoreVertical,
  Trash2,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { UserNameCell } from "~/components/tables/UserNameCell";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { createMentionExtension } from "~/lib/tiptap/mentionExtension";
import { cn } from "~/utils";
import { CommentEditor } from "./CommentEditor";

interface CommentItemProps {
  comment: {
    id: string;
    content: JSONContent;
    createdAt: Date;
    updatedAt: Date;
    isEdited: boolean;
    // Hybrid-comments (D-21 follow-up): REVIEW_REQUEST / REVIEW_DECISION rows
    // render a labeled badge + accent and are NOT user-editable (audit-tied
    // to the ReviewRequest row).
    type?: "GENERAL" | "REVIEW_REQUEST" | "REVIEW_DECISION";
    reviewRequest?: {
      status:
        | "PENDING"
        | "APPROVED"
        | "CHANGES_REQUESTED"
        | "REJECTED"
        | "CANCELLED";
    } | null;
    creator: {
      id: string;
      name: string | null;
      email: string;
      image: string | null;
      isActive: boolean;
      isDeleted: boolean;
    };
  };
  projectId: number;
  currentUserId: string;
  isAdmin: boolean;
  onUpdate: (commentId: string, content: JSONContent) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  className?: string;
}

export function CommentItem({
  comment,
  projectId,
  currentUserId,
  isAdmin,
  onUpdate,
  onDelete,
  className,
}: CommentItemProps) {
  const t = useTranslations();
  const [isEditing, setIsEditing] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const commentType = comment.type ?? "GENERAL";
  const isReviewType = commentType !== "GENERAL";

  const isCreator = comment.creator.id === currentUserId;
  // Review-type comments are auto-generated and pinned to the ReviewRequest
  // they capture — edit/delete would corrupt audit context, so hide both
  // entry points regardless of creator/admin.
  const canEdit = isCreator && !isReviewType;
  const canDelete = (isCreator || isAdmin) && !isReviewType;

  // Decision badge label: REVIEW_REQUEST is always "Review request"; the
  // REVIEW_DECISION label encodes the outcome from the linked
  // ReviewRequest.status so the conversation surface reads as
  // "Approved" / "Changes requested" / "Rejected" / "Cancelled" rather than
  // a generic "Review decision".
  const badgeKey = (() => {
    if (commentType === "REVIEW_REQUEST") {
      return "comments.type.reviewRequest";
    }
    if (commentType === "REVIEW_DECISION") {
      switch (comment.reviewRequest?.status) {
        case "APPROVED":
          return "comments.type.reviewDecision.approved";
        case "CHANGES_REQUESTED":
          return "comments.type.reviewDecision.changesRequested";
        case "REJECTED":
          return "comments.type.reviewDecision.rejected";
        case "CANCELLED":
          return "comments.type.reviewDecision.cancelled";
        default:
          return "comments.type.reviewDecision.generic";
      }
    }
    return null;
  })();

  // Accent variants pair with the badge for at-a-glance scannability.
  // REVIEW_REQUEST = primary tint (matches the requester's "asking" tone);
  // REVIEW_DECISION = outcome-tinted (success / warning / destructive) so
  // the eye lands on rejected/changes-requested rows first.
  const accentClasses = (() => {
    if (commentType === "REVIEW_REQUEST") {
      return "border-l-4 border-l-primary";
    }
    if (commentType === "REVIEW_DECISION") {
      switch (comment.reviewRequest?.status) {
        case "APPROVED":
          return "border-l-4 border-l-emerald-500";
        case "CHANGES_REQUESTED":
          return "border-l-4 border-l-amber-500";
        case "REJECTED":
          return "border-l-4 border-l-destructive";
        case "CANCELLED":
          return "border-l-4 border-l-muted-foreground";
        default:
          return "border-l-4 border-l-muted-foreground";
      }
    }
    return "";
  })();

  // Badge chrome — pairs with the accent for at-a-glance scannability,
  // and matches the inbox's Decided-tab status column for cross-surface
  // consistency. REJECTED keeps the shadcn destructive variant; the
  // success/warning/cancelled outcomes layer their classes directly so
  // the badge fills with the outcome color and shows white text + icon.
  const badgeProps: { variant?: "destructive"; className: string } = (() => {
    const base = "gap-1";
    if (commentType === "REVIEW_DECISION") {
      switch (comment.reviewRequest?.status) {
        case "APPROVED":
          return {
            className: `${base} bg-success text-success-foreground border-success hover:bg-success/90`,
          };
        case "CHANGES_REQUESTED":
          return {
            className: `${base} bg-warning text-white border-warning hover:bg-warning/90`,
          };
        case "REJECTED":
          return { variant: "destructive", className: base };
        case "CANCELLED":
          return {
            className: `${base} bg-muted-foreground text-background border-muted-foreground hover:bg-muted-foreground/90`,
          };
        default:
          return { className: base };
      }
    }
    // REVIEW_REQUEST + any fallback stays on the secondary look.
    return { className: `${base} bg-secondary text-secondary-foreground` };
  })();

  // Icon paired with each badge — matches the trigger/decide-button glyphs
  // used elsewhere so the conversation surface reads consistently:
  //   REVIEW_REQUEST       → MessageSquareWarning (same as the case-page trigger)
  //   REVIEW_DECISION outcomes → CheckCircle2 / MessageCircleWarning / XCircle / Ban
  const BadgeIcon: LucideIcon | null = (() => {
    if (commentType === "REVIEW_REQUEST") return MessageSquareWarning;
    if (commentType === "REVIEW_DECISION") {
      switch (comment.reviewRequest?.status) {
        case "APPROVED":
          return CheckCircle2;
        case "CHANGES_REQUESTED":
          return MessageCircleWarning;
        case "REJECTED":
          return XCircle;
        case "CANCELLED":
          return Ban;
        default:
          return null;
      }
    }
    return null;
  })();

  // Editor for displaying comment content (read-only)
  const displayEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
      createMentionExtension(projectId, currentUserId),
    ],
    content: comment.content,
    editable: false,
    editorProps: {
      attributes: {
        class: "tiptap text-foreground focus:outline-none break-words",
      },
    },
  });

  // Update editor content when comment changes
  useEffect(() => {
    if (displayEditor && !isEditing) {
      displayEditor.commands.setContent(comment.content);
    }
  }, [comment.content, displayEditor, isEditing]);

  const handleUpdate = async (content: JSONContent) => {
    setIsUpdating(true);
    try {
      await onUpdate(comment.id, content);
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update comment:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    setShowDeleteDialog(false);
    try {
      await onDelete(comment.id);
    } catch (error) {
      console.error("Failed to delete comment:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className={cn("flex gap-3", className)}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center min-w-0 flex-1">
            <UserNameCell userId={comment.creator.id} hideLink />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground line-clamp-1">
              {formatDistanceToNow(new Date(comment.createdAt), {
                addSuffix: true,
              })}
            </span>
            {comment.isEdited && (
              <span className="text-xs text-muted-foreground italic">
                {t("comments.edited")}
              </span>
            )}
            {(canEdit || canDelete) && !isEditing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={isDeleting}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit && (
                    <DropdownMenuItem onClick={() => setIsEditing(true)}>
                      <Edit className="mr-2 h-4 w-4" />
                      {t("common.actions.edit")}
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      onClick={handleDeleteClick}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {t("common.actions.delete")}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {badgeKey && (
          <div>
            <Badge
              variant={badgeProps.variant}
              data-testid={`comment-type-badge-${commentType.toLowerCase()}`}
              className={badgeProps.className}
            >
              {BadgeIcon && <BadgeIcon className="h-3 w-3 shrink-0" />}
              {t(badgeKey)}
            </Badge>
          </div>
        )}

        {isEditing ? (
          <CommentEditor
            projectId={projectId}
            initialContent={comment.content}
            onSubmit={handleUpdate}
            onCancel={() => setIsEditing(false)}
            placeholder={t("comments.editPlaceholder")}
            submitLabel={t("common.actions.save")}
            isLoading={isUpdating}
            className="mt-2"
          />
        ) : (
          <div
            className={cn(
              "rounded-md border border-border bg-muted/30 p-3 wrap-break-word overflow-hidden",
              accentClasses
            )}
            style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
            data-testid={
              isReviewType
                ? `comment-card-${commentType.toLowerCase()}`
                : undefined
            }
          >
            <EditorContent editor={displayEditor} />
          </div>
        )}
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("comments.deleteDialog.title")}</DialogTitle>
            <DialogDescription>{t("comments.confirmDelete")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={isDeleting}
            >
              {t("common.actions.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
