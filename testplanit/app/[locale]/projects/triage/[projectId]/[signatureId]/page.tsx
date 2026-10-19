"use client";

import { DateFormatter } from "@/components/DateFormatter";
import { RelativeTimeTooltip } from "@/components/RelativeTimeTooltip";
import { DataTable } from "@/components/tables/DataTable";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import type {
  ColumnDef,
  VisibilityState,
} from "@/components/tables/tableFeatures";
import { CaseDisplay } from "@/components/tables/CaseDisplay";
import { TestRunNameDisplay } from "@/components/TestRunNameDisplay";
import { TestRunsListDisplay } from "@/components/tables/TestRunsListDisplay";
import { UserNameCell } from "@/components/tables/UserNameCell";
import {
  ClassificationBadge,
  FlakyCandidateBadge,
  SignatureStatusBadge,
} from "@/components/triage/badges";
import {
  SignatureIssueLinker,
  type SignatureIssueDraft,
} from "@/components/triage/SignatureIssueLinker";
import {
  ActionBar,
  ActionOverflow,
  useContainerCompact,
} from "@/components/ui/action-bar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import TipTapEditor from "@/components/tiptap/TipTapEditor";
import { useQuery } from "@tanstack/react-query";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import {
  ArrowLeft,
  Check,
  CircleOff,
  Loader2,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loading } from "~/components/Loading";
import { useProjectPermissions } from "~/hooks/useProjectPermissions";
import { useRequireAuth } from "~/hooks/useRequireAuth";
import { Link } from "~/lib/navigation";
import {
  ApplicationArea,
  FailureClassification,
  type FailureSignatureStatus,
} from "~/zenstack/models";
import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { normalizeTiptapInput } from "~/lib/tiptap/normalizeTiptapInput";
import { buildSignatureIssueDraft } from "~/lib/services/triage/issueDraft";
import { tiptapToMarkdown } from "~/lib/tiptap/tiptapToMarkdown";
import type { SignatureCaseRow } from "~/app/api/projects/[projectId]/triage/signatures/[signatureId]/cases/route";
import { schema } from "~/zenstack/schema";

const OCCURRENCES_LIMIT = 25;

type SortState = { column: string; direction: "asc" | "desc" };

