"use client";
/* eslint-disable react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer() returns unstable function references by design; React Compiler auto-skips memoization here and the lint rule reports it (same as components/matrix/MatrixGrid.tsx). */

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Link2, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { IssueStatusDisplay } from "@/components/IssueStatusDisplay";
import { RequirementReferenceSearchDialog } from "@/components/issues/requirement-reference-search-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "~/lib/navigation";
import { isSafeExternalUrl } from "~/utils/externalUrl";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";
import { schema } from "~/zenstack/schema";

interface RequirementReferencesPanelProps {
  projectId: number | string;
  requirementId: number;
}

interface ReferencedIssueRow {
  id: number;
  name: string;
  title: string;
  status: string | null;
  externalId: string | null;
  externalKey: string | null;
  externalUrl: string | null;
  externalStatus: string | null;
  issueTypeName: string | null;
  issueTypeIconUrl: string | null;
  integrationId: number | null;
  lastSyncedAt: string | Date | null;
  data: unknown;
  projectId: number;
  integration: { provider: string } | null;
}

interface ReferenceRow {
  requirementId: number;
  referencedIssueId: number;
  referencedIssue: ReferencedIssueRow;
}

/**
 * LINK-03's References card (D-13/D-14/D-15): a dedicated card in
 * RequirementDetailPanel's stack, last after LinkedRequirementCasesPanel.
 * Every reference is a `RequirementIssueReference` join row, queried
 * through its OWN model relation (`referencedIssue`) rather than a raw
 * `.issue.` read — that keeps this file out of the role-scope containment
 * gate's read patterns entirely (a reference may legitimately point at
 * either row kind, D-09/D-10, so REQUIREMENT_SCOPE_WHERE/DEFECT_SCOPE_WHERE
 * would be the wrong tool here even if this file did read Issue directly).
 *
 * Deliberately takes no `isRequirementLocked`/`locked` prop (D-11):
 * references are TestPlanIt-side annotations like `Issue.note`, not one of
 * the five locked fields, so the card works identically on a synced,
 * locked requirement — matching `LinkedRequirementCasesPanel.tsx`'s and
 * `RequirementAttachments.tsx`'s own deliberate absence of a lock check.
 *
 * Refetches only its own query on attach/remove — never the requirement
 * coverage rollup or covering-cases drill-down invalidators
 * LinkedRequirementCasesPanel.tsx calls. A reference changes no coverage
 * number; invalidating those would contradict this phase's non-interference
 * proof.
 */
