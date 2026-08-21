"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { Link2, ListChecks, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AsyncCombobox } from "@/components/ui/async-combobox";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { RequirementProvenanceBadge } from "@/projects/requirements/[projectId]/RequirementProvenanceBadge";
import { useRequirementCaseLinks } from "~/hooks/useRequirementCaseLinks";
import { REQUIREMENT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";
import { schema } from "~/zenstack/schema";
import type { Issue } from "~/zenstack/models";

interface LinkedRequirementsPanelProps {
  caseId: number;
  projectId?: number;
}

/**
 * LINK-02's case-side direction: the deliberate inverse of
 * `LinkedRequirementCasesPanel.tsx` (25-13). That panel lists `RepositoryCases`
 * rows for a requirement; this one lists `Issue` rows for a case. Both
 * commit exclusively through `useRequirementCaseLinks` (25-13's shared
 * hook), which fixes the direction once -- the requirement's `issueId` is
 * always the path parameter, the case id is always `entityId` -- so this
 * panel only ever calls `link(requirementId, caseId)` / `unlink(requirementId,
 * caseId)` with its own case id and the picked requirement's id.
 *
 * Every query in this file spreads `REQUIREMENT_SCOPE_WHERE`
 * (`lib/services/issueRoleScope.ts`) -- the sole reviewed expression of "is
 * this Issue row a requirement." Phase 23 spent nine plans keeping
 * requirement rows out of defect-oriented pickers and lists; this panel is
 * the deliberate inverse, so an inline predicate here would be both a
 * scoping bug waiting to happen and a containment-gate failure.
 *
 * Deliberately not gated on `isRequirementLocked` -- linkage is not one of
 * the five locked fields, matching `LinkedRequirementCasesPanel.tsx`'s own
 * decision. No coverage number, status pip, or rollup is shown here --
 * that's Phase 26.
 */
export function LinkedRequirementsPanel({
  caseId,
  projectId,
}: LinkedRequirementsPanelProps) {
  const t = useTranslations("requirements.linkedRequirements");
  const tGlobal = useTranslations();
  const { link, unlink, isMutating } = useRequirementCaseLinks();

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

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [openUnlinkId, setOpenUnlinkId] = useState<number | null>(null);

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
        ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
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

  const handleLink = async (selectedRequirement: Issue | null) => {
    if (!selectedRequirement) return;
    try {
      await link(selectedRequirement.id, caseId);
      toast.success(t("linkSuccess"));
      setIsAddOpen(false);
      void refetch();
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
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("unlinkFailed"));
    }
  };

  return (
    <Card shadow="none" data-testid="case-linked-requirements">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          {t("title")}
        </CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="case-linked-requirements-add"
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
                <TableHead>{tGlobal("common.fields.requirements")}</TableHead>
                <TableHead />
                <TableHead className="w-[60px] text-end">
                  {tGlobal("common.actions.remove")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                // RepositoryCaseIssue has no numeric id column (composite
                // caseId/issueId primary key) -- key on the pair, matching
                // LinkedRequirementCasesPanel.tsx's identical convention.
                <TableRow key={`${caseId}-${row.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2 min-w-0">
                      <ListChecks className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <span
                        data-testid={`linked-requirement-name-${row.id}`}
                        className="truncate font-medium"
                        title={row.name}
                      >
                        {row.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RequirementProvenanceBadge
                      requirement={row}
                      projectId={row.projectId ?? projectId ?? 0}
                    />
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
                </TableRow>
              ))}
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
  const [selectedRequirement, setSelectedRequirement] =
    useState<Issue | null>(null);

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
              <ListChecks className="h-4 w-4 shrink-0" />
              {option.name}
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
                  <ListChecks className="h-4 w-4 shrink-0" />
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
