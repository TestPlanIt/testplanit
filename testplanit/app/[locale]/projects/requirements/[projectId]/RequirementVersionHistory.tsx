"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import LoadingSpinner from "@/components/LoadingSpinner";
import { DateFormatter } from "@/components/DateFormatter";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import { diffWords } from "~/utils/wordDiff";
import { schema } from "~/zenstack/schema";

/**
 * A requirement's content history — the `IssueVersions` rows the
 * tpl_issue_version_capture trigger writes on every title/description/note
 * change. Each expanded version renders a word diff against the version
 * before it, so "what did this requirement say at release N and what
 * changed since" is answerable without leaving the panel.
 *
 * Rows exist only from the first content change onward (the trigger
 * backfills version 1 with the pre-change text at that moment), so a
 * never-edited requirement legitimately has no history — that renders as
 * an explanatory empty state, not an error.
 */

interface VersionRow {
  id: number;
  version: number;
  title: string;
  description: string | null;
  note: unknown;
  changedById: string | null;
  changedAt: Date | string;
}

/** Plain-text projection for diffing: the note is Tiptap JSON, projected
 * through the shared markdown converter; title/description are plain. */
function noteText(note: unknown): string {
  if (note == null) return "";
  try {
    return tiptapToMarkdown(note).trim();
  } catch {
    return "";
  }
}

function DiffText({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffWords(before, after), [before, after]);
  return (
    <div className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 text-sm">
      {parts.map((part, index) => (
        <Fragment key={index}>
          {part.added ? (
            <ins className="rounded-sm bg-green-100 px-0.5 no-underline dark:bg-green-950">
              {part.value}
            </ins>
          ) : part.removed ? (
            <del className="rounded-sm bg-red-100 px-0.5 dark:bg-red-950">
              {part.value}
            </del>
          ) : (
            part.value
          )}
        </Fragment>
      ))}
    </div>
  );
}

function FieldDiff({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  if (before === after) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <DiffText before={before} after={after} />
    </div>
  );
}

export function RequirementVersionHistory({
  requirementId,
}: {
  requirementId: number;
}) {
  const t = useTranslations("requirements.history");
  const tCommon = useTranslations("common");
  const tDetail = useTranslations("requirements.detail");
  const { data: session } = useSession();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data: versions, isLoading } = useClientQueries(
    schema
  ).issueVersions.useFindMany(
    {
      where: { issueId: requirementId },
      orderBy: { version: "desc" },
    },
    { enabled: Number.isFinite(requirementId) }
  );

  const rows = (versions ?? []) as VersionRow[];
  const byVersion = useMemo(
    () => new Map(rows.map((row) => [row.version, row])),
    [rows]
  );

  const preferences = session?.user?.preferences as
    | { dateFormat?: string; timeFormat?: string; timezone?: string }
    | null
    | undefined;
  const dateTimeFormat = preferences?.dateFormat
    ? `${preferences.dateFormat} ${preferences.timeFormat || "HH:mm"}`
    : undefined;

  const toggle = (version: number) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(version)) {
        next.delete(version);
      } else {
        next.add(version);
      }
      return next;
    });
  };

  return (
    <Card shadow="none" data-testid="requirement-version-history">
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-base">
          <History className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSpinner className="py-4" />
        ) : rows.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="requirement-version-history-empty"
          >
            {t("empty")}
          </div>
        ) : (
          <ul className="space-y-1">
            {rows.map((row) => {
              const previous = byVersion.get(row.version - 1);
              const isExpanded = expanded.has(row.version);
              const isLatest = row.version === rows[0].version;
              return (
                <li
                  key={row.id}
                  className="rounded-md border"
                  data-testid={`requirement-version-${row.version}`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(row.version)}
                    className="flex w-full items-center gap-2 p-2 text-start text-sm"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                    <span className="font-medium">
                      {t("versionLabel", { version: row.version })}
                    </span>
                    {isLatest && (
                      <Badge
                        variant="outline"
                        className="px-1 py-0 text-[10px]"
                      >
                        {t("currentBadge")}
                      </Badge>
                    )}
                    <span className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                      {row.changedById ? (
                        <UserNameCell userId={row.changedById} />
                      ) : (
                        <span>{t("bySync")}</span>
                      )}
                      <DateFormatter
                        date={row.changedAt}
                        formatString={dateTimeFormat}
                        timezone={preferences?.timezone}
                      />
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="space-y-3 border-t p-3">
                      {previous ? (
                        <>
                          <FieldDiff
                            label={tCommon("fields.title")}
                            before={previous.title}
                            after={row.title}
                          />
                          <FieldDiff
                            label={tDetail("documentation")}
                            before={previous.description ?? ""}
                            after={row.description ?? ""}
                          />
                          <FieldDiff
                            label={tCommon("fields.note")}
                            before={noteText(previous.note)}
                            after={noteText(row.note)}
                          />
                        </>
                      ) : (
                        // Version 1 has nothing before it: show the text as
                        // it stood, not a diff against nothing.
                        <>
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-muted-foreground">
                              {tCommon("fields.title")}
                            </div>
                            <div className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 text-sm">
                              {row.title}
                            </div>
                          </div>
                          {row.description ? (
                            <div className="space-y-1">
                              <div className="text-xs font-medium text-muted-foreground">
                                {tDetail("documentation")}
                              </div>
                              <div className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 text-sm">
                                {row.description}
                              </div>
                            </div>
                          ) : null}
                          {noteText(row.note) ? (
                            <div className="space-y-1">
                              <div className="text-xs font-medium text-muted-foreground">
                                {tCommon("fields.note")}
                              </div>
                              <div className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2 text-sm">
                                {noteText(row.note)}
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default RequirementVersionHistory;
