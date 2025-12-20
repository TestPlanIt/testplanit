"use client";

import { useState, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { JSONContent } from "@tiptap/core";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { MoreVertical, Edit, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "~/utils";
import { CommentEditor } from "./CommentEditor";
import { createMentionExtension } from "~/lib/tiptap/mentionExtension";
import { useTranslations } from "next-intl";
import { Avatar } from "~/components/Avatar";
import { UserNameCell } from "~/components/tables/UserNameCell";

interface CommentItemProps {
  comment: {
    id: string;
    content: JSONContent;
    createdAt: Date;
    updatedAt: Date;
    isEdited: boolean;
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

  const isCreator = comment.creator.id === currentUserId;
  const canEdit = isCreator;
  const canDelete = isCreator || isAdmin;

  // Editor for displaying comment content (read-only)
  const displayEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
      createMentionExtension(projectId),
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
            className="rounded-md border border-border bg-muted/30 p-3 wrap-break-word overflow-hidden"
            style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
          >
            <EditorContent editor={displayEditor} />
          </div>
        )}
      </div>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("comments.deleteDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("comments.confirmDelete")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              {t("common.actions.cancel")}
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
