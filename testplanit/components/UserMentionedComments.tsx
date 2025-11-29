"use client";

import { useEffect, useState, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { MessageSquare, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { SessionNameDisplay } from "@/components/SessionNameDisplay";
import { PaginationComponent } from "@/components/tables/Pagination";
import { PaginationInfo } from "@/components/tables/PaginationControls";
import { createMentionExtension } from "~/lib/tiptap/mentionExtension";
import { useFindManyCommentMention, useCountCommentMention } from "~/lib/hooks";
import { Link } from "~/lib/navigation";

interface UserMentionedCommentsProps {
  userId: string;
}

interface CommentDisplayProps {
  comment: {
    id: string;
    content: any; // JsonValue from database, will be converted to JSONContent
    createdAt: Date;
    isEdited: boolean;
    projectId: number;
    creator: {
      id: string;
      name: string | null;
      email: string;
      image: string | null;
    };
    repositoryCaseId: number | null;
    repositoryCase?: {
      id: number;
      name: string;
    } | null;
    testRunId: number | null;
    testRun?: {
      id: number;
      name: string;
    } | null;
    sessionId: number | null;
    session?: {
      id: number;
      name: string;
    } | null;
    project: {
      id: number;
      name: string;
    };
  };
}

function CommentDisplay({ comment }: CommentDisplayProps) {
  const t = useTranslations("users.profile.mentionedComments");

  const displayEditor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
      }),
      createMentionExtension(comment.projectId),
    ],
    content: comment.content,
    editable: false,
    editorProps: {
      attributes: {
        class: "tiptap text-foreground focus:outline-none break-words",
      },
    },
  });

  useEffect(() => {
    if (displayEditor) {
      displayEditor.commands.setContent(comment.content);
    }
  }, [comment.content, displayEditor]);

  // Determine the entity type and details
  let entityLink = "";
  let entityNameDisplay = null;

  if (comment.repositoryCaseId && comment.repositoryCase) {
    entityLink = `/projects/repository/${comment.projectId}/${comment.repositoryCaseId}`;
    entityNameDisplay = (
      <TestCaseNameDisplay
        testCase={{
          id: comment.repositoryCaseId,
          name: comment.repositoryCase.name,
        }}
        showIcon={true}
      />
    );
  } else if (comment.testRunId && comment.testRun) {
    entityLink = `/projects/runs/${comment.projectId}/${comment.testRunId}`;
    entityNameDisplay = (
      <TestRunNameDisplay
        testRun={{
          id: comment.testRunId,
          name: comment.testRun.name,
        }}
        showIcon={true}
      />
    );
  } else if (comment.sessionId && comment.session) {
    entityLink = `/projects/sessions/${comment.projectId}/${comment.sessionId}`;
    entityNameDisplay = (
      <SessionNameDisplay
        session={{
          id: comment.sessionId,
          name: comment.session.name,
        }}
        showIcon={true}
      />
    );
  }

  return (
    <Card className="p-4">
      <div className="space-y-3">
        {/* Header with entity info */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <MessageSquare className="h-8 w-8 text-muted-foreground shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                {entityLink && (
                  <Link
                    href={entityLink}
                    className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                  >
                    {entityNameDisplay}
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1 flex-wrap">
                <span>{t("inProject")}</span>
                <span className="font-medium">{comment.project.name}</span>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Comment metadata */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-sm text-muted-foreground">{t("by")}</span>
            <UserNameCell userId={comment.creator.id} />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(comment.createdAt), {
                addSuffix: true,
              })}
            </span>
            {comment.isEdited && (
              <span className="text-xs text-muted-foreground italic">
                {"("}
                {t("edited")}
                {")"}
              </span>
            )}
          </div>
        </div>

        {/* Comment content */}
        <div
          className="rounded-md border border-border bg-muted/30 p-3"
          style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
        >
          <EditorContent editor={displayEditor} />
        </div>
      </div>
    </Card>
  );
}

export function UserMentionedComments({ userId }: UserMentionedCommentsProps) {
  const t = useTranslations("users.profile.mentionedComments");

  const [currentPage, setCurrentPage] = useState(1); // 1-indexed for PaginationComponent
  const [pageSize, setPageSize] = useState<number | "All">(10);
  const pageSizeOptions: (number | "All")[] = [10, 25, 50, 100];

  const { data: totalCount, isLoading: isCountLoading } =
    useCountCommentMention({
      where: {
        userId: userId,
        comment: {
          isDeleted: false,
        },
      },
    });

  // Calculate numeric page size for queries
  const numericPageSize = pageSize === "All" ? (totalCount ?? 1000) : pageSize;

  const { data: mentions, isLoading: isMentionsLoading } =
    useFindManyCommentMention({
      where: {
        userId: userId,
        comment: {
          isDeleted: false,
        },
      },
      include: {
        comment: {
          include: {
            creator: true,
            project: true,
            repositoryCase: true,
            testRun: true,
            session: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip:
        pageSize === "All" ? undefined : (currentPage - 1) * numericPageSize,
      take: pageSize === "All" ? undefined : numericPageSize,
    });

  const isLoading = isCountLoading || isMentionsLoading;
  const totalPages = useMemo(
    () =>
      pageSize === "All"
        ? 1
        : totalCount
          ? Math.ceil(totalCount / numericPageSize)
          : 0,
    [totalCount, pageSize, numericPageSize]
  );

  const handlePageSizeChange = (newSize: number | "All") => {
    setPageSize(newSize);
    setCurrentPage(1); // Reset to first page when changing page size
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-sm text-muted-foreground">{t("loading")}</div>
      </div>
    );
  }

  if (!mentions || mentions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-sm text-muted-foreground">{t("noComments")}</p>
      </div>
    );
  }

  const startIndex =
    pageSize === "All" ? 1 : (currentPage - 1) * numericPageSize + 1;
  const endIndex =
    pageSize === "All"
      ? (totalCount ?? 0)
      : Math.min(currentPage * numericPageSize, totalCount ?? 0);

  return (
    <div className="space-y-4">
      {/* Pagination controls at top */}
      <div className="flex items-center justify-between">
        <div className="shrink-0">
          <PaginationInfo
            startIndex={startIndex}
            endIndex={endIndex}
            totalRows={totalCount ?? 0}
            searchString=""
            pageSize={pageSize}
            pageSizeOptions={pageSizeOptions}
            handlePageSizeChange={handlePageSizeChange}
          />
        </div>
        {totalPages > 1 && pageSize !== "All" && (
          <div className="shrink-0">
            <PaginationComponent
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/* Comments list */}
      {mentions.map((mention) => (
        <CommentDisplay key={mention.id} comment={mention.comment} />
      ))}
    </div>
  );
}
