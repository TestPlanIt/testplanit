"use client";

import { useState } from "react";
import { JSONContent } from "@tiptap/core";
import { CommentEditor } from "./CommentEditor";
import { CommentItem } from "./CommentItem";
import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import {
  createComment,
  updateComment,
  deleteComment,
} from "~/app/actions/comments";
import { Separator } from "~/components/ui/separator";

interface Comment {
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
}

interface CommentListProps {
  projectId: number;
  entityType: "repositoryCase" | "testRun" | "session" | "milestone";
  entityId: number;
  initialComments: Comment[];
  currentUserId: string;
  isAdmin: boolean;
}

export function CommentList({
  projectId,
  entityType,
  entityId,
  initialComments,
  currentUserId,
  isAdmin,
}: CommentListProps) {
  const t = useTranslations();
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [isCreating, setIsCreating] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

  const handleCreate = async (content: JSONContent) => {
    setIsCreating(true);
    try {
      // Serialize content to plain JSON to avoid client reference issues
      const serializedContent = JSON.parse(JSON.stringify(content));

      const input: any = {
        content: serializedContent,
        projectId,
      };

      if (entityType === "repositoryCase") {
        input.repositoryCaseId = entityId;
      } else if (entityType === "testRun") {
        input.testRunId = entityId;
      } else if (entityType === "session") {
        input.sessionId = entityId;
      } else if (entityType === "milestone") {
        input.milestoneId = entityId;
      }

      const result = await createComment(input);

      if (result.success && result.comment) {
        // Transform the result to match our Comment type
        const newComment: Comment = {
          id: result.comment.id,
          content: result.comment.content as any,
          createdAt: result.comment.createdAt,
          updatedAt: result.comment.updatedAt,
          isEdited: result.comment.isEdited,
          creator: {
            id: result.comment.creator.id,
            name: result.comment.creator.name,
            image: (result.comment.creator as any).image || null,
            email: (result.comment.creator as any).email || "user@example.com",
            isActive: true,
            isDeleted: false,
          },
        };
        setComments([...comments, newComment]);
        // Force editor to remount with fresh instance
        setEditorKey((prev) => prev + 1);
      } else {
        console.error("Failed to create comment:", result.error);
      }
    } catch (error) {
      console.error("Failed to create comment:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdate = async (commentId: string, content: JSONContent) => {
    // Serialize content to plain JSON to avoid client reference issues
    const serializedContent = JSON.parse(JSON.stringify(content));

    const result = await updateComment({
      commentId,
      content: serializedContent,
    });

    if (result.success && result.comment) {
      setComments(
        comments.map((c) =>
          c.id === commentId
            ? {
                ...c,
                content: result.comment.content as JSONContent,
                isEdited: result.comment.isEdited,
                updatedAt: result.comment.updatedAt,
              }
            : c
        )
      );
    } else {
      throw new Error(result.error);
    }
  };

  const handleDelete = async (commentId: string) => {
    const result = await deleteComment(commentId);

    if (result.success) {
      setComments(comments.filter((c) => c.id !== commentId));
    } else {
      throw new Error(result.error);
    }
  };

  return (
    <div className="space-y-2 bg-primary/10 rounded-md p-2">
      <div className="flex items-center gap-1 text-primary">
        <MessageSquare className="h-5 w-5" />
        <h3 className="text-md font-semibold">
          {t("comments.title")}
          {` (${comments.length})`}
        </h3>
      </div>

      <CommentEditor
        key={editorKey}
        projectId={projectId}
        onSubmit={handleCreate}
        placeholder={t("comments.placeholder")}
        submitLabel={t("comments.postComment")}
        isLoading={isCreating}
      />

      {comments.length > 0 && (
        <div className="space-y-4 pt-4">
          {comments.map((comment) => (
            <div key={comment.id}>
              <Separator className="bg-primary/60 mb-2" />
              <CommentItem
                key={comment.id}
                comment={comment}
                projectId={projectId}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            </div>
          ))}
        </div>
      )}

      {comments.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
          <MessageSquare className="mb-2 h-12 w-12 opacity-20" />
          <p className="text-sm">{t("comments.noComments")}</p>
        </div>
      )}
    </div>
  );
}
