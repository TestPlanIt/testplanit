import React, { useState, useMemo } from "react";
import {
  useFindManyRepositoryCaseLink,
  useUpsertRepositoryCaseLink,
  useUpdateRepositoryCaseLink,
} from "~/lib/hooks";
import {
  LinkType,
  RepositoryCaseLink,
  RepositoryCaseSource,
} from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { isAutomatedCaseSource } from "~/utils/testResultTypes";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Link } from "~/lib/navigation";
import {
  X,
  Plus,
  Link2,
  Bot,
  ListChecks,
  Trash2,
  CircleSlash2,
  Calendar,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { DateFormatter } from "./DateFormatter";
import type { Session } from "next-auth";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { z } from "zod/v4";
import { UserNameCell } from "./tables/UserNameCell";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { TestCaseNameDisplay } from "@/components/TestCaseNameDisplay";
import { AsyncCombobox } from "@/components/ui/async-combobox";

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
  const { data: links, refetch } = useFindManyRepositoryCaseLink({
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
          testRuns: {
            select: {
              results: {
                orderBy: { executedAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  status: {
                    select: { name: true, color: { select: { value: true } } },
                  },
                  executedAt: true,
                },
              },
            },
          },
          junitResults: {
            orderBy: { executedAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: {
                select: { name: true, color: { select: { value: true } } },
              },
              executedAt: true,
            },
          },
        },
      },
      caseB: {
        select: {
          id: true,
          name: true,
          source: true,
          isDeleted: true,
          testRuns: {
            select: {
              results: {
                orderBy: { executedAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  status: {
                    select: { name: true, color: { select: { value: true } } },
                  },
                  executedAt: true,
                },
              },
            },
          },
          junitResults: {
            orderBy: { executedAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: {
                select: { name: true, color: { select: { value: true } } },
              },
              executedAt: true,
            },
          },
        },
      },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // For Add Link Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCase, setSelectedCase] = useState<CaseOption | null>(null);
  const [selectedType, setSelectedType] = useState<LinkType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { mutateAsync: upsertLink } = useUpsertRepositoryCaseLink();
  const { mutateAsync: updateLink } = useUpdateRepositoryCaseLink();

  // Compute all linked case IDs to prevent circular/self-link
  const linkedCaseIds = useMemo(() => {
    if (!links) return new Set<number>();
    return new Set(
      links.map((link: any) =>
        link.caseAId === caseId ? link.caseBId : link.caseAId
      )
    );
  }, [links, caseId]);

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
  const getLinkDirection = (link: any) =>
    link.caseAId === caseId ? "outgoing" : "incoming";

  // State to control which popover is open for link removal
  const [openPopoverLinkId, setOpenPopoverLinkId] = useState<number | null>(
    null
  );

  // Add Link handler (upsert)
  const handleAddLink = async () => {
    setError(null);
    // Zod validation
    const result = addLinkSchema.safeParse({
      selectedCaseId: selectedCase?.id,
      selectedType: selectedType as LinkType,
    });
    if (!result.success) {
      setError(
        result.error.issues[0]?.message || tLinkedCases("failedToCreate")
      );
      return;
    }
    const { selectedCaseId: validCaseId, selectedType: validType } =
      result.data;
    if (validCaseId === caseId) {
      setError(tLinkedCases("cannotLinkSelf"));
      return;
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
      setError(tLinkedCases("circularLink"));
      return;
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
      setSelectedCase(null);
      setSelectedType(null);
      refetch();
      // --- Trigger forecast update for both cases ---
      fetch(`/api/forecast/update?caseId=${caseId}`);
      fetch(`/api/forecast/update?caseId=${validCaseId}`);
    } catch (e: any) {
      setError(e.message || tLinkedCases("failedToCreate"));
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
      refetch();
      // --- Trigger forecast update for both cases ---
      fetch(`/api/forecast/update?caseId=${caseId}`);
      if (otherCaseId) fetch(`/api/forecast/update?caseId=${otherCaseId}`);
    } catch (e) {
      // Optionally show error
    }
  };

  return (
    <Card shadow="none">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5" />
          {tLinkedCases("title")}
        </CardTitle>
        {canManageLinks && (
          <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Plus className="w-4 h-4 mr-1" /> {tLinkedCases("addLink")}
              </Button>
            </DialogTrigger>
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
                        large={true}
                      />
                    )}
                    getOptionValue={(option: any) => option.id}
                    placeholder={tLinkedCases("testCase")}
                    showTotal
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
                {error && (
                  <div className="text-destructive text-sm">{error}</div>
                )}
              </div>
              <DialogFooter>
                <Button onClick={handleAddLink}>
                  {tLinkedCases("addLink")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {!links || links.length === 0 ? (
          <div className="text-muted-foreground ml-6 -mt-8 mb-4 text-sm">
            {tLinkedCases("noLinkedCases")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[300px]">
                  {tLinkedCases("testCase")}
                </TableHead>
                <TableHead className="w-[180px]">
                  {tLinkedCases("linkType")}
                </TableHead>
                <TableHead className="w-[180px]">
                  {tLinkedCases("status")}
                </TableHead>
                <TableHead className="w-20">
                  {tLinkedCases("linkedBy")}
                </TableHead>
                <TableHead className="w-[180px]">
                  {tLinkedCases("on")}
                </TableHead>
                <TableHead className="w-[60px] text-right">
                  {tGlobal("common.actions.remove")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links?.map(
                (
                  link: RepositoryCaseLink & {
                    caseA: {
                      id: number;
                      name: string;
                      source: RepositoryCaseSource;
                      testRuns: Array<{
                        results: Array<{
                          id: number;
                          status: {
                            name: string;
                            color?: { value: string };
                          } | null;
                          executedAt: Date | null;
                        }>;
                      }>;
                      junitResults: Array<{
                        id: number;
                        status: {
                          name: string;
                          color?: { value: string };
                        } | null;
                        executedAt: Date | null;
                      }>;
                    };
                    caseB: {
                      id: number;
                      name: string;
                      source: RepositoryCaseSource;
                      testRuns: Array<{
                        results: Array<{
                          id: number;
                          status: {
                            name: string;
                            color?: { value: string };
                          } | null;
                          executedAt: Date | null;
                        }>;
                      }>;
                      junitResults: Array<{
                        id: number;
                        status: {
                          name: string;
                          color?: { value: string };
                        } | null;
                        executedAt: Date | null;
                      }>;
                    };
                    createdBy: { id: string; name: string };
                  }
                ) => {
                  const otherCase = getOtherCase(link);
                  const otherCaseSource = otherCase.source;
                  return (
                    <TableRow key={link.id}>
                      <TableCell className="w-[300px]">
                        <TestCaseNameDisplay
                          testCase={{
                            id: otherCase.id,
                            name: otherCase.name,
                            source: otherCaseSource,
                            isDeleted: otherCase.isDeleted,
                          }}
                          projectId={
                            otherCase.isDeleted
                              ? undefined
                              : projectId || (otherCase as any).projectId
                          }
                          className="font-medium"
                        />
                      </TableCell>
                      <TableCell className="w-[180px]">
                        <span className="px-2 py-0.5 rounded-lg bg-muted text-xs text-muted-foreground font-semibold">
                          {tLinkedCases(link.type as LinkType)}
                        </span>
                      </TableCell>
                      <TableCell className="w-[180px]">
                        {/* Latest Result Badge and Date */}
                        {(() => {
                          let latestManualResult: {
                            id: number;
                            status: {
                              name: string;
                              color?: { value: string };
                            } | null;
                            executedAt: Date | null;
                          } | null = null;
                          if (
                            otherCase.testRuns &&
                            Array.isArray(otherCase.testRuns)
                          ) {
                            for (const trc of otherCase.testRuns) {
                              if (trc.results && trc.results.length > 0) {
                                const currentManualResultInTRC = trc.results[0];
                                if (currentManualResultInTRC.executedAt) {
                                  if (
                                    !latestManualResult ||
                                    !latestManualResult.executedAt ||
                                    new Date(
                                      currentManualResultInTRC.executedAt
                                    ) > new Date(latestManualResult.executedAt)
                                  ) {
                                    latestManualResult =
                                      currentManualResultInTRC;
                                  }
                                }
                              }
                            }
                          }

                          const latestJUnitResult = (
                            otherCase.junitResults?.[0]?.executedAt
                              ? otherCase.junitResults[0]
                              : null
                          ) as {
                            id: number;
                            status: {
                              name: string;
                              color?: { value: string };
                            } | null;
                            executedAt: Date | null;
                          } | null;

                          let finalLatestResult: {
                            id: number;
                            status: {
                              name: string;
                              color?: { value: string };
                            } | null;
                            executedAt: Date | null;
                          } | null = null;

                          if (
                            latestManualResult &&
                            latestManualResult.executedAt &&
                            latestJUnitResult &&
                            latestJUnitResult.executedAt
                          ) {
                            finalLatestResult =
                              new Date(latestManualResult.executedAt) >
                              new Date(latestJUnitResult.executedAt)
                                ? latestManualResult
                                : latestJUnitResult;
                          } else if (
                            latestManualResult &&
                            latestManualResult.executedAt
                          ) {
                            finalLatestResult = latestManualResult;
                          } else if (
                            latestJUnitResult &&
                            latestJUnitResult.executedAt
                          ) {
                            finalLatestResult = latestJUnitResult;
                          }

                          if (
                            !finalLatestResult ||
                            !finalLatestResult.executedAt
                          )
                            return null;

                          const status = finalLatestResult.status; // status can be null here
                          const date = finalLatestResult.executedAt;

                          return (
                            <div className="space-y-1">
                              <span
                                className="px-2 py-0.5 rounded-lg text-xs font-semibold"
                                style={{
                                  backgroundColor:
                                    status?.color?.value || undefined, // Handles null status
                                  color: status?.color?.value // Handles null status
                                    ? "#fff"
                                    : undefined,
                                }}
                              >
                                {status?.name} {/* Handles null status */}
                              </span>
                              <div>
                                {date && (
                                  <span className="ml-1 text-xs text-muted-foreground font-normal flex items-start gap-1">
                                    <Calendar className="w-4 h-4 shrink-0" />
                                    <DateFormatter
                                      date={date}
                                      formatString={
                                        session?.user.preferences?.dateFormat +
                                        " " +
                                        session?.user.preferences?.timeFormat
                                      }
                                      timezone={
                                        session?.user.preferences?.timezone
                                      }
                                    />
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="w-20">
                        <div className="truncate">
                          <UserNameCell userId={link.createdBy?.id} />
                        </div>
                      </TableCell>
                      <TableCell className="w-[180px]">
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
                      <TableCell className="w-[60px] text-right">
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
                                  <Trash2 className="w-4 h-4" />
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

export default LinkedCasesPanel;
