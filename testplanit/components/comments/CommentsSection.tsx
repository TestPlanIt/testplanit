"use client";

import { JSONContent } from "@tiptap/core";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { getCommentsForEntity } from "~/app/actions/comments";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Skeleton } from "~/components/ui/skeleton";
import { CommentList } from "./CommentList";

import { commentsQueryKey } from "./commentsQueryKey";

export {
  commentsQueryKey,
  reviewableEntityTypeToCommentEntityType,
} from "./commentsQueryKey";

interface Comment {
  id: string;
  content: JSONContent;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
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
}

interface CommentsSectionProps {
  projectId: number;
  entityType: "repositoryCase" | "testRun" | "session" | "milestone";
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
  const {
    data: comments = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: commentsQueryKey(entityType, entityId),
    queryFn: async () => {
      const result = await getCommentsForEntity(entityType, entityId);
      if (!result.success || !result.comments) {
        throw new Error(result.error || t("comments.errors.loadFailed"));
      }
      return result.comments as Comment[];
    },
  });

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
        <AlertDescription>
          {error instanceof Error
            ? error.message
            : t("comments.errors.loadFailed")}
        </AlertDescription>
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
