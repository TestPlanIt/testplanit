"use client";

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
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
  MANUAL: "sourceManual",
  AI: "sourceAi",
  ANNOTATION: "sourceAnnotation",
  MAPFILE: "sourceMapfile",
};

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
      if (pin.startLine === null) return t("wholeFile");
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
      return t("wholeFile");
  }
}

export function CodePinsPanel({
  caseId,
  projectId,
  readOnly = false,
}: CodePinsPanelProps) {
  const t = useTranslations("repository.codePins");
  const tCommon = useTranslations("common");

  const { data: project } = useClientQueries(schema).projects.useFindFirst({
    where: { id: projectId },
    select: {
      impactEnabled: true,
      codeRepositoryConfigs: {
        where: { purpose: "IMPACT" },
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

  const impactConfig = project?.codeRepositoryConfigs?.[0] ?? null;
  const enabled = project?.impactEnabled === true && impactConfig !== null;

  const {
    pins,
    stalenessError,
    refetch,
    remove,
    reanchor,
    dismissStale,
    isMutating,
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

  const handleRemove = async (pinId: number) => {
    try {
      await remove(pinId);
      toast.success(t("removeSuccess"));
      setOpenRemoveId(null);
    } catch (error) {
      const key = codePinErrorKey(error);
      toast.error(key ? t(key) : t("removeFailed"));
    }
  };

  const handleReanchor = async (pinId: number) => {
    try {
      await reanchor(pinId);
      toast.success(t("reanchorSuccess"));
    } catch (error) {
      const key = codePinErrorKey(error);
      toast.error(key ? t(key) : t("reanchorFailed"));
    }
  };

  const handleDismissStale = async (pinId: number) => {
    try {
      await dismissStale(pinId);
    } catch (error) {
      if (error instanceof Error) toast.error(error.message);
    }
  };

  if (!enabled || !impactConfig) {
    return null;
  }

  if (readOnly && pins.length === 0) {
    return null;
  }

  return (
    <Card shadow="none" data-testid="case-code-pins">
      <CardHeader className="flex flex-row items-center justify-between p-4">
        <CardTitle className="flex items-center gap-2 min-w-0">
          <Pin className="w-5 h-5 shrink-0" />
          <span className="shrink-0">{t("title")}</span>
          {/* Badged so the repository reads as the connected source, not as
              a subtitle of the card. */}
          <Badge
            variant="outline"
            className="flex items-center gap-1 min-w-0 font-normal"
            data-testid="case-code-pins-repository"
          >
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{impactConfig.repository.name}</span>
            {impactConfig.branch && (
              <>
                <span aria-hidden="true" className="text-muted-foreground">
                  {"·"}
                </span>
                <span className="font-mono truncate">
                  {impactConfig.branch}
                </span>
              </>
            )}
          </Badge>
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
        {pins.length === 0 ? (
          <div className="text-muted-foreground ms-4 -mt-6 mb-4 text-sm space-y-1">
            <div>{t("empty")}</div>
            <div className="text-xs">{t("description")}</div>
          </div>
        ) : (
          <Table className="table-fixed w-full min-w-[660px]">
            <TableHeader>
              <TableRow>
                <TableHead className="truncate">{t("fileLabel")}</TableHead>
                <TableHead className="w-[150px] truncate">
                  {t("location")}
                </TableHead>
                <TableHead className="w-[110px] truncate">
                  {t("kind")}
                </TableHead>
                <TableHead className="w-[110px] truncate">
                  {t("source")}
                </TableHead>
                {!readOnly && (
                  <TableHead className="w-[92px] truncate text-end">
                    {tCommon("actions.actionsLabel")}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pins.map((pin) => {
                const managed = isManagedCodePin(pin);
                const staleness = pin.staleness;
                const isStale =
                  staleness?.stale === true && !staleness.staleDismissed;
                const staleReason = staleness?.staleReason
                  ? t(STALE_REASON_KEY[staleness.staleReason])
                  : "";
                const sourceBadge = (
                  <Badge
                    variant={pin.source === "MANUAL" ? "secondary" : "outline"}
                    className="shrink-0 whitespace-nowrap"
                    data-testid={`case-code-pin-source-${pin.id}`}
                  >
                    {t(SOURCE_LABEL_KEY[pin.source])}
                  </Badge>
                );
                const location = formatLocation(pin, t);

                return (
                  <TableRow
                    key={pin.id}
                    data-testid={`case-code-pin-${pin.id}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="font-mono text-sm truncate"
                          title={pin.filePath}
                        >
                          {pin.filePath}
                        </span>
                        {isStale && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge
                                variant="outline"
                                data-testid={`case-code-pin-stale-${pin.id}`}
                                className="gap-2 shrink-0 border-dashed border-warning bg-warning/15 text-foreground"
                              >
                                <AlertTriangle className="h-3 w-3 text-warning" />
                                {t("staleBadge")}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("staleTooltip", { reason: staleReason })}
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {isStale && !readOnly && !managed && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
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
                              disabled={isMutating}
                              data-testid={`case-code-pin-dismiss-${pin.id}`}
                              onClick={() => handleDismissStale(pin.id)}
                            >
                              {t("dismissStale")}
                            </Button>
                          </>
                        )}
                      </div>
                      {pin.note && (
                        <div
                          className="text-xs text-muted-foreground truncate"
                          title={pin.note}
                        >
                          {pin.note}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className="block font-mono text-sm truncate"
                        title={
                          pin.anchorSha
                            ? t("anchoredAt", {
                                sha: pin.anchorSha.slice(0, 7),
                              })
                            : location
                        }
                        data-testid={`case-code-pin-location-${pin.id}`}
                      >
                        {location}
                      </span>
                    </TableCell>
                    <TableCell>
                      <CodePinKindBadge kind={pin.kind} />
                    </TableCell>
                    <TableCell>
                      {managed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{sourceBadge}</TooltipTrigger>
                          <TooltipContent>{t("managedTooltip")}</TooltipContent>
                        </Tooltip>
                      ) : (
                        sourceBadge
                      )}
                    </TableCell>
                    {!readOnly && (
                      <TableCell className="w-[92px] text-end whitespace-nowrap">
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
                          onOpenChange={(open) =>
                            setOpenRemoveId(open ? pin.id : null)
                          }
                        >
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={t("remove")}
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
                                {t("cancel")}
                              </Button>
                              <Button
                                type="button"
                                variant="destructive"
                                disabled={isMutating}
                                data-testid={`case-code-pin-remove-confirm-${pin.id}`}
                                onClick={() => handleRemove(pin.id)}
                              >
                                {t("remove")}
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
          configId={impactConfig.id}
          repositoryId={impactConfig.repositoryId}
          caseId={caseId}
          pin={editingPin}
          onUpdated={handleUpdated}
        />
      )}
    </Card>
  );
}

export default CodePinsPanel;
