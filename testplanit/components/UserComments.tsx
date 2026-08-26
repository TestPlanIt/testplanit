"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { MilestoneNameDisplay } from "@/components/MilestoneNameDisplay";
import { SessionNameDisplay } from "@/components/SessionNameDisplay";
import { Filter } from "@/components/tables/Filter";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { formatDistanceToNow } from "date-fns";
import { ExternalLink, MessageSquare } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useVirtualizedInfiniteList } from "~/hooks/useVirtualizedInfiniteList";
import { Link } from "~/lib/navigation";
import { createMentionExtension } from "~/lib/tiptap/mentionExtension";
import { cn } from "~/utils";
import {
  CommentTypeBadge,
  getCommentAccentClasses,
  type CommentType,
  type ReviewRequestStatus,
} from "@/components/comments/CommentTypeBadge";

// Rows fetched per scroll page. Comments carry their full Tiptap JSON body, so
// batch far smaller than the audit log's 1000.
const PAGE_SIZE = 50;

export type CommentScope = "all" | "mentioned" | "authored";

interface UserCommentsProps {
  userId: string;
}

export function buildCommentsWhere(userId: string, scope: CommentScope) {
  switch (scope) {
    case "mentioned":
      return { isDeleted: false, mentionedUsers: { some: { userId } } };
    case "authored":
      return { isDeleted: false, creatorId: userId };
    default:
      return {
        isDeleted: false,
        OR: [{ creatorId: userId }, { mentionedUsers: { some: { userId } } }],
      };
  }
}

/**
 * Flattens a Tiptap document into lowercased searchable text. Mention chips
 * carry the user's display name in `attrs.label` rather than a text node, so
 * they are folded in too — searching a teammate's name finds the comments
 * that @-mention them.
 */
export function commentSearchText(content: unknown): string {
  let doc: unknown = content;
  if (typeof doc === "string") {
    const raw = doc;
    try {
      doc = JSON.parse(raw);
    } catch {
      return raw.toLowerCase();
    }
  }
  const parts: string[] = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== "object") return;
    if (typeof node.text === "string") parts.push(node.text);
    if (typeof node.attrs?.label === "string") parts.push(node.attrs.label);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(doc);
  return parts.join(" ").toLowerCase();
}

