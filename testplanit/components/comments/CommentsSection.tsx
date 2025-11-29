"use client";

import { CommentList } from "./CommentList";
import { getCommentsForEntity } from "~/app/actions/comments";
import { useEffect, useState } from "react";
import { Skeleton } from "~/components/ui/skeleton";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { JSONContent } from "@tiptap/core";

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

interface CommentsSectionProps {
  projectId: number;
  entityType: "repositoryCase" | "testRun" | "session";
  entityId: number;
  currentUserId: string;
  isAdmin: boolean;
}

export function CommentsSection({
  projectId,
  entityType,
  entityId,
  currentUserId,
  isAdmin,
}: CommentsSectionProps) {
  const t = useTranslations();
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchComments() {
      try {
        const result = await getCommentsForEntity(entityType, entityId);
        if (result.success && result.comments) {
          setComments(result.comments as Comment[]);
        } else {
          setError(result.error || t("comments.errors.loadFailed"));
        }
      } catch (err) {
        console.error("Failed to fetch comments:", err);
        setError(t("comments.errors.loadFailed"));
      } finally {
        setIsLoading(false);
      }
    }

    fetchComments();
  }, [entityType, entityId, t]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className="items-center">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <CommentList
      projectId={projectId}
      entityType={entityType}
      entityId={entityId}
      initialComments={comments}
      currentUserId={currentUserId}
      isAdmin={isAdmin}
    />
  );
}
