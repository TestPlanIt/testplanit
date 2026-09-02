"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { AlertTriangle, Link2, Plus, X, ClipboardCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
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
import { RequirementProvenanceBadge } from "@/projects/requirements/[projectId]/RequirementProvenanceBadge";
import { useCaseLatestExecution } from "~/hooks/useCaseLatestExecution";
import { useRequirementCaseLinks } from "~/hooks/useRequirementCaseLinks";
import { invalidateRequirementCoverage } from "~/hooks/useRequirementCoverage";
import { invalidateRequirementCoveringCases } from "~/hooks/useRequirementCoveringCases";
import { Link } from "~/lib/navigation";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { isLinkageSuspect } from "~/lib/services/suspectLinkage";
import { formatIssueDisplayText } from "~/utils/issueDisplayText";
import { IssueTypeIcon } from "~/utils/issueTypeIcons";
import { schema } from "~/zenstack/schema";
import type { Issue } from "~/zenstack/models";

interface LinkedRequirementsPanelProps {
  caseId: number;
  projectId?: number;
  readOnly?: boolean;
}

export function LinkedRequirementsPanel({
  caseId,
  projectId,
  readOnly = false,
}: LinkedRequirementsPanelProps) {
  const t = useTranslations("requirements.linkedRequirements");
  const tSuspect = useTranslations("requirements.suspect");
  const tGlobal = useTranslations();
  const { link, unlink, isMutating, dismissSuspect, isDismissing } =
    useRequirementCaseLinks();
  const queryClient = useQueryClient();

  const { data: linkedRequirements, refetch } = useClientQueries(
    schema
  ).issue.useFindMany({
    where: {
      caseIssues: { some: { caseId } },
      isDeleted: false,
      // Spread, never inline -- issueRoleScope.ts's own doc comment warns
      // this is not an access-control boundary, and this repo's structural
      // containment gate reviews every raw predicate that skips it.
      ...REQUIREMENT_SCOPE_WHERE,
    },
    orderBy: { name: "asc" },
  });

  // COV-05's per-linkage dismissal state, reduced to a Map keyed by the
  // requirement's issueId -- every row in this panel is a requirement
  // linked to the SAME case, so `caseId` is the only where-clause needed.
  const { data: dismissals, refetch: refetchDismissals } = useClientQueries(
    schema
  ).repositoryCaseIssue.useFindMany({
    where: { caseId },
    select: { issueId: true, suspectDismissedAt: true },
  });

  const dismissalsByIssueId = useMemo(() => {
    const map = new Map<number, Date | string | null>();
    for (const row of dismissals ?? []) {
      map.set(row.issueId, row.suspectDismissedAt ?? null);
    }
    return map;
  }, [dismissals]);

  // This case's own latest execution -- one value, invariant across every
  // row in this panel, since every row is a requirement linked to the SAME
  // case (unlike the requirement-side panel, where each row is a different
  // case).
  const { data: caseLatestExecution } = useCaseLatestExecution(caseId);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [openUnlinkId, setOpenUnlinkId] = useState<number | null>(null);
  // Independent of openUnlinkId -- the suspect-dismiss popover and the
  // unlink popover are two separate affordances that can both live in the
  // same row; sharing state would open both at once.
  const [openDismissId, setOpenDismissId] = useState<number | null>(null);

  const rows = (linkedRequirements ?? []) as Issue[];

  const linkedRequirementIds = useMemo(
    () => new Set(rows.map((row) => row.id)),
    [rows]
  );

  // Plain fetch, never a Server Action -- Server Actions serialize per
  // client and AsyncCombobox's fetchOptions fires on every keystroke.
  // Scoped to `projectId` when the caller provides one (the case's own
  // project), unlike LinkedRequirementCasesPanel.tsx's deliberately
  // unscoped case search.
  const fetchRequirements = useCallback(
    async (query: string, page: number, pageSize: number) => {
      const where = {
        isDeleted: false,
        ...REQUIREMENT_SCOPE_WHERE,
        ...(linkedRequirementIds.size > 0
          ? { id: { notIn: Array.from(linkedRequirementIds) } }
          : {}),
        ...(projectId ? { projectId } : {}),
        // The rows render "KEY: Title", so the search must match either half
        // -- name alone would miss a synced requirement's human-readable
        // summary (its name is just the tracker key).
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { title: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const params = {
        where,
        orderBy: { name: "asc" },
        skip: page * pageSize,
        take: pageSize,
      };
      const url = `/api/model/Issue/findMany?q=${encodeURIComponent(
        JSON.stringify(params)
      )}`;
      const res = await fetch(url);
      const data = await res.json();
      const results = Array.isArray(data.data) ? data.data : [];

      const countUrl = `/api/model/Issue/count?q=${encodeURIComponent(
        JSON.stringify({ where })
      )}`;
      const countRes = await fetch(countUrl);
      const countData = await countRes.json();
      const total = countData.data ?? 0;

      return { results, total };
    },
    [linkedRequirementIds, projectId]
  );

  // WR-04 (27.1-05): `useRequirementCaseLinks`' own `invalidateLinkedQueries`
  // predicate only matches keys whose JSON contains "RepositoryCases" or
  // "Issue" -- neither ["requirementCoverage", projectId] nor
  // ["requirementCoveringCases", projectId, requirementId] does, so this
  // panel -- the case-side surface where the user directly adds/removes the
  // links coverage is computed FROM -- invalidates both explicitly, mirroring
  // LinkedRequirementCasesPanel.tsx's identical helper. Takes the linked
  // REQUIREMENT's own projectId, never this panel's `projectId` prop (the
  // case's project) -- coverage is computed per requirement project, and a
  // requirement's projectId is nullable, so a null value short-circuits
  // rather than invalidating with `undefined`.
  const invalidateCoverageQueries = useCallback(
    (
      requirementProjectId: number | null | undefined,
      requirementId: number
    ) => {
      if (typeof requirementProjectId !== "number") return;
      invalidateRequirementCoverage(queryClient, requirementProjectId);
      invalidateRequirementCoveringCases(
        queryClient,
        requirementProjectId,
        requirementId
      );
    },
    [queryClient]
  );

  const handleLink = async (selectedRequirement: Issue | null) => {
    if (!selectedRequirement) return;
    try {
      await link(selectedRequirement.id, caseId);
      toast.success(t("linkSuccess"));
      setIsAddOpen(false);
      void refetch();
      invalidateCoverageQueries(
        selectedRequirement.projectId,
        selectedRequirement.id
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("linkFailed"));
    }
  };

  const handleUnlink = async (requirementId: number) => {
    try {
      await unlink(requirementId, caseId);
      toast.success(t("unlinkSuccess"));
      setOpenUnlinkId(null);
      void refetch();
      invalidateCoverageQueries(
        rows.find((row) => row.id === requirementId)?.projectId,
        requirementId
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unlinkFailed"));
    }
  };

  // A dismissal changes no coverage number -- refetch ONLY this panel's own
  // dismissals query. Do NOT invalidate the requirement coverage rollup or
  // the covering-cases drill-down here; that would contradict this phase's
  // non-interference posture (COV-05's dismissal is data-shape-inert to
  // coverage by design). WR-02 (27.1-05): posts through the shared hook's
  // server-clock dismissal route rather than stamping `new Date()` in the
  // browser -- the value it is compared against (contentUpdatedAt) is
  // trigger-stamped, so only a server-clock timestamp on this side of the
  // comparison can agree with it.
  const handleDismissSuspect = async (requirementId: number) => {
    try {
      await dismissSuspect(requirementId, caseId);
      toast.success(tSuspect("dismissSuccess"));
      setOpenDismissId(null);
      void refetchDismissals();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : tSuspect("dismissFailed")
      );
    }
  };

  // Requirements are opt-in per project, so a read-only empty card would be
  // permanent furniture on every run. The editable surface keeps its empty
  // state, which is what tells an author the panel can be filled.
  if (readOnly && rows.length === 0) {
    return null;
  }

  return (
    <Card shadow="none" data-testid="case-linked-requirements">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          {t("title")}
        </CardTitle>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="case-linked-requirements-add"
            onClick={() => setIsAddOpen(true)}
          >
            <Plus className="w-4 h-4" /> {t("addLink")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="text-muted-foreground ms-4 -mt-6 mb-4 text-sm">
            {t("empty")}
          </div>
        ) : (
          // Fixed layout, or the name cell grows to its content and the
          // truncate below never engages.
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="truncate">
                  {tGlobal("common.fields.requirements")}
                </TableHead>
                <TableHead className="w-[150px]" />
                {!readOnly && (
                  <TableHead className="w-[90px] truncate text-end">
                    {tGlobal("common.actions.remove")}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                // COV-05/D-03: computed, never stored -- composes this
                // row's own contentUpdatedAt (already present, since the
                // issue.useFindMany query above has no `select` clause),
                // the case's single latest-execution value, and this row's
                // own dismissal state.
                const isSuspect = isLinkageSuspect({
                  contentUpdatedAt: row.contentUpdatedAt,
                  lastExecutedAt: caseLatestExecution?.lastExecutedAt,
                  suspectDismissedAt: dismissalsByIssueId.get(row.id) ?? null,
                });

                return (
                  // RepositoryCaseIssue has no numeric id column (composite
                  // caseId/issueId primary key) -- key on the pair, matching
                  // LinkedRequirementCasesPanel.tsx's identical convention.
                  <TableRow key={`${caseId}-${row.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <IssueTypeIcon
                          fallbackIcon={ClipboardCheck}
                          issueTypeName={row.issueTypeName}
                          iconUrl={row.issueTypeIconUrl}
                          className="h-4 w-4 shrink-0"
                        />
                        {/* The project-less permalink, not a project-scoped
                            URL: a linked requirement need not live in the
                            project whose page this panel is rendered on, and
                            the resolver already owns that lookup. */}
                        <Link
                          href={`/requirement/${row.id}`}
                          data-testid={`linked-requirement-name-${row.id}`}
                          className="truncate font-medium hover:underline"
                          title={formatIssueDisplayText(row)}
                        >
                          {formatIssueDisplayText(row)}
                        </Link>
                        {isSuspect && readOnly && (
                          // The signal without the action: dismissing is a
                          // review decision, and this surface has no review.
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                data-testid={`case-linked-requirement-suspect-${row.id}`}
                                className="gap-2 shrink-0 border-dashed border-warning bg-warning/15 text-foreground"
                              >
                                <AlertTriangle className="h-3 w-3 text-warning" />
                                {tSuspect("badgeLabel")}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {tSuspect("tooltipCaseSide")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {isSuspect && !readOnly && (
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
                                    data-testid={`case-linked-requirement-suspect-${row.id}`}
                                    className="gap-2 shrink-0 cursor-pointer border-dashed border-warning bg-warning/15 text-foreground"
                                    onClick={() => setOpenDismissId(row.id)}
                                  >
                                    <AlertTriangle className="h-3 w-3 text-warning" />
                                    {tSuspect("badgeLabel")}
                                  </Badge>
                                </PopoverTrigger>
                              </TooltipTrigger>
                              <TooltipContent>
                                {tSuspect("tooltipCaseSide")}
                              </TooltipContent>
                            </Tooltip>
                            <PopoverContent className="w-fit" side="bottom">
                              <div className="mb-2">
                                {tSuspect("dismissConfirm")}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  onClick={() => setOpenDismissId(null)}
                                >
                                  {tGlobal("common.cancel")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={isDismissing}
                                  data-testid={`case-linked-requirement-suspect-confirm-${row.id}`}
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
                      <RequirementProvenanceBadge
                        requirement={row}
                        projectId={row.projectId ?? projectId ?? 0}
                      />
                    </TableCell>
                    {!readOnly && (
                      <TableCell className="w-[90px] text-end">
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
                              data-testid={`case-linked-requirement-remove-${row.id}`}
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
                                data-testid={`case-linked-requirement-remove-confirm-${row.id}`}
                                onClick={() => handleUnlink(row.id)}
                              >
                                {tGlobal("common.actions.remove")}
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {isAddOpen && (
        <AddLinkedRequirementDialog
          open={isAddOpen}
          onClose={() => setIsAddOpen(false)}
          fetchRequirements={fetchRequirements}
          onSubmit={handleLink}
          isMutating={isMutating}
        />
      )}
    </Card>
  );
}

interface AddLinkedRequirementDialogProps {
  open: boolean;
  onClose: () => void;
  fetchRequirements: (
    query: string,
    page: number,
    pageSize: number
  ) => Promise<{ results: Issue[]; total: number }>;
  onSubmit: (selectedRequirement: Issue | null) => Promise<void>;
  isMutating: boolean;
}

function AddLinkedRequirementDialog({
  open,
  onClose,
  fetchRequirements,
  onSubmit,
  isMutating,
}: AddLinkedRequirementDialogProps) {
  const t = useTranslations("requirements.linkedRequirements");
  const [selectedRequirement, setSelectedRequirement] = useState<Issue | null>(
    null
  );

  const handleSubmit = async () => {
    await onSubmit(selectedRequirement);
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
          value={selectedRequirement}
          onValueChange={(option) =>
            setSelectedRequirement(option as Issue | null)
          }
          fetchOptions={fetchRequirements}
          dropdownClassName="p-0 min-w-[500px] max-w-[900px]"
          pageSize={10}
          renderOption={(option: Issue) => (
            <span className="flex items-center gap-2">
              <IssueTypeIcon
                fallbackIcon={ClipboardCheck}
                issueTypeName={option.issueTypeName}
                iconUrl={option.issueTypeIconUrl}
                className="h-4 w-4 shrink-0"
              />
              {formatIssueDisplayText(option)}
            </span>
          )}
          getOptionValue={(option: Issue) => option.id}
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
                  <IssueTypeIcon
                    fallbackIcon={ClipboardCheck}
                    issueTypeName={value.issueTypeName}
                    iconUrl={value.issueTypeIconUrl}
                    className="h-4 w-4 shrink-0"
                  />
                  <span
                    className="truncate whitespace-nowrap overflow-hidden"
                    style={{ maxWidth: 400 }}
                  >
                    {formatIssueDisplayText(value)}
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
            disabled={!selectedRequirement || isMutating}
            data-testid="case-linked-requirements-submit"
          >
            {t("addLink")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LinkedRequirementsPanel;
