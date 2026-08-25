"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { AlertTriangle, Bot, Link2, ListChecks, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRequirementCaseLinks } from "~/hooks/useRequirementCaseLinks";
import { invalidateRequirementCoverage } from "~/hooks/useRequirementCoverage";
import {
  invalidateRequirementCoveringCases,
  useRequirementCoveringCases,
} from "~/hooks/useRequirementCoveringCases";
import { isLinkageSuspect } from "~/lib/services/suspectLinkage";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";
import { schema } from "~/zenstack/schema";
import type { RepositoryCaseSource } from "~/zenstack/models";

interface LinkedRequirementCasesPanelProps {
  projectId: string;
  requirementId: number;
}

interface LinkedCaseRow {
  id: number;
  name: string;
  source: RepositoryCaseSource;
  automated?: boolean | null;
  hasParameters?: boolean | null;
  isDeleted: boolean;
  projectId: number;
  project?: { name: string; iconUrl?: string | null } | null;
}

const CASE_SELECT = {
  id: true,
  name: true,
  source: true,
  automated: true,
  hasParameters: true,
  isDeleted: true,
  projectId: true,
  project: { select: { name: true, iconUrl: true } },
} as const;

/**
 * The requirement-side half of LINK-01/02: search, link, and unlink test
 * cases through the existing, unchanged `/api/issues/[issueId]/link` and
 * `/unlink` routes (via `useRequirementCaseLinks`), forked from
 * `LinkedCasesPanel.tsx`. `RepositoryCaseIssue` -- unlike
 * `RepositoryCaseLink` -- has a composite `(caseId, issueId)` primary key
 * and no link-type enum column, so this fork drops the link-type select and
 * keys rows on the composite pair rather than a numeric `id`. Deliberately
 * not gated on `isRequirementLocked` -- linkage is not one of the five
 * locked fields.
 */