interface CommentDisplayProps {
  comment: {
    id: string;
    content: any; // JsonValue from database, will be converted to JSONContent
    createdAt: Date;
    isEdited: boolean;
    projectId: number;
    type?: CommentType;
    reviewRequest?: {
      status: ReviewRequestStatus;
    } | null;
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
      isDeleted?: boolean;
      source?: string;
    } | null;
    testRunId: number | null;
    testRun?: {
      id: number;
      name: string;
      compositionLockedAt?: Date | string | null;
    } | null;
    sessionId: number | null;
    session?: {
      id: number;
      name: string;
    } | null;
    milestoneId: number | null;
    milestone?: {
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
  const tGlobal = useTranslations();

  const commentType: CommentType = comment.type ?? "GENERAL";
  const accentClasses = getCommentAccentClasses(
    commentType,
    comment.reviewRequest?.status
  );

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
    const isDeleted = comment.repositoryCase.isDeleted;
    entityLink = isDeleted
      ? ""
      : `/projects/repository/${comment.projectId}/${comment.repositoryCaseId}`;
    entityNameDisplay = (
      <TestCaseNameDisplay
        testCase={{
          id: comment.repositoryCaseId,
          name: comment.repositoryCase.name,
          isDeleted,
          source: comment.repositoryCase.source,
          hasParameters: (comment.repositoryCase as any).hasParameters,
        }}
        projectId={isDeleted ? undefined : comment.projectId}
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
          compositionLockedAt: comment.testRun.compositionLockedAt,
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
  } else if (comment.milestoneId && comment.milestone) {
    entityLink = `/projects/milestones/${comment.projectId}/${comment.milestoneId}`;
    entityNameDisplay = (
      <MilestoneNameDisplay
        milestone={{
          id: comment.milestoneId,
          name: comment.milestone.name,
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
                <span>
                  {tGlobal("components.notifications.content.inProject")}
                </span>
                <span className="font-medium">{comment.project.name}</span>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Comment metadata */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-sm text-muted-foreground">
              {tGlobal("common.by")}
            </span>
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
                {tGlobal("comments.edited")}
                {")"}
              </span>
            )}
          </div>
        </div>

        {commentType !== "GENERAL" && (
          <div>
            <CommentTypeBadge
              type={commentType}
              reviewStatus={comment.reviewRequest?.status}
            />
          </div>
        )}

        {/* Comment content */}
        <div
          className={cn(
            "rounded-md border border-border bg-muted/30 p-3",
            accentClasses
          )}
          style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
        >
          <EditorContent editor={displayEditor} />
        </div>
      </div>
    </Card>
  );
}

export function UserComments({ userId }: UserCommentsProps) {
  const t = useTranslations("users.profile.myComments");
  const tGlobal = useTranslations();
  const locale = useLocale();
  const [scope, setScope] = useState<CommentScope>("all");
  // Already debounced by the Filter component before it lands here.
  const [searchText, setSearchText] = useState("");

  const whereClause = useMemo(
    () => buildCommentsWhere(userId, scope),
    [userId, scope]
  );

  const baseArgs = {
    where: whereClause,
    include: {
      creator: true,
      project: true,
      repositoryCase: true,
      testRun: true,
      session: true,
      milestone: true,
      reviewRequest: {
        select: {
          status: true,
        },
      },
    },
    // Secondary id sort keeps skip-based pages stable across createdAt ties.
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: PAGE_SIZE,
  };

  const {
    data: pages,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useClientQueries(schema).comment.useInfiniteFindMany(baseArgs, {
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage || lastPage.length < PAGE_SIZE) return undefined;
      return {
        ...baseArgs,
        skip: allPages.flat().length,
      };
    },
    refetchOnWindowFocus: false,
  });

  const { data: totalCount } = useClientQueries(schema).comment.useCount({
    where: whereClause,
  });

  // A comment created between page fetches shifts skip-based pages, which can
  // repeat a row; dedupe by id so React keys stay unique.
  const loadedComments = useMemo(() => {
    const flat = pages?.pages.flat() ?? [];
    const seen = new Set<string>();
    return flat.filter((comment) => {
      if (seen.has(comment.id)) return false;
      seen.add(comment.id);
      return true;
    });
  }, [pages]);

  // The text filter is applied client-side: the comment body is a Tiptap JSON
  // document whose text nodes a server-side filter can't reach. While matches
  // are sparse the list stays short, the sentinel stays visible, and the hook
  // keeps pulling further pages — effectively scanning backwards on demand.
  const normalizedQuery = searchText.trim().toLowerCase();
  const visibleComments = useMemo(() => {
    if (!normalizedQuery) return loadedComments;
    return loadedComments.filter((comment) =>
      commentSearchText(comment.content).includes(normalizedQuery)
    );
  }, [loadedComments, normalizedQuery]);

  const { scrollRef, sentinelRef, virtualItems, totalSize, measureElement } =
    useVirtualizedInfiniteList({
      count: visibleComments.length,
      // Raw loaded rows, not visible matches: a fully filtered-out page must
      // still advance pagination (same contract as the grouped audit rows).
      loadedCount: loadedComments.length,
      estimateSize: 240,
      overscan: 4,
      hasMore: !!hasNextPage,
      isLoading: isLoading || isFetchingNextPage,
      onLoadMore: fetchNextPage,
      boundToViewport: false,
      resetKey: `${scope}|${normalizedQuery}`,
    });

  const isInitialLoading = isLoading && loadedComments.length === 0;
  const scanSettled = !hasNextPage && !isFetchingNextPage && !isLoading;
  const isFiltered = scope !== "all" || !!normalizedQuery;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter
          className="min-w-[220px] flex-1"
          placeholder={t("searchPlaceholder")}
          initialSearchString={searchText}
          onSearchChange={setSearchText}
          dataTestId="user-comments-search"
        />
        <div className="w-[200px]">
          <Label className="sr-only">{t("filterLabel")}</Label>
          <Select
            value={scope}
            onValueChange={(value) => setScope(value as CommentScope)}
          >
            <SelectTrigger data-testid="user-comments-scope-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filterAll")}</SelectItem>
              <SelectItem value="mentioned">{t("filterMentioned")}</SelectItem>
              <SelectItem value="authored">{t("filterAuthored")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {loadedComments.length > 0 && (
          <p className="ms-auto shrink-0 text-xs text-muted-foreground text-end flex items-center gap-1">
            {normalizedQuery
              ? t("matching", {
                  matched: visibleComments.length.toLocaleString(locale),
                  loaded: loadedComments.length.toLocaleString(locale),
                  total: (totalCount ?? loadedComments.length).toLocaleString(
                    locale
                  ),
                })
              : t("showing", {
                  loaded: loadedComments.length.toLocaleString(locale),
                  total: (totalCount ?? loadedComments.length).toLocaleString(
                    locale
                  ),
                })}
          </p>
        )}
      </div>

      {isInitialLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-sm text-muted-foreground">
            {tGlobal("common.loading")}
          </div>
        </div>
      ) : visibleComments.length === 0 && scanSettled ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <p className="text-sm text-muted-foreground">
            {isFiltered ? t("noMatchingComments") : t("noComments")}
          </p>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className="relative max-h-[70vh] overflow-auto"
          data-testid="user-comments-list"
        >
          <div className="relative w-full" style={{ height: totalSize }}>
            {virtualItems.map((vItem) => {
              const comment = visibleComments[vItem.index];
              if (!comment) return null;
              return (
                <div
                  key={comment.id}
                  data-index={vItem.index}
                  ref={measureElement}
                  className="absolute start-0 top-0 w-full pb-4"
                  style={{ transform: `translateY(${vItem.start}px)` }}
                >
                  <CommentDisplay comment={comment} />
                </div>
              );
            })}
          </div>

          {/* Sentinel — when it nears the viewport the hook fetches the next page. */}
          <div
            ref={sentinelRef}
            aria-hidden
            className="h-px w-full"
            data-testid="user-comments-sentinel"
          />

          {isFetchingNextPage && (
            <div
              className="py-3"
              aria-label={tGlobal("common.loading")}
              data-testid="user-comments-loading-more"
            >
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
