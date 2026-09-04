import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { CaseResultStatus } from "@/components/tables/CaseResultStatus";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LinkType, RepositoryCaseSource } from "~/zenstack/models";
import type { RepositoryCaseLink } from "~/zenstack/models";
import {
  Bot,
  Calendar,
  CircleSlash2,
  Link2,
  ListChecks,
  Plus,
  Trash,
  X,
} from "lucide-react";
import type { Session } from "next-auth";
import { useTranslations } from "next-intl";
import React, { useMemo, useState } from "react";
import { z } from "zod/v4";
import { useLatestTestResults } from "~/hooks/useLatestTestResults";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";
import { DateFormatter } from "./DateFormatter";
import { UserNameCell } from "./tables/UserNameCell";

interface LinkedCasesPanelProps {
  caseId: number;
  canManageLinks: boolean;
  projectId?: number;
  session: Session | null | undefined;
}

// Define a type for the case option for clarity
interface CaseOption {
  id: number;
  name: string;
  source: RepositoryCaseSource;
  // Add other properties if your fetchOptions returns more and they are needed
}

/** The linked case as this panel selects it — display fields only. Results are
 *  fetched separately, from the server's own "latest result" definition. */
interface LinkedCase {
  id: number;
  name: string;
  source: RepositoryCaseSource;
  isDeleted?: boolean;
  automated?: boolean;
  hasParameters?: boolean;
  projectId?: number;
}

// Zod schema for add link form
const addLinkSchema = z.object({
  selectedCaseId: z
    .int({
      error: (issue) =>
        issue.input === undefined
          ? "Please select a test case."
          : "Please select a test case.",
    })
    .positive(),
  selectedType: z.enum(LinkType, {
    error: (issue) =>
      issue.input === undefined
        ? "Please select a link type."
        : "Please select a link type.",
  }),
});

