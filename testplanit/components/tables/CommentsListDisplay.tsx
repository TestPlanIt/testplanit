"use client";

import React, { useState } from "react";
import { MessageCircle } from "lucide-react";
import { Link } from "~/lib/navigation";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "~/utils";
import { useTranslations } from "next-intl";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useFindManyComment } from "~/lib/hooks";
import { formatDistanceToNow } from "date-fns";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Button } from "@/components/ui/button";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

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
}

const CommentItem: React.FC<CommentItemProps> = ({ comment }) => {
  const displayEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
    ],
    content: comment.content,
    editable: false,
    editorProps: {
      attributes: {
        class: "tiptap text-foreground focus:outline-none text-xs break-words",
      },
    },
  });

  return (
    <div className="space-y-1 pb-3 border-b last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center min-w-0 flex-1">
          <UserNameCell userId={comment.creator.id} hideLink className="text-xs font-medium" />
        </div>
        <span className="text-xs text-muted-foreground shrink-0">
          {formatDistanceToNow(new Date(comment.createdAt), {
            addSuffix: true,
          })}
        </span>
      </div>
      <div className="text-xs text-muted-foreground line-clamp-2">
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
  const { data: comments, isLoading: isLoadingComments } = useFindManyComment(
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
            "gap-1 whitespace-nowrap text-xs"
          )}
        >
          <MessageCircle className="w-4 h-4 shrink-0" />
          <span>{count}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">
              {tCommon("plural.comment", { count })}
            </h4>
          </div>

          {isLoadingComments ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : comments && comments.length > 0 ? (
            <div className="space-y-3 max-h-[300px] overflow-y-auto">
              {comments.map((comment) => (
                <CommentItem key={comment.id} comment={comment} />
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground text-center py-4">
              {tComments("noComments")}
            </div>
          )}

          <div className="pt-2 border-t">
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
