"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Bot, Link2, ListChecks, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { ProjectNameDisplay } from "@/components/search/ProjectNameDisplay";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { AsyncCombobox } from "@/components/ui/async-combobox";
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
import { useRequirementCaseLinks } from "~/hooks/useRequirementCaseLinks";
import { invalidateRequirementCoverage } from "~/hooks/useRequirementCoverage";
import { invalidateRequirementCoveringCases } from "~/hooks/useRequirementCoveringCases";
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

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [openUnlinkId, setOpenUnlinkId] = useState<number | null>(null);

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
                return (
                  // No numeric id on the join row (composite caseId/issueId
                  // primary key) -- key on the pair, not a nonexistent link id.
                  <TableRow key={`${requirementId}-${row.id}`}>
                    <TableCell>
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
