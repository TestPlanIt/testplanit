"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { filesize } from "filesize";
import { RotateCcw, Trash2, Unlink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { apiFetch } from "~/lib/basePath";
import {
  ATTACHMENT_ACTIONS,
  type AttachmentAction,
} from "~/lib/services/adminAttachmentRules";
import type { AttachmentActionResult } from "~/lib/services/adminAttachmentActions";
import type { AdminAttachment } from "~/lib/services/adminAttachments";

export interface AttachmentActionRequest {
  action: AttachmentAction;
  ids: number[];
}

/** Whether `action` does anything to `attachment`. */
function applies(action: AttachmentAction, attachment: AdminAttachment) {
  switch (action) {
    case "detach":
      return attachment.parent !== null;
    case "softDelete":
      return !attachment.isDeleted;
    case "restore":
    case "purge":
      return attachment.isDeleted;
  }
}

function useActionLabels() {
  const t = useTranslations("admin.attachments.actions");
  const tCommon = useTranslations("common");
  return (action: AttachmentAction): string => {
    switch (action) {
      case "detach":
        return t("detach");
      case "softDelete":
        return tCommon("actions.delete");
      case "restore":
        return tCommon("actions.restore");
      case "purge":
        return tCommon("actions.purge");
    }
  };
}

const ACTION_ICONS = {
  detach: Unlink,
  softDelete: Trash2,
  restore: RotateCcw,
  purge: Trash2,
} as const;

/**
 * The actions that fit at least one of the chosen attachments, as buttons.
 * `ids` may name attachments the list has not loaded; nothing is known about
 * those, so every action is offered and the server sorts out which apply.
 */
export function AttachmentActionButtons({
  ids,
  attachments,
  onAction,
  testIdPrefix,
}: {
  ids: number[];
  /** The chosen attachments that are loaded. */
  attachments: AdminAttachment[];
  onAction: (request: AttachmentActionRequest) => void;
  testIdPrefix: string;
}) {
  const label = useActionLabels();
  const hasUnloaded = ids.length > attachments.length;
  const actions = ATTACHMENT_ACTIONS.filter(
    (action) =>
      hasUnloaded ||
      attachments.some((attachment) => applies(action, attachment))
  );

  return (
    <>
      {actions.map((action) => {
        const Icon = ACTION_ICONS[action];
        return (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={action === "purge" ? "destructive" : "outline"}
            data-testid={`${testIdPrefix}-${action}`}
            onClick={() => onAction({ action, ids })}
          >
            <Icon className="h-4 w-4" />
            {label(action)}
          </Button>
        );
      })}
    </>
  );
}

async function postAction(
  action: AttachmentAction,
  ids: number[],
  dryRun: boolean
): Promise<AttachmentActionResult> {
  const response = await apiFetch("/api/admin/attachments/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ids, dryRun }),
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return (await response.json()) as AttachmentActionResult;
}

/**
 * Says what an action is about to do to the chosen attachments, from a dry
 * run on the server, and does it once the administrator confirms.
 */
export function AttachmentActionDialog({
  request,
  onClose,
  onDone,
}: {
  request: AttachmentActionRequest | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("admin.attachments.actions");
  const tCommon = useTranslations("common");
  const label = useActionLabels();
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);

  const ids = request?.ids ?? [];
  const { data: preview, isError } = useQuery({
    queryKey: ["admin-attachments-action-preview", request?.action, ids],
    queryFn: () => postAction(request!.action, ids, true),
    enabled: !!request,
    gcTime: 0,
    staleTime: 0,
  });

  if (!request) return null;
  const { action } = request;
  const count = preview?.applied.length ?? 0;
  const files = preview?.files;

  const run = async () => {
    setRunning(true);
    try {
      const result = await postAction(action, ids, false);
      toast.success(t("done", { count: result.applied.length }));
      if (result.files?.failed) {
        toast.error(t("filesFailed", { count: result.files.failed }));
      }
      await queryClient.invalidateQueries({ queryKey: ["admin-attachments"] });
      onDone();
    } catch {
      toast.error(tCommon("errors.somethingWentWrong"));
    } finally {
      setRunning(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !running) onClose();
      }}
    >
      <AlertDialogContent data-testid="attachment-action-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{label(action)}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              {isError ? (
                <p className="text-destructive">
                  {tCommon("errors.somethingWentWrong")}
                </p>
              ) : !preview ? (
                <p>{tCommon("loading")}</p>
              ) : (
                <>
                  <p data-testid="attachment-action-summary">
                    {t(`confirm.${action}`, { count })}
                  </p>
                  {files && count > 0 && (
                    <ul className="list-disc space-y-1 ps-5">
                      <li data-testid="attachment-action-files">
                        {t("purgeFiles", {
                          count: files.deleted,
                          size: filesize(files.bytes),
                        })}
                      </li>
                      {files.shared > 0 && (
                        <li>{t("purgeShared", { count: files.shared })}</li>
                      )}
                      {files.inVersions > 0 && (
                        <li>
                          {t("purgeInVersions", { count: files.inVersions })}
                        </li>
                      )}
                    </ul>
                  )}
                  {preview.skipped.length > 0 && (
                    <p data-testid="attachment-action-skipped">
                      {t("skipped", { count: preview.skipped.length })}
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running}>
            {tCommon("cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={running || count === 0}
            className={
              action === "purge"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
            data-testid="attachment-action-confirm"
            onClick={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            {label(action)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