function toggleSort(prev: SortState, column: string): SortState {
  return prev.column === column
    ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
    : { column, direction: "asc" };
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

function sortRows<T>(
  rows: T[],
  sort: SortState,
  pick: (row: T, column: string) => unknown
): T[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort(
    (a, b) =>
      direction * compareValues(pick(a, sort.column), pick(b, sort.column))
  );
}

const EMPTY_DOC = { type: "doc", content: [{ type: "paragraph" }] };

type AffectedCaseRow = {
  id: number;
  name?: string;
  source?: string;
  automated?: boolean;
  isDeleted: boolean;
  occurrences: number;
  runCount: number;
  lastSeenAt: Date | null;
};

type OccurrenceRow = {
  id: number;
  testRun: { id: number; name: string; isDeleted: boolean } | null;
  caseId: number;
  repositoryCase: {
    id: number;
    name: string;
    source: string;
    automated: boolean;
    isDeleted: boolean;
  } | null;
  executedAt: Date;
};

export default function SignatureDetailPage() {
  const t = useTranslations();
  const { session, isLoading: isAuthLoading } = useRequireAuth();
  const { projectId: projectIdParam, signatureId: signatureIdParam } =
    useParams<{
      projectId: string;
      signatureId: string;
    }>();
  const projectId = Number(projectIdParam);
  const signatureId = Number(signatureIdParam);
  const { permissions } = useProjectPermissions(
    projectId,
    ApplicationArea.TestRuns
  );
  const canEdit = permissions?.canAddEdit ?? false;
  const { ref: headerRef, compact } = useContainerCompact();

  const queries = useClientQueries(schema);
  const {
    data: signature,
    isLoading,
    refetch,
  } = queries.failureSignature.useFindUnique(
    {
      where: { id: signatureId },
      include: {
        issues: {
          include: {
            issue: {
              select: {
                id: true,
                name: true,
                title: true,
                description: true,
                externalId: true,
                externalKey: true,
                externalUrl: true,
                externalStatus: true,
                status: true,
                priority: true,
                lastSyncedAt: true,
                data: true,
                issueTypeName: true,
                issueTypeIconUrl: true,
                integration: {
                  select: { id: true, provider: true, name: true },
                },
              },
            },
          },
        },
      },
    },
    { enabled: Number.isInteger(signatureId) && !isAuthLoading }
  );

  const sampleSelect = {
    id: true,
    message: true,
    content: true,
    systemErr: true,
    executedAt: true,
  } as const;
  // Prefer the latest occurrence that actually carries text; fall back to
  // the latest one for its stderr and timestamp.
  const { data: sampleWithText } = queries.jUnitTestResult.useFindFirst(
    {
      where: {
        failureSignatureId: signatureId,
        OR: [{ content: { not: null } }, { message: { not: null } }],
      },
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
      select: sampleSelect,
    },
    { enabled: !!signature }
  );
  const { data: sampleAny } = queries.jUnitTestResult.useFindFirst(
    {
      where: { failureSignatureId: signatureId },
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
      select: sampleSelect,
    },
    { enabled: !!signature }
  );
  const sample = sampleWithText ?? sampleAny;
  const sampleBody =
    sample?.content || sample?.message || sample?.systemErr || null;

  const { data: occurrences } = queries.jUnitTestResult.useFindMany(
    {
      where: { failureSignatureId: signatureId },
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
      take: OCCURRENCES_LIMIT,
      select: {
        id: true,
        executedAt: true,
        createdAt: true,
        repositoryCaseId: true,
        repositoryCase: {
          select: {
            id: true,
            name: true,
            source: true,
            automated: true,
            isDeleted: true,
          },
        },
        testSuite: {
          select: {
            testRun: { select: { id: true, name: true, isDeleted: true } },
          },
        },
      },
    },
    { enabled: !!signature }
  );

  const { data: caseGroups } = useQuery({
    queryKey: ["triage-signature-cases", projectId, signatureId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/triage/signatures/${signatureId}/cases`
      );
      if (!res.ok) throw new Error("Failed to load affected cases");
      const body = (await res.json()) as { cases: SignatureCaseRow[] };
      return body.cases;
    },
    enabled: !!signature,
  });
  const affectedCaseIds = (caseGroups ?? []).map((g) => g.caseId);
  const { data: affectedCases } = queries.repositoryCases.useFindMany(
    {
      where: { id: { in: affectedCaseIds } },
      select: {
        id: true,
        name: true,
        source: true,
        automated: true,
        isDeleted: true,
      },
    },
    { enabled: affectedCaseIds.length > 0 }
  );
  const caseById = useMemo(
    () => new Map((affectedCases ?? []).map((c) => [c.id, c])),
    [affectedCases]
  );

  const [affectedVisibility, setAffectedVisibility] = useState<VisibilityState>(
    {}
  );
  const [occurrenceVisibility, setOccurrenceVisibility] =
    useState<VisibilityState>({});
  const [affectedSort, setAffectedSort] = useState<SortState>({
    column: "occurrences",
    direction: "desc",
  });
  const [occurrenceSort, setOccurrenceSort] = useState<SortState>({
    column: "executedAt",
    direction: "desc",
  });
  const tName = t("common.name");
  const tOccurrences = t("triage.columns.occurrences");
  const tLastSeen = t("triage.columns.lastSeen");
  const tTestRuns = t("common.fields.testRuns");
  const tTestCases = t("common.fields.testCases");
  const tExecutedAt = t("common.fields.executedAt");

  const affectedCaseRows = useMemo<AffectedCaseRow[]>(
    () =>
      (caseGroups ?? []).map((group) => {
        const testCase = caseById.get(group.caseId);
        return {
          id: group.caseId,
          name: testCase?.name,
          source: testCase?.source,
          automated: testCase?.automated,
          isDeleted: testCase?.isDeleted ?? false,
          occurrences: group.occurrences,
          runCount: group.runCount,
          lastSeenAt: group.lastSeenAt ? new Date(group.lastSeenAt) : null,
        };
      }),
    [caseGroups, caseById]
  );
  const sortedAffectedCaseRows = useMemo(
    () =>
      sortRows(affectedCaseRows, affectedSort, (row, column) =>
        column === "name"
          ? row.name
          : column === "occurrences"
            ? row.occurrences
            : column === "runCount"
              ? row.runCount
              : row.lastSeenAt
      ),
    [affectedCaseRows, affectedSort]
  );
  const affectedCaseColumns = useMemo<ColumnDef<AffectedCaseRow>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: tName,
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 300,
        minSize: 60,
        cell: ({ row }) => (
          <CaseDisplay
            id={row.original.id}
            name={row.original.name}
            source={row.original.source}
            automated={row.original.automated}
            isDeleted={row.original.isDeleted}
            projectId={row.original.isDeleted ? undefined : projectId}
            className="truncate"
          />
        ),
      },
      {
        id: "occurrences",
        accessorKey: "occurrences",
        header: tOccurrences,
        enableSorting: true,
        enableResizing: true,
        size: 185,
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.occurrences}</span>
        ),
      },
      {
        id: "runCount",
        accessorKey: "runCount",
        header: tTestRuns,
        enableSorting: true,
        enableResizing: true,
        size: 150,
        minSize: 60,
        maxSize: 200,
        cell: ({ row }) => (
          <div className="text-center">
            <TestRunsListDisplay
              key={`tr-${row.original.id}`}
              count={row.original.runCount}
              filter={{
                junitTestSuites: {
                  some: {
                    results: {
                      some: {
                        failureSignatureId: signatureId,
                        repositoryCaseId: row.original.id,
                      },
                    },
                  },
                },
              }}
            />
          </div>
        ),
      },
      {
        id: "lastSeenAt",
        accessorKey: "lastSeenAt",
        header: tLastSeen,
        enableSorting: true,
        enableResizing: true,
        size: 160,
        cell: ({ row }) =>
          row.original.lastSeenAt ? (
            <div className="truncate text-sm text-muted-foreground">
              <RelativeTimeTooltip
                date={row.original.lastSeenAt}
                className="block truncate"
              />
            </div>
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
    ],
    [projectId, signatureId, tName, tOccurrences, tTestRuns, tLastSeen]
  );

  const occurrenceRows = useMemo<OccurrenceRow[]>(
    () =>
      (occurrences ?? []).map((occurrence) => ({
        id: occurrence.id,
        testRun: occurrence.testSuite.testRun,
        caseId: occurrence.repositoryCaseId,
        repositoryCase: occurrence.repositoryCase,
        executedAt: occurrence.executedAt ?? occurrence.createdAt,
      })),
    [occurrences]
  );
  const sortedOccurrenceRows = useMemo(
    () =>
      sortRows(occurrenceRows, occurrenceSort, (row, column) =>
        column === "testRun"
          ? row.testRun?.name
          : column === "testCase"
            ? row.repositoryCase?.name
            : row.executedAt
      ),
    [occurrenceRows, occurrenceSort]
  );
  const occurrenceColumns = useMemo<ColumnDef<OccurrenceRow>[]>(
    () => [
      {
        id: "testRun",
        accessorFn: (row) => row.testRun?.name ?? "",
        header: tTestRuns,
        enableSorting: true,
        enableResizing: true,
        enableHiding: false,
        meta: { isPinned: "left" },
        size: 300,
        minSize: 100,
        cell: ({ row }) =>
          row.original.testRun ? (
            <TestRunNameDisplay
              testRun={row.original.testRun}
              projectId={projectId}
              linkSuffix={`?selectedCase=${row.original.caseId}`}
              className="truncate"
            />
          ) : (
            <span className="text-muted-foreground">-</span>
          ),
      },
      {
        id: "testCase",
        accessorFn: (row) => row.repositoryCase?.name ?? "",
        header: tTestCases,
        enableSorting: true,
        enableResizing: true,
        size: 300,
        minSize: 60,
        cell: ({ row }) => (
          <CaseDisplay
            id={row.original.caseId}
            name={row.original.repositoryCase?.name}
            source={row.original.repositoryCase?.source}
            automated={row.original.repositoryCase?.automated}
            isDeleted={row.original.repositoryCase?.isDeleted}
            projectId={
              row.original.repositoryCase?.isDeleted ? undefined : projectId
            }
            className="truncate"
          />
        ),
      },
      {
        id: "executedAt",
        accessorKey: "executedAt",
        header: tExecutedAt,
        enableSorting: true,
        enableResizing: true,
        size: 180,
        cell: ({ row }) => (
          <DateFormatter
            date={row.original.executedAt}
            formatString={`${session?.user.preferences?.dateFormat ?? "MM-dd-yyyy"} ${session?.user.preferences?.timeFormat ?? "HH:mm"}`}
            timezone={session?.user.preferences?.timezone}
          />
        ),
      },
    ],
    [projectId, session, tTestRuns, tTestCases, tExecutedAt]
  );

  const { mutateAsync: updateSignature, isPending: isUpdating } =
    queries.failureSignature.useUpdate();
  const { mutateAsync: unlinkIssue } =
    queries.failureSignatureIssue.useDelete();

  const [notesDoc, setNotesDoc] = useState<object>(EMPTY_DOC);
  const [notesDirty, setNotesDirty] = useState(false);
  useEffect(() => {
    setNotesDoc(normalizeTiptapInput(signature?.notes) ?? EMPTY_DOC);
    setNotesDirty(false);
  }, [signature?.id, signature?.notes]);

  const [classifying, setClassifying] = useState(false);
  const [unlinkIssueId, setUnlinkIssueId] = useState<number | null>(null);

  const issueDraft = useMemo<SignatureIssueDraft | undefined>(() => {
    if (!signature) return undefined;
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return buildSignatureIssueDraft(
      {
        title: signature.title,
        signatureUrl: `${origin}/projects/triage/${projectId}/${signature.id}`,
        classificationLabel:
          signature.classification === "UNCLASSIFIED"
            ? null
            : t(`triage.classification.${signature.classification}`),
        aiRationale: signature.aiRationale,
        aiSuggestedIssueTitle: signature.aiSuggestedIssueTitle,
        aiSuggestedNextStep: signature.aiSuggestedNextStep,
        occurrenceCount: signature.occurrenceCount,
        caseCount: signature.caseCount,
        runCount: signature.runCount,
        cases: affectedCaseRows
          .filter(
            (row): row is AffectedCaseRow & { name: string } => !!row.name
          )
          .map((row) => ({
            name: row.name,
            url: `${origin}/projects/repository/${projectId}/${row.id}`,
          })),
        latestRun: occurrenceRows[0]?.testRun
          ? {
              name: occurrenceRows[0].testRun.name,
              url: `${origin}/projects/runs/${projectId}/${occurrenceRows[0].testRun.id}`,
            }
          : null,
        failureText: sampleBody,
      },
      {
        signature: t("triage.detail.signatureLabel"),
        latestRun: t("triage.detail.lastRun"),
        classification: t("triage.columns.classification"),
        rationale: t("triage.detail.rationale"),
        nextStep: t("triage.detail.nextStep"),
        occurrences: `${t("triage.columns.occurrences")} / ${t("common.fields.testCases")} / ${t("common.fields.testRuns")}`,
        affectedCases: t("triage.detail.affectedCasesLabel"),
        latestFailure: t("triage.detail.sampleTrace"),
      }
    );
  }, [signature, projectId, affectedCaseRows, occurrenceRows, sampleBody, t]);

  if (isAuthLoading || isLoading) return <Loading />;
  if (!session?.user) return <div>{t("common.errors.sessionNotFound")}</div>;
  if (!signature || signature.projectId !== projectId) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6">
          <Button
            asChild
            variant="outline"
            size="icon"
            aria-label={t("common.actions.back")}
          >
            <Link href={`/projects/triage/${projectId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <p className="text-muted-foreground">
            {t("common.labels.noResults")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const save = async (data: Record<string, unknown>) => {
    try {
      await updateSignature({
        where: { id: signature.id },
        data: data as never,
      });
      toast.success(t("triage.toasts.updated"));
    } catch (error) {
      console.error("Failed to update signature:", error);
      toast.error(t("triage.toasts.updateFailed"));
    }
  };

  const setStatus = (status: FailureSignatureStatus) =>
    save({
      status,
      resolvedAt: status === "RESOLVED" ? new Date() : null,
      resolvedById: status === "RESOLVED" ? session.user.id : null,
    });

  const setClassification = (classification: FailureClassification) =>
    save({
      classification,
      classificationSource: "MANUAL",
      classifiedAt: new Date(),
      classifiedById: session.user.id,
    });

  const saveNotes = async () => {
    await save({ notes: isTiptapEmpty(notesDoc) ? null : notesDoc });
    setNotesDirty(false);
  };

  const classifyNow = async () => {
    setClassifying(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/triage/signatures/${signature.id}/classify`,
        {
          method: "POST",
        }
      );
      if (res.status === 409) {
        toast.error(t("triage.toasts.noAiModel"));
        return;
      }
      if (!res.ok) {
        toast.error(t("triage.toasts.updateFailed"));
        return;
      }
      toast.success(t("triage.toasts.classifyQueued"));
    } catch {
      toast.error(t("triage.toasts.updateFailed"));
    } finally {
      setClassifying(false);
    }
  };

  const handleUnlink = async (issueId: number) => {
    try {
      await unlinkIssue({
        where: { signatureId_issueId: { signatureId: signature.id, issueId } },
      });
      setUnlinkIssueId(null);
      toast.success(t("issues.unlinked"));
      void refetch();
    } catch (error) {
      console.error("Failed to unlink issue:", error);
      toast.error(t("issues.unlinkError"));
    }
  };

  return (
    <main>
      <Card>
        <CardHeader>
          <div
            ref={headerRef}
            className="flex items-center justify-between gap-2"
          >
            <div className="flex min-w-0 grow items-start gap-2">
              <Button
                asChild
                variant="outline"
                size="icon"
                className="shrink-0"
                aria-label={t("common.actions.back")}
              >
                <Link href={`/projects/triage/${projectId}`}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0 grow">
                <CardTitle
                  className="min-w-0 break-words font-mono text-base md:text-lg"
                  data-testid="triage-signature-title"
                >
                  {signature.title}
                </CardTitle>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SignatureStatusBadge status={signature.status} />
                  <ClassificationBadge
                    classification={signature.classification}
                    source={signature.classificationSource}
                  />
                  {signature.flakyCandidate && <FlakyCandidateBadge />}
                </div>
              </div>
            </div>
            {canEdit && (
              <ActionBar compact={compact} className="ms-4 shrink-0">
                <ActionOverflow
                  compact={compact}
                  menuLabel={t("common.actions.actionsLabel")}
                  actions={[
                    {
                      key: "classify",
                      icon: classifying ? Loader2 : Sparkles,
                      label: t("triage.actions.classify"),
                      onClick: () => void classifyNow(),
                      disabled: classifying,
                      testId: "triage-classify-button",
                    },
                    {
                      key: "resolve",
                      icon: Check,
                      label: t("triage.actions.resolve"),
                      onClick: () => void setStatus("RESOLVED"),
                      hidden: signature.status === "RESOLVED",
                      disabled: isUpdating,
                      testId: "triage-resolve-button",
                    },
                    {
                      key: "ignore",
                      icon: CircleOff,
                      label: t("triage.actions.ignore"),
                      onClick: () => void setStatus("IGNORED"),
                      hidden: signature.status === "IGNORED",
                      disabled: isUpdating,
                      testId: "triage-ignore-button",
                    },
                    {
                      key: "reopen",
                      icon: RotateCcw,
                      label: t("milestones.status.reopen"),
                      onClick: () => void setStatus("OPEN"),
                      hidden: signature.status === "OPEN",
                      disabled: isUpdating,
                      testId: "triage-reopen-button",
                    },
                  ]}
                />
              </ActionBar>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ResizablePanelGroup
            direction="horizontal"
            className="min-h-[400px]"
            autoSaveId="triage-signature-panels"
          >
            <ResizablePanel
              id="triage-signature-left"
              order={1}
              defaultSize={40}
              minSize={25}
            >
              <div className="flex flex-col gap-4 pe-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("common.fields.summary")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                      <dt className="text-muted-foreground">
                        {t("triage.detail.exceptionType")}
                      </dt>
                      <dd className="font-mono">
                        {signature.exceptionType ?? "-"}
                      </dd>
                      <dt className="text-muted-foreground">
                        {t("triage.columns.occurrences")}
                      </dt>
                      <dd className="tabular-nums">
                        {signature.occurrenceCount}
                      </dd>
                      <dt className="text-muted-foreground">
                        {t("common.fields.testCases")}
                      </dt>
                      <dd className="tabular-nums">{signature.caseCount}</dd>
                      <dt className="text-muted-foreground">
                        {t("common.fields.testRuns")}
                      </dt>
                      <dd className="tabular-nums">{signature.runCount}</dd>
                      <dt className="text-muted-foreground">
                        {t("triage.columns.firstSeen")}
                      </dt>
                      <dd>
                        <RelativeTimeTooltip date={signature.firstSeenAt} />
                      </dd>
                      <dt className="text-muted-foreground">
                        {t("triage.columns.lastSeen")}
                      </dt>
                      <dd>
                        <RelativeTimeTooltip date={signature.lastSeenAt} />
                      </dd>
                    </dl>
                    {signature.kind === "NONE" ? (
                      <p className="text-muted-foreground">
                        {t("triage.detail.noDetails")}
                      </p>
                    ) : (
                      <>
                        {signature.normalizedMessage && (
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              {t("triage.detail.normalizedMessage")}
                            </Label>
                            <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">
                              {signature.normalizedMessage}
                            </p>
                          </div>
                        )}
                        {signature.frames.length > 0 && (
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              {t("triage.detail.frames")}
                            </Label>
                            <ul className="mt-1 space-y-0.5 font-mono text-xs">
                              {signature.frames.map((frame) => (
                                <li
                                  key={frame}
                                  className="truncate"
                                  title={frame}
                                >
                                  {frame}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("triage.columns.classification")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    {canEdit && (
                      <div className="space-y-1">
                        <Label htmlFor="triage-classification-select">
                          {t("triage.actions.setClassification")}
                        </Label>
                        <Select
                          value={signature.classification}
                          onValueChange={(value) =>
                            void setClassification(
                              value as FailureClassification
                            )
                          }
                          disabled={isUpdating}
                        >
                          <SelectTrigger
                            id="triage-classification-select"
                            className="w-full"
                            data-testid="triage-classification-select"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.values(FailureClassification).map(
                              (value) => (
                                <SelectItem key={value} value={value}>
                                  {t(`triage.classification.${value}`)}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {signature.classificationSource === "MANUAL" &&
                      signature.classifiedById && (
                        <div
                          className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
                          data-testid="triage-classified-by"
                        >
                          <span>{t("triage.columns.classifiedBy")}</span>
                          <UserNameCell userId={signature.classifiedById} />
                          {signature.classifiedAt && (
                            <RelativeTimeTooltip
                              date={signature.classifiedAt}
                            />
                          )}
                        </div>
                      )}
                    {signature.classificationSource === "AI" && (
                      <div
                        className="flex items-center gap-1 text-sm text-muted-foreground"
                        data-testid="triage-classified-by"
                      >
                        <Sparkles className="h-3.5 w-3.5" aria-hidden />
                        {t("triage.source.AI")}
                      </div>
                    )}
                    {signature.aiClassifiedAt ? (
                      <div className="space-y-2 rounded-md bg-muted/50 p-3">
                        <Label className="text-xs font-medium">
                          {t("triage.detail.aiSuggestion")}
                        </Label>
                        <div className="flex flex-wrap items-center gap-2">
                          <ClassificationBadge
                            classification={
                              signature.aiClassification ?? "UNCLASSIFIED"
                            }
                            source="AI"
                          />
                          <span className="text-xs text-muted-foreground">
                            <RelativeTimeTooltip
                              date={signature.aiClassifiedAt}
                            />
                          </span>
                        </div>
                        {signature.aiRationale && (
                          <div>
                            <Label className="text-xs font-medium">
                              {t("triage.detail.rationale")}
                            </Label>
                            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                              {signature.aiRationale}
                            </p>
                          </div>
                        )}
                        {signature.aiSuggestedIssueTitle && (
                          <div>
                            <Label className="text-xs font-medium">
                              {t("triage.detail.suggestedIssueTitle")}
                            </Label>
                            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                              <p className="text-muted-foreground">
                                {signature.aiSuggestedIssueTitle}
                              </p>
                              {canEdit && (
                                <SignatureIssueLinker
                                  mode="create"
                                  signatureId={signature.id}
                                  projectId={projectId}
                                  linkedIssueIds={signature.issues.map(
                                    (link) => link.issue.id
                                  )}
                                  draft={issueDraft}
                                  onLinked={() => void refetch()}
                                />
                              )}
                            </div>
                          </div>
                        )}
                        {signature.aiSuggestedNextStep && (
                          <div>
                            <Label className="text-xs font-medium">
                              {t("triage.detail.nextStep")}
                            </Label>
                            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                              {signature.aiSuggestedNextStep}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">
                        {t("triage.detail.noAi")}
                      </p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span>{t("common.fields.issues")}</span>
                      {canEdit && (
                        <SignatureIssueLinker
                          signatureId={signature.id}
                          projectId={projectId}
                          linkedIssueIds={signature.issues.map(
                            (link) => link.issueId
                          )}
                          onLinked={() => void refetch()}
                        />
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {signature.issues.length === 0 ? (
                      <p className="text-muted-foreground">
                        {t("common.labels.noResults")}
                      </p>
                    ) : (
                      signature.issues.map(({ issue }) => (
                        <div
                          key={issue.id}
                          className="flex items-center gap-2"
                          data-testid="triage-linked-issue"
                        >
                          <IssuesDisplay
                            id={issue.id}
                            name={issue.name}
                            externalId={issue.externalId}
                            externalUrl={issue.externalUrl}
                            title={issue.title}
                            description={issue.description}
                            status={issue.externalStatus ?? issue.status}
                            priority={issue.priority}
                            lastSyncedAt={issue.lastSyncedAt}
                            projectIds={[projectId]}
                            size="small"
                            data={issue.data}
                            integrationProvider={issue.integration?.provider}
                            integrationId={issue.integration?.id}
                            issueTypeName={issue.issueTypeName}
                            issueTypeIconUrl={issue.issueTypeIconUrl}
                          />
                          {canEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="ms-auto h-7 w-7 shrink-0"
                              aria-label={t("issues.unlink")}
                              onClick={() => setUnlinkIssueId(issue.id)}
                              data-testid="triage-unlink-issue-button"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex min-h-9 items-center justify-between gap-2 text-base">
                      <span>{t("common.fields.notes")}</span>
                      {canEdit && notesDirty && (
                        <Button
                          size="sm"
                          onClick={() => void saveNotes()}
                          disabled={isUpdating}
                          data-testid="triage-notes-save"
                        >
                          <Save className="h-4 w-4" />
                          {t("common.actions.save")}
                        </Button>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="w-full rounded-lg border">
                      <TipTapEditor
                        key={`notes-${signature.id}`}
                        content={notesDoc}
                        onUpdate={(doc) => {
                          setNotesDoc((prev) => {
                            // The editor re-emits its document on mount with
                            // extra attributes; only a content change is dirty.
                            if (
                              tiptapToMarkdown(prev) === tiptapToMarkdown(doc)
                            ) {
                              return prev;
                            }
                            setNotesDirty(true);
                            return doc;
                          });
                        }}
                        readOnly={!canEdit}
                        placeholder={t("triage.detail.notesPlaceholder")}
                        projectId={String(projectId)}
                        className="min-h-[150px]"
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle className="w-1" />
            <ResizablePanel
              id="triage-signature-right"
              order={2}
              defaultSize={60}
              minSize={30}
            >
              <div className="flex flex-col gap-4 ps-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2 text-base">
                      <span>{t("triage.detail.sampleTrace")}</span>
                      {sample?.executedAt && (
                        <span className="text-xs font-normal text-muted-foreground">
                          <RelativeTimeTooltip date={sample.executedAt} />
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {sampleBody ? (
                      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs text-destructive">
                        {sampleBody}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        {t("triage.detail.noDetails")}
                      </p>
                    )}
                    {sample?.systemErr && sampleBody !== sample.systemErr && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm text-muted-foreground">
                          {t("common.fields.systemError")}
                        </summary>
                        <pre className="mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 font-mono text-xs">
                          {sample.systemErr}
                        </pre>
                      </details>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("triage.detail.affectedCases", {
                        count: signature.caseCount,
                      })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      virtualized
                      columns={affectedCaseColumns}
                      data={sortedAffectedCaseRows}
                      sortConfig={affectedSort}
                      onSortChange={(column) =>
                        setAffectedSort((prev) => toggleSort(prev, column))
                      }
                      onSortColumn={(column, direction) =>
                        setAffectedSort(
                          direction
                            ? { column, direction }
                            : { column: "occurrences", direction: "desc" }
                        )
                      }
                      columnVisibility={affectedVisibility}
                      onColumnVisibilityChange={setAffectedVisibility}
                      getRowId={(row) => String(row.id)}
                      emptyMessage={t("common.labels.noResults")}
                      testIdPrefix="triage-affected-cases"
                      rowTestIdPrefix="triage-affected-case"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("triage.detail.recentOccurrences", {
                        count: occurrenceRows.length,
                      })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DataTable
                      virtualized
                      columns={occurrenceColumns}
                      data={sortedOccurrenceRows}
                      sortConfig={occurrenceSort}
                      onSortChange={(column) =>
                        setOccurrenceSort((prev) => toggleSort(prev, column))
                      }
                      onSortColumn={(column, direction) =>
                        setOccurrenceSort(
                          direction
                            ? { column, direction }
                            : { column: "executedAt", direction: "desc" }
                        )
                      }
                      columnVisibility={occurrenceVisibility}
                      onColumnVisibilityChange={setOccurrenceVisibility}
                      getRowId={(row) => String(row.id)}
                      emptyMessage={t("common.labels.noResults")}
                      testIdPrefix="triage-occurrences"
                      rowTestIdPrefix="triage-occurrence"
                    />
                  </CardContent>
                </Card>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </CardContent>
      </Card>
      <AlertDialog
        open={unlinkIssueId !== null}
        onOpenChange={(open) => {
          if (!open) setUnlinkIssueId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("milestones.members.unlinkConfirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("triage.detail.unlinkConfirmDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="triage-unlink-cancel">
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (unlinkIssueId !== null) void handleUnlink(unlinkIssueId);
              }}
              data-testid="triage-unlink-confirm"
            >
              {t("common.configurationGroup.unlink")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
