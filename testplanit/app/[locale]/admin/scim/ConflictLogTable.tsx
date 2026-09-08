"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  listScimConflictsAction,
  reEmitScimMemberEventAction,
  type ConflictLogRow,
} from "~/app/actions/scimConflictLogActions";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ViewPayloadDialog } from "./ViewPayloadDialog";

type ConflictTypeKey =
  | "typeLinked"
  | "typeResurrected"
  | "typeSkippedMembers"
  | "typeDisplayNameOverwrote"
  | "typeReEmitted"
  | "typeConflict"
  | "typeUnknown";

function deriveConflictType(
  metadata: Record<string, unknown> | null
): ConflictTypeKey {
  if (!metadata) return "typeUnknown";
  if (metadata.scimReEmittedBy) return "typeReEmitted";
  if (
    Array.isArray(metadata.scimSkippedMemberIds) &&
    (metadata.scimSkippedMemberIds as unknown[]).length > 0
  ) {
    return "typeSkippedMembers";
  }
  if (metadata.scimDisplayNameOverwrote) return "typeDisplayNameOverwrote";
  if (metadata.scimResurrected) return "typeResurrected";
  if (metadata.scimLinked) return "typeLinked";
  if (metadata.scimConflict) return "typeConflict";
  return "typeUnknown";
}

function isReEmitEligible(row: ConflictLogRow): boolean {
  const md = row.metadata;
  if (!md) return false;
  if (md.scimReEmittedBy) return false;
  const ids = md.scimSkippedMemberIds;
  return Array.isArray(ids) && ids.length > 0;
}

interface CursorState {
  timestamp: string;
  id: string;
}

export function ConflictLogTable() {
  const t = useTranslations("admin.scim.conflicts");

  const [rows, setRows] = useState<ConflictLogRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(CursorState | undefined)[]>([
    undefined,
  ]);

  const [viewPayloadRow, setViewPayloadRow] = useState<ConflictLogRow | null>(
    null
  );
  const [reEmitRow, setReEmitRow] = useState<ConflictLogRow | null>(null);
  const [isReEmitting, setIsReEmitting] = useState(false);

  const fetchPage = useCallback(async (cursor: CursorState | undefined) => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const result = await listScimConflictsAction({
        cursor,
        count: 50,
      });
      if (result.success && result.items) {
        setRows(result.items);
        setHasMore(!!result.hasMore);
      } else {
        setRows([]);
        setHasMore(false);
        setLoadError(result.error ?? "errorLoad");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const top = cursorStack[cursorStack.length - 1];
    void fetchPage(top);
  }, [cursorStack, fetchPage]);

  const handleNext = useCallback(() => {
    if (!hasMore || rows.length === 0) return;
    const last = rows[rows.length - 1];
    const next: CursorState = {
      timestamp:
        last.timestamp instanceof Date
          ? last.timestamp.toISOString()
          : String(last.timestamp),
      id: last.id,
    };
    setCursorStack((prev) => [...prev, next]);
  }, [hasMore, rows]);

  const handlePrev = useCallback(() => {
    setCursorStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const handleConfirmReEmit = useCallback(async () => {
    if (!reEmitRow) return;
    setIsReEmitting(true);
    try {
      const result = await reEmitScimMemberEventAction(reEmitRow.id);
      if (result.success) {
        toast.success(t("reEmitSuccess"));
        setReEmitRow(null);
        const top = cursorStack[cursorStack.length - 1];
        void fetchPage(top);
      } else {
        toast.error(t("reEmitError", { reason: result.error ?? "Unknown" }));
      }
    } catch (err) {
      toast.error(
        t("reEmitError", {
          reason: err instanceof Error ? err.message : "Unknown",
        })
      );
    } finally {
      setIsReEmitting(false);
    }
  }, [reEmitRow, t, cursorStack, fetchPage]);

  if (isLoading && rows.length === 0) {
    return (
      <div
        data-testid="scim-conflict-loading"
        className="py-8 text-center text-sm text-muted-foreground"
      >
        <Loader2 className="inline h-4 w-4 animate-spin" />
        <span className="ms-2">{t("loading")}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        data-testid="scim-conflict-error"
        className="py-8 text-center text-sm text-destructive"
      >
        {t("errorLoad")}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p
        data-testid="scim-conflict-empty"
        className="py-8 text-center text-sm text-muted-foreground"
      >
        {t("empty")}
      </p>
    );
  }

  return (
    <div data-testid="scim-conflict-log-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("colTimestamp")}</TableHead>
            <TableHead>{t("colType")}</TableHead>
            <TableHead>{t("colEntity")}</TableHead>
            <TableHead>{t("colAction")}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const type = deriveConflictType(row.metadata);
            const ts =
              row.timestamp instanceof Date
                ? row.timestamp
                : new Date(row.timestamp);
            const tsLabel = ts.toLocaleString();
            return (
              <TableRow
                key={row.id}
                data-testid={`scim-conflict-row-${row.id}`}
              >
                <TableCell>{tsLabel}</TableCell>
                <TableCell data-testid={`scim-conflict-type-${row.id}`}>
                  {t(type)}
                </TableCell>
                <TableCell>
                  {row.entityType}
                  {"#"}
                  {row.entityId}
                </TableCell>
                <TableCell>{row.action}</TableCell>
                <TableCell>
                  <div className="flex flex-row items-center justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewPayloadRow(row)}
                      data-testid={`scim-conflict-view-${row.id}`}
                    >
                      {t("viewPayload")}
                    </Button>
                    {isReEmitEligible(row) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setReEmitRow(row)}
                        data-testid={`scim-conflict-reemit-${row.id}`}
                      >
                        {t("reEmit")}
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="mt-4 flex flex-row items-center justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePrev}
          disabled={cursorStack.length <= 1 || isLoading}
          data-testid="scim-conflict-prev"
        >
          {t("previous")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleNext}
          disabled={!hasMore || isLoading}
          data-testid="scim-conflict-next"
        >
          {t("next")}
        </Button>
      </div>

      <ViewPayloadDialog
        open={viewPayloadRow !== null}
        onOpenChange={(open) => {
          if (!open) setViewPayloadRow(null);
        }}
        auditRow={viewPayloadRow}
      />

      <AlertDialog
        open={reEmitRow !== null}
        onOpenChange={(open) => {
          if (!open) setReEmitRow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reEmitConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reEmitConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReEmitting}>
              {t("close")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReEmit}
              disabled={isReEmitting}
              data-testid="scim-conflict-reemit-confirm"
            >
              {isReEmitting && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {t("reEmit")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
