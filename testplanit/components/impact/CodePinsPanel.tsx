"use client";

import { CodeRepositoryName } from "@/components/CodeRepositoryName";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import {
  AlertTriangle,
  GitBranch,
  Pin,
  Plus,
  SquarePen,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IssuesDisplay } from "@/components/tables/IssuesDisplay";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DataTable } from "@/components/tables/DataTable";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  codePinErrorKey,
  isManagedCodePin,
  useCodePins,
  type CodePin,
  type CodePinSource,
  type PinStaleReason,
} from "~/hooks/useCodePins";
import { schema } from "~/zenstack/schema";
import { AddCodePinDialog } from "./AddCodePinDialog";
import { CodePinKindBadge } from "./CodePinKindBadge";

interface CodePinsPanelProps {
  caseId: number;
  projectId: number;
  readOnly?: boolean;
}

const SOURCE_LABEL_KEY: Record<CodePinSource, string> = {
  MANUAL: "common.fields.manual",
  AI: "runs.impact.reasons.ai",
  ANNOTATION: "repository.codePins.sourceAnnotation",
  MAPFILE: "repository.codePins.sourceMapfile",
  ISSUE: "runs.impact.reasons.issue",
};

/** Column visibility is fixed here; the table only needs a setter to exist. */
const noopVisibilityChange = () => {};

const STALE_REASON_KEY: Record<PinStaleReason, string> = {
  FILE_DELETED: "staleFileDeleted",
  SNIPPET_NOT_FOUND: "staleSnippetNotFound",
  SYMBOL_NOT_FOUND: "staleSymbolNotFound",
};

function formatLocation(
  pin: CodePin,
  t: ReturnType<typeof useTranslations>
): string {
  switch (pin.kind) {
    case "RANGE": {
      if (pin.startLine === null) return t("kindFile");
      const end = pin.endLine ?? pin.startLine;
      return end === pin.startLine
        ? `L${pin.startLine}`
        : `L${pin.startLine}–L${end}`;
    }
    case "SYMBOL":
      return pin.symbol ?? "";
    case "GLOB":
      return pin.filePath;
    default:
      return t("kindFile");
  }
}