export function LinkedRequirementCasesPanel({
  projectId,
  requirementId,
}: LinkedRequirementCasesPanelProps) {
  const t = useTranslations("requirements.linkedCases");
  const tSuspect = useTranslations("requirements.suspect");
  const tGlobal = useTranslations();
  const { link, unlink, isMutating } = useRequirementCaseLinks();
  const queryClient = useQueryClient();
  const projectIdNumber = Number(projectId);

  const { data: linkedCases, refetch } = useClientQueries(
    schema
  ).repositoryCases.useFindMany({
    where: {
      caseIssues: { some: { issueId: requirementId } },
      isDeleted: false,
    },
    select: CASE_SELECT,
    orderBy: { name: "asc" },
  });

  // COV-05's requirement-side input: a single PK identity lookup for this
  // requirement's own content timestamp -- deliberately not one of the
  // listing shapes the role-scope containment gate polices (see this
  // panel's own acceptance criteria for why the distinction matters here).
  const { data: requirementRow } = useClientQueries(schema).issue.useFindUnique(
    {
      where: { id: requirementId },
      select: { contentUpdatedAt: true },
    }
  );

  // Reused from RequirementCoveragePanel.tsx, mounted on this same page with
  // the same arguments -- a TanStack Query cache hit, not a second request.
  // Reduced to a Map of caseId -> lastExecutedAt for DIRECT rows only: only
  // a direct link has a RepositoryCaseIssue row to dismiss a flag on.
  const { data: coveringCasesData } = useRequirementCoveringCases(
    projectIdNumber,
    requirementId
  );
  const directLastExecutedAt = useMemo(() => {
    const map = new Map<number, string | null>();
    for (const row of coveringCasesData?.cases ?? []) {
      if (row.direct) {
        map.set(row.caseId, row.lastExecutedAt);
      }
    }
    return map;
  }, [coveringCasesData]);

  // This requirement's per-linkage dismissal state, reduced to a Map keyed
  // by caseId.
  const { data: dismissals, refetch: refetchDismissals } = useClientQueries(
    schema
  ).repositoryCaseIssue.useFindMany({
    where: { issueId: requirementId },
    select: { caseId: true, suspectDismissedAt: true },
  });
  const dismissalsByCaseId = useMemo(() => {
    const map = new Map<number, Date | string | null>();
    for (const row of dismissals ?? []) {
      map.set(row.caseId, row.suspectDismissedAt ?? null);
    }
    return map;
  }, [dismissals]);

  const dismissSuspectFlag =
    useClientQueries(schema).repositoryCaseIssue.useUpdate();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [openUnlinkId, setOpenUnlinkId] = useState<number | null>(null);
  // Independent of openUnlinkId -- the suspect-dismiss popover and the
  // unlink popover are two separate affordances that can both live in the
  // same row; sharing state would open both at once.
  const [openDismissId, setOpenDismissId] = useState<number | null>(null);

  const linkedCaseIds = useMemo(
    () =>
      new Set(((linkedCases ?? []) as LinkedCaseRow[]).map((row) => row.id)),
    [linkedCases]
  );

  // Plain fetch, never a Server Action -- Server Actions serialize per
  // client and AsyncCombobox's fetchOptions fires on every keystroke.
  // No self-exclusion (a requirement is not a case); no projectId scoping
  // either -- the search intentionally spans every project the viewer can
  // access, matching the join model's own read policy, with the owning
  // project shown per row rather than hidden (T-25-13-02).
  const fetchTestCases = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const where = {
        isDeleted: false,
        ...(linkedCaseIds.size > 0
          ? { id: { notIn: Array.from(linkedCaseIds) } }
          : {}),
        ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
      };
      const params = {
        where,
        orderBy: { name: "asc" },
        skip: page * pageSize,
        take: pageSize,
        select: CASE_SELECT,
      };
      const url = `/api/model/RepositoryCases/findMany?q=${encodeURIComponent(
        JSON.stringify(params)
      )}`;
      const res = await fetch(url);
      const data = await res.json();
      const results = Array.isArray(data.data) ? data.data : [];

      const countUrl = `/api/model/RepositoryCases/count?q=${encodeURIComponent(
        JSON.stringify({ where })
      )}`;
      const countRes = await fetch(countUrl);
      const countData = await countRes.json();
      const total = countData.data ?? 0;

      return { results, total };
    },
    [linkedCaseIds]
  );

  // F5/F9: `useRequirementCaseLinks`' own `invalidateLinkedQueries` predicate
  // only matches keys whose JSON contains "RepositoryCases" or "Issue" --
  // neither ["requirementCoverage", projectId] nor
  // ["requirementCoveringCases", projectId, requirementId] does, so this
  // panel -- the surface where the user directly adds/removes the links
  // coverage is computed FROM -- invalidates both explicitly on every
  // successful link/unlink rather than relying on that shared predicate to
  // grow a case it wasn't written for.
  const invalidateCoverageQueries = useCallback(() => {
    invalidateRequirementCoverage(queryClient, projectIdNumber);
    invalidateRequirementCoveringCases(
      queryClient,
      projectIdNumber,
      requirementId
    );
  }, [queryClient, projectIdNumber, requirementId]);

  const handleLink = async (selectedCase: LinkedCaseRow | null) => {
    if (!selectedCase) return;
    try {
      await link(requirementId, selectedCase.id);
      toast.success(t("linkSuccess"));
      setIsAddOpen(false);
      void refetch();
      invalidateCoverageQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("linkFailed"));
    }
  };

  const handleUnlink = async (caseId: number) => {
    try {
      await unlink(requirementId, caseId);
      toast.success(t("unlinkSuccess"));
      setOpenUnlinkId(null);
      void refetch();
      invalidateCoverageQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unlinkFailed"));
    }
  };

  // Deliberately does NOT call invalidateCoverageQueries -- that helper
  // exists for link/unlink, where the coverage numbers genuinely change; a
  // dismissal changes none. Refetch ONLY this panel's own dismissals query.
  const handleDismissSuspect = async (caseId: number) => {
    try {
      await dismissSuspectFlag.mutateAsync({
        where: { caseId_issueId: { caseId, issueId: requirementId } },
        data: { suspectDismissedAt: new Date() },
      });
      toast.success(tSuspect("dismissSuccess"));
      setOpenDismissId(null);
      void refetchDismissals();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tSuspect("dismissFailed")
      );
    }
  };

  const rows = (linkedCases ?? []) as LinkedCaseRow[];

  return (
    <Card shadow="none" data-testid="requirement-linked-cases">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          {t("title")}
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="requirement-linked-cases-add"
          onClick={() => setIsAddOpen(true)}
        >
          <Plus className="w-4 h-4" /> {t("addLink")}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="text-muted-foreground ms-4 -mt-6 mb-4 text-sm">
            {t("empty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columnCase")}</TableHead>
                <TableHead>{t("columnProject")}</TableHead>
                <TableHead className="w-[60px] text-end">
                  {tGlobal("common.actions.remove")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                // COV-05/D-03: computed, never stored -- composes the
                // requirement's own contentUpdatedAt, this row's direct
                // last-execution value (absent/undefined for an inherited,
                // non-direct covering case, which the predicate then
                // treats as "no badge" by construction), and this row's own
                // dismissal state.
                const isSuspect = isLinkageSuspect({
                  contentUpdatedAt: requirementRow?.contentUpdatedAt,
                  lastExecutedAt: directLastExecutedAt.get(row.id),
                  suspectDismissedAt: dismissalsByCaseId.get(row.id) ?? null,
                });

                return (
                  // No numeric id on the join row (composite caseId/issueId
                  // primary key) -- key on the pair, not a nonexistent link id.
                  <TableRow key={`${requirementId}-${row.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <TestCaseNameDisplay
                          testCase={{
                            id: row.id,
                            name: row.name,
                            source: row.source,
                            isDeleted: row.isDeleted,
                            hasParameters: row.hasParameters ?? undefined,
                          }}
                          projectId={row.projectId}
                          className="font-medium"
                        />
                        {isSuspect && (
                          // Gated on openDismissId, its own state -- never
                          // openUnlinkId, which gates the unrelated remove
                          // popover in this same row.
                          <Popover
                            open={openDismissId === row.id}
                            onOpenChange={(open) =>
                              setOpenDismissId(open ? row.id : null)
                            }
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <PopoverTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    data-testid={`requirement-linked-case-suspect-${row.id}`}
                                    className="gap-2 shrink-0 cursor-pointer border-dashed border-warning bg-warning/15 text-foreground"
                                    onClick={() => setOpenDismissId(row.id)}
                                  >
                                    <AlertTriangle className="h-3 w-3 text-warning" />
                                    {tSuspect("badgeLabel")}
                                  </Badge>
                                </PopoverTrigger>
                              </TooltipTrigger>
                              <TooltipContent>
                                {tSuspect("tooltipRequirementSide")}
                              </TooltipContent>
                            </Tooltip>
                            <PopoverContent className="w-fit" side="bottom">
                              <div className="mb-2">
                                {tSuspect("dismissConfirm")}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => setOpenDismissId(null)}
                                >
                                  {tGlobal("common.cancel")}
                                </Button>
                                <Button
                                  type="button"
                                  disabled={dismissSuspectFlag.isPending}
                                  data-testid={`requirement-linked-case-suspect-confirm-${row.id}`}
                                  onClick={() => handleDismissSuspect(row.id)}
                                >
                                  {tSuspect("dismissAction")}
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* Every row shows its case's OWN project (operator
                          decision 2026-08-25) -- same convention as
                          `RequirementCoveragePanel`'s Project column. */}
                      {row.project?.name && (
                        <ProjectNameDisplay
                          projectName={row.project.name}
                          projectId={row.projectId}
                          iconUrl={row.project.iconUrl}
                          showLink
                          fitContainer
                          className="text-xs text-muted-foreground"
                        />
                      )}
                    </TableCell>
                    <TableCell className="w-[60px] text-end">
                      <Popover
                        open={openUnlinkId === row.id}
                        onOpenChange={(open) =>
                          setOpenUnlinkId(open ? row.id : null)
                        }
                      >
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={tGlobal("common.actions.remove")}
                            data-testid={`requirement-linked-case-remove-${row.id}`}
                            onClick={() => setOpenUnlinkId(row.id)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-fit" side="bottom">
                          <div className="mb-2">{t("unlinkConfirm")}</div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="secondary"
                              onClick={() => setOpenUnlinkId(null)}
                            >
                              {tGlobal("common.cancel")}
                            </Button>
                            <Button
                              type="button"
                              variant="destructive"
                              disabled={isMutating}
                              data-testid={`requirement-linked-case-remove-confirm-${row.id}`}
                              onClick={() => handleUnlink(row.id)}
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
        <AddLinkedCaseDialog
          open={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          fetchTestCases={fetchTestCases}
          onSubmit={handleLink}
          isMutating={isMutating}
        />
      )}
    </Card>
  );
}

interface AddLinkedCaseDialogProps {
  open: boolean;
  onClose: () => void;
  fetchTestCases: (
    query: string,
    page: number,
    pageSize: number
  ) => Promise<{ results: LinkedCaseRow[]; total: number }>;
  onSubmit: (selectedCase: LinkedCaseRow | null) => Promise<void>;
  isMutating: boolean;
}

function AddLinkedCaseDialog({
  open,
  onClose,
  fetchTestCases,
  onSubmit,
  isMutating,
}: AddLinkedCaseDialogProps) {
  const t = useTranslations("requirements.linkedCases");
  const [selectedCase, setSelectedCase] = useState<LinkedCaseRow | null>(null);

  const handleSubmit = async () => {
    await onSubmit(selectedCase);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("addLinkDialogTitle")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("addLinkDialogTitle")}
          </DialogDescription>
        </DialogHeader>
        {/* AsyncCombobox lives inside this Dialog and must not portal its
            menu -- the shared primitive already honors that; nothing here
            overrides it. */}
        <AsyncCombobox
          value={selectedCase}
          onValueChange={(option) =>
            setSelectedCase(option as LinkedCaseRow | null)
          }
          fetchOptions={fetchTestCases}
          dropdownClassName="p-0 min-w-[500px] max-w-[900px]"
          pageSize={10}
          renderOption={(option: LinkedCaseRow) => (
            <CaseDisplay
              id={option.id}
              name={option.name}
              source={option.source}
              automated={option.automated ?? undefined}
              hasParameters={option.hasParameters ?? undefined}
              size="large"
            />
          )}
          getOptionValue={(option: LinkedCaseRow) => option.id}
          placeholder={t("searchPlaceholder")}
          showTotal
          renderTrigger={({ value, defaultContent }) => (
            <Button
              type="button"
              variant="outline"
              className="justify-start text-start w-full"
            >
              {value ? (
                <span className="flex items-center gap-1 overflow-hidden">
                  {isAutomatedCaseSource(value.source) ? (
                    <Bot className="h-4 w-4 shrink-0" />
                  ) : (
                    <ListChecks className="h-4 w-4 shrink-0" />
                  )}
                  <span
                    className="truncate whitespace-nowrap overflow-hidden"
                    style={{ maxWidth: 400 }}
                  >
                    {value.name}
                  </span>
                </span>
              ) : (
                defaultContent
              )}
            </Button>
          )}
        />
        <DialogFooter>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedCase || isMutating}
            data-testid="requirement-linked-cases-submit"
          >
            {t("addLink")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LinkedRequirementCasesPanel;
