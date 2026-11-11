"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { formatDistanceToNow } from "date-fns";
import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { Link } from "~/lib/navigation";
import { createMentionExtension } from "~/lib/tiptap/mentionExtension";
import { cn } from "~/utils";

interface CommentsListDisplayProps {
  repositoryCaseId: number;
  projectId: number;
  count?: number;
  isLoading?: boolean;
}

interface CommentItemProps {
  comment: {
    id: string;
    content: any;
    createdAt: Date;
    creator: {
      id: string;
      name: string;
    };
  };
  projectId: number;
}

const CommentItem: React.FC<CommentItemProps> = ({ comment, projectId }) => {
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
        // Read-only display, not the role="textbox" Tiptap adds by default.
        role: "presentation",
        class: "tiptap text-foreground focus:outline-none text-xs break-words",
      },
    },
  });

  return (
    <div className="space-y-1 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center">
          <UserNameCell
            userId={comment.creator.id}
            hideLink
            className="text-xs font-medium"
          />
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(comment.createdAt), {
            addSuffix: true,
          })}
        </span>
      </div>
      <div className="line-clamp-2 text-xs text-muted-foreground">
        <EditorContent editor={displayEditor} />
      </div>
    </div>
  );
};

export const CommentsListDisplay: React.FC<CommentsListDisplayProps> = ({
  repositoryCaseId,
  projectId,
  count,
  isLoading = false,
}) => {
  const tCommon = useTranslations("common");
  const tComments = useTranslations("comments");
  const [open, setOpen] = useState(false);

  // Fetch first 3 comments when popover is opened
  const { data: comments, isLoading: isLoadingComments } = useClientQueries(
    schema
  ).comment.useFindMany(
    {
      where: {
        repositoryCaseId: repositoryCaseId,
        isDeleted: false,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 3,
      select: {
        id: true,
        content: true,
        createdAt: true,
        creator: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    },
    {
      enabled: open,
    }
  );

  // Show skeleton while loading and count is undefined
  if (isLoading && count === undefined) {
    return <Skeleton className="h-6 w-12" />;
  }

  if (count === undefined || count === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={tCommon("plural.comment", { count })}
          className={cn(
            badgeVariants({ variant: "default" }),
            "gap-1 text-xs whitespace-nowrap"
          )}
        >
          <MessageCircle className="h-4 w-4 shrink-0" />
          <span>{count}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {tComments("titleWithCount", { count })}
            </h4>
          </div>

          {isLoadingComments ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : comments && comments.length > 0 ? (
            <div
              className="max-h-[300px] space-y-3 overflow-y-auto"
              onWheel={(e) => e.stopPropagation()}
            >
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  projectId={projectId}
                />
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {tComments("noComments")}
            </div>
          )}

          <div className="border-t pt-2">
            <Link
              href={`/projects/repository/${projectId}/${repositoryCaseId}#comments`}
              onClick={() => setOpen(false)}
            >
              <Button variant="outline" className="w-full text-xs" size="sm">
                {tCommon("actions.viewAll")}
              </Button>
            </Link>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