const LinkedCasesPanel: React.FC<LinkedCasesPanelProps> = ({
  caseId,
  canManageLinks,
  projectId,
  session,
}) => {
  const tLinkedCases = useTranslations("linkedCases");
  const tGlobal = useTranslations();

  // Fetch all links where this case is caseA or caseB
  const { data: links, refetch } = useClientQueries(
    schema
  ).repositoryCaseLink.useFindMany({
    where: {
      OR: [
        { caseAId: caseId, isDeleted: false },
        { caseBId: caseId, isDeleted: false },
      ],
    },
    include: {
      caseA: {
        select: {
          id: true,
          name: true,
          source: true,
          isDeleted: true,
          automated: true,
          hasParameters: true,
        },
      },
      caseB: {
        select: {
          id: true,
          name: true,
          source: true,
          isDeleted: true,
          automated: true,
          hasParameters: true,
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // For Add Link Modal
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { mutateAsync: upsertLink } =
    useClientQueries(schema).repositoryCaseLink.useUpsert();
  const { mutateAsync: updateLink } =
    useClientQueries(schema).repositoryCaseLink.useUpdate();

  // Compute all linked case IDs to prevent circular/self-link
  const linkedCaseIds = useMemo(() => {
    if (!links) return new Set<number>();
    return new Set(
      links.map((link: any) =>
        link.caseAId === caseId ? link.caseBId : link.caseAId
      )
    );
  }, [links, caseId]);

  const linkedCaseIdList = useMemo(
    () => Array.from(linkedCaseIds),
    [linkedCaseIds]
  );

  // "Latest result" is answered by the server, by the same query behind the
  // repository list's Latest Results column — so a case's status reads the
  // same here as it does one click away, instead of this panel deriving its
  // own answer from a pair of raw result relations.
  const latestResultsByCase = useLatestTestResults(linkedCaseIdList, 1);

  // Async fetch for test cases
  const fetchTestCases = async (
    query: string,
    page: number,
    pageSize: number
  ) => {
    const where = {
      isDeleted: false,
      id:
        linkedCaseIds.size > 0
          ? { notIn: [caseId, ...Array.from(linkedCaseIds)] }
          : { not: caseId },
      ...(projectId ? { projectId } : {}),
      ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
    };
    const params = {
      where,
      orderBy: { name: "asc" },
      skip: page * pageSize,
      take: pageSize,
    };
    const url = `/api/model/RepositoryCases/findMany?q=${encodeURIComponent(JSON.stringify(params))}`;
    const res = await fetch(url);
    const data = await res.json();
    const results = Array.isArray(data.data) ? data.data : [];

    // Fetch total count
    const countUrl = `/api/model/RepositoryCases/count?q=${encodeURIComponent(JSON.stringify({ where }))}`;
    const countRes = await fetch(countUrl);
    const countData = await countRes.json();
    const total = countData.data ?? 0;

    return { results, total };
  };

  // Helper to get the other case in a link
  const getOtherCase = (link: any) =>
    link.caseAId === caseId ? link.caseB : link.caseA;

  // Helper to get the direction of the link
  const _getLinkDirection = (link: any) =>
    link.caseAId === caseId ? "outgoing" : "incoming";

  // State to control which popover is open for link removal
  const [openPopoverLinkId, setOpenPopoverLinkId] = useState<number | null>(
    null
  );

  // Add Link handler (upsert)
  // Validates inputs and creates the link. Returns an error message string
  // on failure (for the dialog to display) or null on success.
  const handleAddLink = async (
    inputCase: CaseOption | null,
    inputType: LinkType | null
  ): Promise<string | null> => {
    // Zod validation
    const result = addLinkSchema.safeParse({
      selectedCaseId: inputCase?.id,
      selectedType: inputType as LinkType,
    });
    if (!result.success) {
      return result.error.issues[0]?.message || tLinkedCases("failedToCreate");
    }
    const { selectedCaseId: validCaseId, selectedType: validType } =
      result.data;
    if (validCaseId === caseId) {
      return tLinkedCases("cannotLinkSelf");
    }
    // Prevent circular: check if selectedCaseId links back to this case
    const selectedCaseLinks = links?.filter(
      (l: any) => l.caseAId === validCaseId || l.caseBId === validCaseId
    );
    if (
      selectedCaseLinks?.some(
        (l: any) => l.caseAId === caseId || l.caseBId === caseId
      )
    ) {
      return tLinkedCases("circularLink");
    }
    try {
      await upsertLink({
        where: {
          caseAId_caseBId_type: {
            caseAId: caseId,
            caseBId: validCaseId,
            type: validType,
          },
        },
        update: {
          isDeleted: false,
        },
        create: {
          caseA: { connect: { id: caseId } },
          caseB: { connect: { id: validCaseId } },
          type: validType,
          createdBy: { connect: { id: session?.user.id } },
        },
      });
      setIsModalOpen(false);
      void refetch();
      // --- Trigger forecast update for both cases ---
      void fetch(`/api/forecast/update?caseId=${caseId}`);
      void fetch(`/api/forecast/update?caseId=${validCaseId}`);
      return null;
    } catch (e: any) {
      return e.message || tLinkedCases("failedToCreate");
    }
  };

  // Unlink handler (soft-delete)
  const handleUnlink = async (linkId: number) => {
    try {
      // Find the other case ID for forecast update
      const link = links?.find((l: any) => l.id === linkId);
      const otherCaseId = link
        ? link.caseAId === caseId
          ? link.caseBId
          : link.caseAId
        : null;
      await updateLink({
        where: { id: linkId },
        data: { isDeleted: true },
      });
      setOpenPopoverLinkId(null);
      void refetch();
      // --- Trigger forecast update for both cases ---
      void fetch(`/api/forecast/update?caseId=${caseId}`);
      if (otherCaseId) void fetch(`/api/forecast/update?caseId=${otherCaseId}`);
    } catch {
      // Optionally show error
    }
  };

  return (
    <Card shadow="none">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          {tLinkedCases("title")}
        </CardTitle>
        {canManageLinks && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(true)}
            >
              <Plus className="w-4 h-4" /> {tLinkedCases("addLink")}
            </Button>
            {isModalOpen && (
              <AddLinkDialog
                open={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                fetchTestCases={fetchTestCases}
                onSubmit={handleAddLink}
              />
            )}
          </>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {!links || links.length === 0 ? (
          <div className="text-muted-foreground ms-4 -mt-6 mb-4 text-sm">
            {tLinkedCases("noLinkedCases")}
          </div>
        ) : (
          // Fixed layout, or a long header grows its own column and runs
          // off the card instead of truncating.
          <Table className="table-fixed w-full">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[34%] truncate">
                  {tLinkedCases("testCase")}
                </TableHead>
                <TableHead className="w-[16%] truncate">
                  {tLinkedCases("linkType")}
                </TableHead>
                <TableHead className="w-[16%] truncate">
                  {tLinkedCases("status")}
                </TableHead>
                <TableHead className="w-[13%] truncate">
                  {tLinkedCases("linkedBy")}
                </TableHead>
                <TableHead className="w-[13%] truncate">
                  {tLinkedCases("on")}
                </TableHead>
                <TableHead className="w-[8%] truncate text-end">
                  {tGlobal("common.actions.remove")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links?.map(
                (
                  link: RepositoryCaseLink & {
                    caseA: LinkedCase;
                    caseB: LinkedCase;
                    createdBy: { id: string; name: string };
                  }
                ) => {
                  const otherCase = getOtherCase(link);
                  const otherCaseSource = otherCase.source;
                  const latestResult = latestResultsByCase[otherCase.id]?.[0];
                  return (
                    <TableRow key={link.id}>
                      <TableCell>
                        <CaseDisplay
                          testCase={{
                            id: otherCase.id,
                            name: otherCase.name,
                            source: otherCaseSource,
                            isDeleted: otherCase.isDeleted,
                            hasParameters: (otherCase as any).hasParameters,
                          }}
                          projectId={
                            otherCase.isDeleted
                              ? undefined
                              : projectId || (otherCase as any).projectId
                          }
                          className="font-medium"
                        />
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="max-w-full">
                          <span className="truncate">
                            {tLinkedCases(link.type as LinkType)}
                          </span>
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <CaseResultStatus
                            caseId={otherCase.id}
                            statusName={latestResult?.statusName}
                            statusColor={latestResult?.statusColor}
                            testRunId={latestResult?.testRunId}
                            projectId={projectId ?? otherCase.projectId}
                            className="flex items-center space-x-1 min-w-0"
                            nameClassName="truncate text-xs"
                          />
                          {latestResult && (
                            <span className="ms-1 text-xs text-muted-foreground font-normal flex items-start gap-1">
                              <Calendar className="w-4 h-4 shrink-0" />
                              <DateFormatter
                                date={latestResult.executedAt}
                                formatString={
                                  session?.user.preferences?.dateFormat +
                                  " " +
                                  session?.user.preferences?.timeFormat
                                }
                                timezone={session?.user.preferences?.timezone}
                              />
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="truncate">
                          <UserNameCell userId={link.createdBy?.id} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <DateFormatter
                          date={link.createdAt}
                          formatString={
                            session?.user.preferences?.dateFormat +
                            " " +
                            session?.user.preferences?.timeFormat
                          }
                          timezone={session?.user.preferences?.timezone}
                        />
                      </TableCell>
                      <TableCell className="text-end">
                        {canManageLinks && (
                          <Popover
                            open={openPopoverLinkId === link.id}
                            onOpenChange={(open) =>
                              setOpenPopoverLinkId(open ? link.id : null)
                            }
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={tGlobal("common.actions.remove")}
                                onClick={() => setOpenPopoverLinkId(link.id)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-fit" side="bottom">
                              <div className="mb-2">
                                {tLinkedCases("confirmRemoveLink")}
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  onClick={() => setOpenPopoverLinkId(null)}
                                >
                                  <CircleSlash2 className="w-4 h-4" />
                                  {tGlobal("common.cancel")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  onClick={() => handleUnlink(link.id)}
                                >
                                  <Trash className="w-4 h-4" />
                                  {tGlobal("common.actions.remove")}
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                }
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

interface AddLinkDialogProps {
  open: boolean;
  onClose: () => void;
  fetchTestCases: (
    query: string,
    page: number,
    pageSize: number
  ) => Promise<{ results: any[]; total: number }>;
  onSubmit: (
    selectedCase: CaseOption | null,
    selectedType: LinkType | null
  ) => Promise<string | null>;
}

function AddLinkDialog({
  open,
  onClose,
  fetchTestCases,
  onSubmit,
}: AddLinkDialogProps) {
  const tLinkedCases = useTranslations("linkedCases");
  const [selectedCase, setSelectedCase] = useState<CaseOption | null>(null);
  const [selectedType, setSelectedType] = useState<LinkType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    const errorMessage = await onSubmit(selectedCase, selectedType);
    if (errorMessage) {
      setError(errorMessage);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tLinkedCases("addLinkedTestCase")}</DialogTitle>
          <DialogDescription className="sr-only">
            {tLinkedCases("addLinkedTestCase")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="block mb-1 font-medium">
              {tLinkedCases("testCase")}
            </label>
            <AsyncCombobox
              value={selectedCase}
              onValueChange={(option) =>
                setSelectedCase(option as CaseOption | null)
              }
              fetchOptions={fetchTestCases}
              dropdownClassName="p-0 min-w-[500px] max-w-[900px]"
              pageSize={10}
              renderOption={(option: any) => (
                <CaseDisplay
                  id={option.id}
                  name={option.name}
                  source={option.source}
                  automated={option.automated}
                  hasParameters={option.hasParameters}
                  size="large"
                />
              )}
              getOptionValue={(option: any) => option.id}
              placeholder={tLinkedCases("testCase")}
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
          </div>
          <div>
            <label className="block mb-1 font-medium">
              {tLinkedCases("linkType")}
            </label>
            <Select
              value={selectedType || ""}
              onValueChange={(val) => setSelectedType(val as LinkType)}
            >
              <SelectTrigger>
                <SelectValue placeholder={tLinkedCases("linkType")} />
              </SelectTrigger>
              <SelectContent>
                {Object.values(LinkType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {tLinkedCases(type as LinkType)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <div className="text-destructive text-sm">{error}</div>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit}>{tLinkedCases("addLink")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LinkedCasesPanel;