export function CodePinsPanel({
  caseId,
  projectId,
  readOnly = false,
}: CodePinsPanelProps) {
  const t = useTranslations("repository.codePins");
  const tCommon = useTranslations("common");
  const tGlobal = useTranslations();
  const tDuplicates = useTranslations("repository.duplicates");
  const tImpact = useTranslations("runs.impact");

  const { data: project } = useClientQueries(schema).projects.useFindFirst({
    where: { id: projectId },
    select: {
      impactEnabled: true,
      codeRepositoryConfigs: {
        where: { purpose: "IMPACT" },
        orderBy: { id: "asc" },
        select: {
          id: true,
          branch: true,
          repositoryId: true,
          cacheEnabled: true,
          repository: { select: { name: true } },
        },
      },
    },
  });

  const impactConfigs = useMemo(
    () => project?.codeRepositoryConfigs ?? [],
    [project?.codeRepositoryConfigs]
  );
  const impactConfig = impactConfigs[0] ?? null;
  const multiRepository = impactConfigs.length > 1;
  const enabled = project?.impactEnabled === true && impactConfig !== null;
  const repositoryOptions = useMemo(
    () =>
      impactConfigs.map((config) => ({
        configId: config.id,
        repositoryId: config.repositoryId,
        name: config.repository.name,
      })),
    [impactConfigs]
  );
  const configFor = (configId: number) =>
    impactConfigs.find((config) => config.id === configId) ?? null;

  const {
    pins,
    stalenessError,
    refetch,
    remove,
    reanchor,
    dismissStale,
    isMutating,
    isLoading,
  } = useCodePins(caseId, { enabled });

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingPin, setEditingPin] = useState<CodePin | null>(null);
  const [openRemoveId, setOpenRemoveId] = useState<number | null>(null);

  const handleCreated = () => {
    toast.success(t("addSuccess"));
    void refetch();
  };

  const handleUpdated = () => {
    toast.success(t("updateSuccess"));
    setEditingPin(null);
    void refetch();
  };

  const handleRemove = useCallback(
    async (pinId: number) => {
      // The hook drops the row optimistically, so the confirm closes at once.
      setOpenRemoveId(null);
      try {
        await remove(pinId);
        toast.success(t("removeSuccess"));
      } catch (error) {
        const key = codePinErrorKey(error);
        toast.error(key ? t(key) : t("removeFailed"));
      }
    },
    [remove, t]
  );

  const handleReanchor = useCallback(
    async (pinId: number) => {
      try {
        await reanchor(pinId);
        toast.success(t("reanchorSuccess"));
      } catch (error) {
        const key = codePinErrorKey(error);
        toast.error(key ? t(key) : t("reanchorFailed"));
      }
    },
    [reanchor, t]
  );

  const handleDismissStale = useCallback(
    async (pinId: number) => {
      try {
        await dismissStale(pinId);
      } catch (error) {
        if (error instanceof Error) toast.error(error.message);
      }
    },
    [dismissStale]
  );

  const renderSource = useCallback(
    (pin: CodePin) => {
      const badge = (
        <Badge
          variant={pin.source === "MANUAL" ? "secondary" : "outline"}
          className="shrink-0 whitespace-nowrap"
          data-testid={`case-code-pin-source-${pin.id}`}
        >
          {tGlobal(SOURCE_LABEL_KEY[pin.source])}
        </Badge>
      );
      return isManagedCodePin(pin) ? (
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent>{t("managedTooltip")}</TooltipContent>
        </Tooltip>
      ) : (
        badge
      );
    },
    [t, tGlobal]
  );

  const renderFile = useCallback(
    (pin: CodePin) => {
      const managed = isManagedCodePin(pin);
      const staleness = pin.staleness;
      const isStale = staleness?.stale === true && !staleness.staleDismissed;
      const staleReason = staleness?.staleReason
        ? t(STALE_REASON_KEY[staleness.staleReason])
        : "";
      return (
        <div className="min-w-0">
          <div className="font-mono text-sm truncate" title={pin.filePath}>
            {pin.filePath}
          </div>
          {/* A ticket pin's note is the issue keys; when they resolve to
              linked issues, the chips replace it. */}
          {pin.issues && pin.issues.length > 0 ? (
            <div
              className="mt-1 flex flex-wrap gap-1"
              data-testid={`case-code-pin-issues-${pin.id}`}
            >
              {pin.issues.map((issue) => (
                <IssuesDisplay
                  key={issue.id}
                  id={issue.id}
                  name={issue.name}
                  externalId={issue.externalId}
                  externalUrl={issue.externalUrl}
                  title={issue.title}
                  description={issue.description}
                  status={issue.externalStatus}
                  priority={issue.priority}
                  lastSyncedAt={issue.lastSyncedAt}
                  projectIds={[projectId]}
                  integrationProvider={issue.integration?.provider ?? undefined}
                  integrationId={issue.integrationId ?? undefined}
                  issueTypeName={issue.issueTypeName}
                  issueTypeIconUrl={issue.issueTypeIconUrl}
                />
              ))}
            </div>
          ) : (
            pin.note && (
              <div
                className="text-xs text-muted-foreground truncate"
                title={pin.note}
              >
                {pin.note}
              </div>
            )
          )}
          {/* The stale badge and its actions sit under the path so a long
              file name keeps the whole column. */}
          {isStale && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    data-testid={`case-code-pin-stale-${pin.id}`}
                    className="gap-2 shrink-0 border-dashed border-warning bg-warning/15 text-foreground"
                  >
                    <AlertTriangle className="h-3 w-3 text-warning" />
                    {tImpact("stale.badge")}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {t("staleTooltip", { reason: staleReason })}
                </TooltipContent>
              </Tooltip>
              {!readOnly && !managed && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={isMutating}
                    data-testid={`case-code-pin-reanchor-${pin.id}`}
                    onClick={() => handleReanchor(pin.id)}
                  >
                    {t("reanchor")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    disabled={isMutating}
                    data-testid={`case-code-pin-dismiss-${pin.id}`}
                    onClick={() => handleDismissStale(pin.id)}
                  >
                    {tCommon("dismiss")}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      );
    },
    [
      t,
      tCommon,
      tImpact,
      projectId,
      readOnly,
      isMutating,
      handleReanchor,
      handleDismissStale,
    ]
  );

  const renderActions = useCallback(
    (pin: CodePin) => {
      const managed = isManagedCodePin(pin);
      return (
        <div className="flex justify-end whitespace-nowrap">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("editAction")}
            disabled={managed}
            data-testid={`case-code-pin-edit-${pin.id}`}
            onClick={() => setEditingPin(pin)}
          >
            <SquarePen className="w-4 h-4" />
          </Button>
          <Popover
            open={openRemoveId === pin.id}
            onOpenChange={(open) => setOpenRemoveId(open ? pin.id : null)}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={tCommon("actions.remove")}
                disabled={managed}
                data-testid={`case-code-pin-remove-${pin.id}`}
                onClick={() => setOpenRemoveId(pin.id)}
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
                  {tCommon("cancel")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isMutating}
                  data-testid={`case-code-pin-remove-confirm-${pin.id}`}
                  onClick={() => handleRemove(pin.id)}
                >
                  {tCommon("actions.remove")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      );
    },
    [t, tCommon, openRemoveId, isMutating, handleRemove]
  );

  // The shared DataTable gives the columns drag-to-resize handles and, with
  // the storage key, remembers each user's widths.
  const columns = useMemo<ColumnDef<CodePin>[]>(() => {
    const defs: ColumnDef<CodePin>[] = [];
    if (multiRepository) {
      defs.push({
        id: "repository",
        header: tCommon("pageTitles.repository"),
        size: 160,
        enableSorting: false,
        cell: ({ row }) => (
          <CodeRepositoryName
            name={
              impactConfigs.find((c) => c.id === row.original.configId)
                ?.repository.name ?? "—"
            }
            className="max-w-full text-sm"
            data-testid={`case-code-pin-repository-${row.original.id}`}
          />
        ),
      });
    }
    defs.push(
      {
        id: "file",
        header: tCommon("file"),
        size: 340,
        enableSorting: false,
        meta: { wrap: true },
        cell: ({ row }) => renderFile(row.original),
      },
      {
        id: "location",
        header: t("location"),
        size: 150,
        enableSorting: false,
        cell: ({ row }) => {
          const pin = row.original;
          const location = formatLocation(pin, t);
          return (
            <span
              className="font-mono text-sm"
              title={
                pin.anchorSha
                  ? t("anchoredAt", { sha: pin.anchorSha.slice(0, 7) })
                  : location
              }
              data-testid={`case-code-pin-location-${pin.id}`}
            >
              {location}
            </span>
          );
        },
      },
      {
        id: "kind",
        header: t("kind"),
        size: 110,
        enableSorting: false,
        cell: ({ row }) => <CodePinKindBadge kind={row.original.kind} />,
      },
      {
        id: "source",
        header: tDuplicates("sourceLabel"),
        size: 110,
        enableSorting: false,
        cell: ({ row }) => renderSource(row.original),
      }
    );
    if (!readOnly) {
      defs.push({
        id: "actions",
        header: tCommon("actions.actionsLabel"),
        size: 92,
        enableSorting: false,
        enableResizing: false,
        meta: { wrap: true },
        cell: ({ row }) => renderActions(row.original),
      });
    }
    return defs;
  }, [
    multiRepository,
    impactConfigs,
    readOnly,
    t,
    tCommon,
    tDuplicates,
    renderFile,
    renderSource,
    renderActions,
  ]);
  const columnVisibility = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.id, true])),
    [columns]
  );

  if (!enabled || !impactConfig) {
    return null;
  }

  // Read-only callers only get the card once there are pins to show.
  if (readOnly && (isLoading || pins.length === 0)) {
    return null;
  }

  return (
    <Card shadow="none" data-testid="case-code-pins">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="flex items-center gap-2 min-w-0">
          <Pin className="w-5 h-5 shrink-0" />
          <span className="shrink-0">{t("title")}</span>
          {/* Badged so the repository reads as the connected source, not as
              a subtitle of the card. With several repositories each row
              names its own, so the badge only counts them. */}
          {multiRepository ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="flex items-center gap-1 min-w-0 font-normal"
                  data-testid="case-code-pins-repository"
                >
                  <GitBranch className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {t("repositoriesCount", { count: impactConfigs.length })}
                  </span>
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <ul
                  className="space-y-0.5"
                  data-testid="case-code-pins-repository-list"
                >
                  {impactConfigs.map((config) => (
                    <li key={config.id}>
                      <CodeRepositoryName
                        name={config.repository.name}
                        branch={config.branch}
                        iconClassName="text-current opacity-80"
                      />
                    </li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Badge
              variant="outline"
              className="flex items-center gap-1 min-w-0 font-normal"
              data-testid="case-code-pins-repository"
            >
              <CodeRepositoryName
                name={impactConfig.repository.name}
                branch={impactConfig.branch}
                iconClassName="h-3 w-3 text-current"
              />
            </Badge>
          )}
        </CardTitle>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="case-code-pins-add"
            onClick={() => setIsAddOpen(true)}
          >
            <Plus className="w-4 h-4" /> {t("add")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div
            className="mx-4 mb-4 space-y-3"
            data-testid="case-code-pins-loading"
            aria-busy="true"
          >
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <span className="sr-only">{tCommon("loading")}</span>
          </div>
        ) : pins.length === 0 ? (
          <div className="text-muted-foreground ms-4 -mt-6 mb-4 text-sm space-y-1">
            <div>{t("empty")}</div>
            <div className="text-xs">{t("description")}</div>
          </div>
        ) : (
          <DataTable<CodePin>
            columns={columns}
            data={pins}
            getRowId={(pin) => String(pin.id)}
            rowTestIdPrefix="case-code-pin"
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={noopVisibilityChange}
            storageKey="case-code-pins"
            enableColumnReorder={false}
            enableColumnMenu={false}
          />
        )}
        {stalenessError && (
          <div
            className="px-4 pb-3 pt-2 text-xs text-muted-foreground"
            data-testid="case-code-pins-staleness-error"
          >
            {stalenessError}
          </div>
        )}
      </CardContent>

      {isAddOpen && (
        <AddCodePinDialog
          open={isAddOpen}
          onOpenChange={setIsAddOpen}
          projectId={projectId}
          configId={impactConfig.id}
          repositoryId={impactConfig.repositoryId}
          repositories={repositoryOptions}
          caseId={caseId}
          onCreated={handleCreated}
        />
      )}

      {editingPin && (
        // Keyed so switching rows remounts with that pin's values.
        <AddCodePinDialog
          key={editingPin.id}
          open
          onOpenChange={(next) => {
            if (!next) setEditingPin(null);
          }}
          projectId={projectId}
          configId={(configFor(editingPin.configId) ?? impactConfig).id}
          repositoryId={
            (configFor(editingPin.configId) ?? impactConfig).repositoryId
          }
          caseId={caseId}
          pin={editingPin}
          onUpdated={handleUpdated}
        />
      )}
    </Card>
  );
}

export default CodePinsPanel;
