"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Link2, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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
  externalKey: string | null;
  externalUrl: string | null;
}

interface ReferenceRow {
  requirementId: number;
  referencedIssueId: number;
  referencedIssue: ReferencedIssueRow;
}

/**
 * A synced requirement's `externalUrl` is tracker-provided and some sync
 * paths write it through the raw db client, which bypasses the schema's
 * `@url` validation — so only treat http(s) URLs as linkable (never
 * `javascript:` etc.) and open without an opener reference to prevent
 * reverse tab-nabbing. Copied from RequirementProvenanceBadge.tsx's own
 * identical guard (that file does not export it).
 */
const SAFE_EXTERNAL_URL_RE = /^https?:\/\//i;

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
          externalKey: true,
          externalUrl: true,
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
        void refetch();
      } else {
        toast.error(t("attachFailed"));
      }
    } catch {
      toast.error(t("attachFailed"));
    } finally {
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columnReference")}</TableHead>
                <TableHead>{t("columnStatus")}</TableHead>
                <TableHead className="w-[60px] text-end">
                  {tGlobal("common.actions.remove")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const issue = row.referencedIssue;
                const label = `${issue.externalKey || issue.name}: ${issue.title}`;
                const isSafeExternalLink =
                  Boolean(issue.externalUrl) &&
                  SAFE_EXTERNAL_URL_RE.test(issue.externalUrl!);

                return (
                  <TableRow key={`${requirementId}-${row.referencedIssueId}`}>
                    <TableCell className="min-w-0">
                      {isSafeExternalLink ? (
                        <a
                          href={issue.externalUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate font-medium min-w-0 hover:text-inherit"
                          title={label}
                          data-testid={`requirement-reference-link-${row.referencedIssueId}`}
                        >
                          {label}
                        </a>
                      ) : (
                        <Link
                          href={`/projects/issues/${projectId}?issueId=${row.referencedIssueId}`}
                          className="block truncate font-medium min-w-0"
                          title={label}
                          data-testid={`requirement-reference-link-${row.referencedIssueId}`}
                        >
                          {label}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <IssueStatusDisplay status={issue.status} />
                    </TableCell>
                    <TableCell className="w-[60px] text-end">
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
            </TableBody>
          </Table>
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