export function RequirementReferencesPanel({
  projectId,
  requirementId,
}: RequirementReferencesPanelProps) {
  const t = useTranslations("requirements.references");
  const tGlobal = useTranslations();
  const projectIdNumber = Number(projectId);

  const { data: referenceRows, refetch } = useClientQueries(
    schema
  ).requirementIssueReference.useFindMany({
    where: { requirementId },
    include: {
      referencedIssue: {
        select: {
          id: true,
          name: true,
          title: true,
          status: true,
          externalId: true,
          externalKey: true,
          externalUrl: true,
          externalStatus: true,
          issueTypeName: true,
          issueTypeIconUrl: true,
          integrationId: true,
          lastSyncedAt: true,
          data: true,
          projectId: true,
          integration: { select: { provider: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [openRemoveId, setOpenRemoveId] = useState<number | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const rows = useMemo(
    () => (referenceRows ?? []) as unknown as ReferenceRow[],
    [referenceRows]
  );

  // Virtualized to match the two sibling panels on this page.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 45,
    overscan: 12,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  // Seeds the picker's already-linked marker. A picked row can be matched
  // either as an internal id or (for an external pick) by its tracker key
  // — see search-issues-dialog.tsx's own isAlreadyLinked check — so this
  // set carries both forms per row.
  const linkedIssueIds = useMemo(() => {
    const ids: (string | number)[] = [];
    for (const row of rows) {
      ids.push(row.referencedIssueId);
      if (row.referencedIssue?.externalKey) {
        ids.push(row.referencedIssue.externalKey);
      }
    }
    return ids;
  }, [rows]);

  const handleIssuesSelected = async (issues: any[]) => {
    if (issues.length === 0) return;
    setIsMutating(true);
    try {
      const responses = await Promise.all(
        issues.map((issue) =>
          fetch(
            `/api/projects/${projectId}/requirements/${requirementId}/references`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                issue.isExternal
                  ? {
                      external: {
                        externalId: issue.externalId || String(issue.id),
                        key: issue.key,
                        title: issue.title,
                        description: issue.description ?? undefined,
                        status: issue.status ?? undefined,
                        priority: issue.priority ?? undefined,
                        externalUrl: issue.externalUrl || issue.url,
                      },
                    }
                  : { internalIssueId: issue.id }
              ),
            }
          )
        )
      );
      if (responses.every((res) => res.ok)) {
        toast.success(t("attachSuccess"));
      } else {
        toast.error(t("attachFailed"));
      }
    } catch {
      toast.error(t("attachFailed"));
    } finally {
      // Unconditional: a partial failure (or a network throw after some
      // POSTs landed) still attached the successful references, and they
      // must show now rather than on the next remount.
      void refetch();
      setIsMutating(false);
    }
  };

  const handleRemove = async (referencedIssueId: number) => {
    setIsMutating(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/requirements/${requirementId}/references/${referencedIssueId}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        throw new Error("Failed to remove reference");
      }
      toast.success(t("removeSuccess"));
      setOpenRemoveId(null);
      void refetch();
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <Card shadow="none" data-testid="requirement-references">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          {t("title", { count: rows.length })}
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="requirement-references-add"
          onClick={() => setIsAddOpen(true)}
        >
          <Plus className="w-4 h-4" /> {t("addReference")}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="text-muted-foreground ms-4 -mt-6 mb-4 text-sm">
            <div>{t("empty")}</div>
            <div>{t("emptyHint")}</div>
          </div>
        ) : (
          <div ref={scrollRef} className="max-h-[32rem] overflow-auto">
            <Table className="table-fixed w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="truncate">
                    {t("columnReference")}
                  </TableHead>
                  <TableHead className="w-[150px] truncate">
                    {t("columnStatus")}
                  </TableHead>
                  <TableHead className="w-[90px] truncate text-end">
                    {tGlobal("common.actions.remove")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paddingTop > 0 && (
                  <tr aria-hidden style={{ height: paddingTop }} />
                )}
                {virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  const issue = row.referencedIssue;
                  // Not `formatIssueDisplayText`: that gates "KEY: Title" on
                  // `externalUrl`, so an internal reference would show only
                  // its key. A reference is something you identify at a
                  // glance, so both kinds keep the title.
                  const label = `${issue.externalKey || issue.name}: ${issue.title}`;
                  const isSafeExternalLink = isSafeExternalUrl(
                    issue.externalUrl
                  );

                  return (
                    <TableRow
                      key={`${requirementId}-${row.referencedIssueId}`}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                    >
                      <TableCell className="min-w-0">
                        {/* The shared issue PRIMITIVES -- type icon plus
                          `formatIssueDisplayText` -- rather than the
                          IssuesDisplay composite, which owns link semantics
                          this panel cannot use: it renders a non-http href
                          as a link (the XSS this guard blocks) and an http
                          one as plain text. */}
                        {isSafeExternalLink ? (
                          <a
                            href={issue.externalUrl!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 min-w-0 font-medium hover:text-inherit"
                            title={label}
                            data-testid={`requirement-reference-link-${row.referencedIssueId}`}
                          >
                            <IssueTypeIcon
                              issueTypeName={issue.issueTypeName}
                              iconUrl={issue.issueTypeIconUrl}
                              className="h-4 w-4 shrink-0"
                            />
                            <span className="truncate">{label}</span>
                          </a>
                        ) : (
                          <Link
                            // The referenced issue's OWN project, not the
                            // requirement's: the POST route permits
                            // cross-project internal picks, and the issues
                            // page can only resolve the id in its home
                            // project.
                            href={`/projects/issues/${issue.projectId}?issueId=${row.referencedIssueId}`}
                            className="flex items-center gap-1 min-w-0 font-medium"
                            title={label}
                            data-testid={`requirement-reference-link-${row.referencedIssueId}`}
                          >
                            <IssueTypeIcon
                              issueTypeName={issue.issueTypeName}
                              iconUrl={issue.issueTypeIconUrl}
                              className="h-4 w-4 shrink-0"
                            />
                            <span className="truncate">{label}</span>
                          </Link>
                        )}
                      </TableCell>
                      <TableCell>
                        <IssueStatusDisplay status={issue.status} />
                      </TableCell>
                      <TableCell className="w-[90px] text-end">
                        <Popover
                          open={openRemoveId === row.referencedIssueId}
                          onOpenChange={(open) =>
                            setOpenRemoveId(open ? row.referencedIssueId : null)
                          }
                        >
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={tGlobal("common.actions.remove")}
                              data-testid={`requirement-reference-remove-${row.referencedIssueId}`}
                              onClick={() =>
                                setOpenRemoveId(row.referencedIssueId)
                              }
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-fit" side="bottom">
                            <div className="mb-2">{t("removeConfirm")}</div>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setOpenRemoveId(null)}
                              >
                                {tGlobal("common.cancel")}
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                disabled={isMutating}
                                data-testid={`requirement-reference-remove-confirm-${row.referencedIssueId}`}
                                onClick={() =>
                                  handleRemove(row.referencedIssueId)
                                }
                              >
                                {tGlobal("common.actions.remove")}
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr aria-hidden style={{ height: paddingBottom }} />
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {isAddOpen && (
        <RequirementReferenceSearchDialog
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
          projectId={projectIdNumber}
          multiSelect
          onIssuesSelected={handleIssuesSelected}
          linkedIssueIds={linkedIssueIds}
        />
      )}
    </Card>
  );
}

export default RequirementReferencesPanel;
