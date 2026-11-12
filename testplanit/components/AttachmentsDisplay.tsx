import { AttachmentPreview } from "@/components/AttachmentPreview";
import { DateFormatter } from "@/components/DateFormatter";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Attachments } from "~/zenstack/models";
import { filesize } from "filesize";
import {
  CircleSlash2,
  Download,
  Minus,
  Plus,
  Trash,
  Undo2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import React, { useCallback, useEffect, useState } from "react";
import { Link } from "~/lib/navigation";
import { getStorageUrlClient } from "~/utils/storageUrl";

export interface AttachmentEdit {
  id: number;
  name?: string;
  note?: string;
}

export interface AttachmentChanges {
  edits: AttachmentEdit[];
  deletes: number[];
}

interface AttachmentsProps {
  attachments: Attachments[];
  onSelect: (attachments: Attachments[], index: number) => void;
  preventEditing?: boolean;
  previousAttachments?: Attachments[];
  deferredMode?: boolean;
  onPendingChanges?: (changes: AttachmentChanges) => void;
}

export const AttachmentsDisplay: React.FC<AttachmentsProps> = ({
  attachments,
  onSelect,
  preventEditing = false,
  previousAttachments,
  deferredMode = false,
  onPendingChanges,
}) => {
  const [openPopovers, setOpenPopovers] = useState<boolean[]>(
    attachments.map(() => false)
  );
  const { data: session } = useSession();
  const t = useTranslations();

  // Deferred mode state - tracks pending changes that will be applied on form submit
  const [pendingEdits, setPendingEdits] = useState<{
    [attachmentId: number]: { name: string; note: string };
  }>({});
  const [pendingDeletes, setPendingDeletes] = useState<number[]>([]);

  // Notify parent of pending changes when in deferred mode
  const notifyPendingChanges = useCallback(() => {
    if (deferredMode && onPendingChanges) {
      const edits: AttachmentEdit[] = Object.entries(pendingEdits).map(
        ([id, data]) => ({
          id: Number(id),
          name: data.name,
          note: data.note,
        })
      );
      onPendingChanges({ edits, deletes: pendingDeletes });
    }
  }, [deferredMode, onPendingChanges, pendingEdits, pendingDeletes]);

  useEffect(() => {
    notifyPendingChanges();
  }, [notifyPendingChanges]);

  // Reset deferred state when attachments change (e.g., after form submit)
  useEffect(() => {
    if (deferredMode) {
      setPendingEdits({});
      setPendingDeletes([]);
    }
  }, [attachments, deferredMode]);

  if (!attachments || attachments.length === 0) {
    return null;
  }

  // Sort attachments by createdAt timestamp (newest first)
  const sortedAttachments = [...attachments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleSelect = (attachments: Attachments[], index: number) => {
    onSelect(attachments, index);
  };

  const handlePopoverOpenChange = (index: number, isOpen: boolean) => {
    setOpenPopovers((prev) => {
      const newOpenPopovers = [...prev];
      newOpenPopovers[index] = isOpen;
      return newOpenPopovers;
    });
  };

  const handleDelete = async (
    index: number,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    const attachment = sortedAttachments[index];

    // In deferred mode, mark as pending delete instead of deleting immediately
    if (deferredMode) {
      setPendingDeletes((prev) => [...prev, attachment.id]);
      handlePopoverOpenChange(index, false);
      return;
    }

    // Direct delete is no longer supported - attachments can only be deleted
    // through the parent entity's edit mode (deferred mode)
    handlePopoverOpenChange(index, false);
  };

  // Undo a pending delete in deferred mode
  const handleUndoDelete = (
    attachmentId: number,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    setPendingDeletes((prev) => prev.filter((id) => id !== attachmentId));
  };

  // Check if an attachment has pending edits
  const hasPendingEdit = (attachmentId: number) => {
    return attachmentId in pendingEdits;
  };

  // Check if an attachment is marked for deletion
  const isPendingDelete = (attachmentId: number) => {
    return pendingDeletes.includes(attachmentId);
  };

  // Get display values for an attachment (pending edits override original values)
  const getDisplayValues = (attachment: Attachments) => {
    if (pendingEdits[attachment.id]) {
      return {
        name: pendingEdits[attachment.id].name,
        note: pendingEdits[attachment.id].note,
      };
    }
    return {
      name: attachment.name,
      note: attachment.note,
    };
  };

  const findPreviousAttachment = (current: Attachments) =>
    previousAttachments?.find(
      (prevAttachment) => prevAttachment.id === current.id
    );

  const renderFieldWithDifferences = (
    current: string,
    previous: string | undefined,
    label?: string
  ) => (
    <>
      {label && <strong>{label}</strong>}
      {previousAttachments && previous !== undefined && current !== previous ? (
        <>
          <div className="rounded bg-green-500/20 p-1 text-green-700 dark:text-green-400">
            <strong>
              <Plus className="h-4 w-4" />
            </strong>{" "}
            {current}
          </div>
          <div className="rounded bg-red-500/20 p-1 text-red-700 dark:text-red-400">
            <strong>
              <Minus className="h-4 w-4" />
            </strong>{" "}
            {previous}
          </div>
        </>
      ) : (
        <div
          className={
            label === "Description" && !previousAttachments
              ? "max-h-24 overflow-y-auto whitespace-pre-wrap"
              : ""
          }
        >
          {current}
        </div>
      )}
    </>
  );

  return (
    <div className="me-12 h-fit w-full">
      {sortedAttachments.map((attachment, index) => {
        const previousAttachment = findPreviousAttachment(attachment);
        const isMarkedForDelete = isPendingDelete(attachment.id);
        const _hasEdit = hasPendingEdit(attachment.id);
        const displayValues = getDisplayValues(attachment);

        // Skip rendering if marked for delete in deferred mode (show separate section below)
        if (isMarkedForDelete && deferredMode) {
          return (
            <div
              className="mb-4 w-full min-w-sm items-start rounded-sm border-2 border-destructive bg-destructive/10 opacity-60"
              key={attachment.id}
            >
              <div className="w-full overflow-hidden p-2">
                <div className="flex items-center gap-2 p-2">
                  <Trash className="h-5 w-5 shrink-0 text-destructive" />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground line-through">
                    {attachment.name}
                  </span>
                  <Badge
                    variant="destructive"
                    className="shrink-0 text-xs text-nowrap"
                  >
                    {t("common.status.pendingDelete")}
                  </Badge>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 text-nowrap"
                        onClick={(e) => handleUndoDelete(attachment.id, e)}
                      >
                        <Undo2 className="h-4 w-4" />
                        {t("common.actions.undo")}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("common.actions.undoDelete")}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            className="mb-4 w-full items-start rounded-sm border-2 border-primary bg-card text-card-foreground"
            key={attachment.id}
          >
            <div className="w-full p-2">
              <div className="mb-2 flex h-full w-full flex-col items-center p-2">
                {/* Clickable title - always shows display value (which may include pending edits) */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      onClick={() => handleSelect(sortedAttachments, index)}
                      className="mb-2 w-full max-w-full cursor-pointer truncate text-center text-lg font-bold [&_div]:truncate"
                    >
                      {renderFieldWithDifferences(
                        displayValues.name,
                        previousAttachment?.name
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{displayValues.name}</TooltipContent>
                </Tooltip>
                <div
                  className={`flex max-h-96 w-full overflow-hidden ${
                    attachment.mimeType === "text/uri-list"
                      ? "flex-col"
                      : "flex-col md:flex-row"
                  }`}
                >
                  <div
                    onClick={() => handleSelect(sortedAttachments, index)}
                    className={`flex h-full w-full cursor-pointer justify-center ${
                      attachment.mimeType === "text/uri-list"
                        ? "py-2"
                        : "md:w-2/3"
                    }`}
                  >
                    <AttachmentPreview attachment={attachment} size="large" />
                  </div>
                  <Separator
                    orientation={
                      attachment.mimeType === "text/uri-list"
                        ? "horizontal"
                        : "vertical"
                    }
                    className={
                      attachment.mimeType === "text/uri-list"
                        ? "my-1 w-full bg-primary/50"
                        : "m-1 h-full bg-primary/50"
                    }
                  />
                  <div
                    className={`flex w-full flex-col items-start justify-start overflow-hidden p-4 ${
                      attachment.mimeType === "text/uri-list" ? "" : "md:w-1/3"
                    }`}
                  >
                    <div
                      className={`w-full min-w-[50px] text-start ${
                        attachment.mimeType === "text/uri-list"
                          ? "grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-6 gap-y-2"
                          : "space-y-2"
                      }`}
                    >
                      {/* Name field - editable in deferred mode */}
                      <div className="text-sm">
                        <strong>{t("common.name")}</strong>
                        {deferredMode && !preventEditing ? (
                          <input
                            type="text"
                            value={displayValues.name}
                            onChange={(e) => {
                              setPendingEdits((prev) => ({
                                ...prev,
                                [attachment.id]: {
                                  name: e.target.value,
                                  note:
                                    prev[attachment.id]?.note ??
                                    attachment.note ??
                                    "",
                                },
                              }));
                            }}
                            className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground"
                            aria-label={t("common.name")}
                          />
                        ) : (
                          <div className="truncate">{displayValues.name}</div>
                        )}
                      </div>
                      {/* Description field - editable in deferred mode */}
                      <div className="text-sm">
                        <strong>{t("common.fields.description")}</strong>
                        {deferredMode && !preventEditing ? (
                          <Textarea
                            value={displayValues.note ?? ""}
                            onChange={(e) => {
                              setPendingEdits((prev) => ({
                                ...prev,
                                [attachment.id]: {
                                  name:
                                    prev[attachment.id]?.name ??
                                    attachment.name,
                                  note: e.target.value,
                                },
                              }));
                            }}
                            className="mt-1 min-h-[60px] w-full text-sm"
                            placeholder={t(
                              "common.fields.description_placeholder"
                            )}
                          />
                        ) : (
                          <div className="max-h-24 w-full overflow-y-auto whitespace-pre-wrap">
                            {displayValues.note || t("common.access.none")}
                          </div>
                        )}
                      </div>
                      {attachment.mimeType !== "text/uri-list" && (
                        <Separator className="w-full" />
                      )}
                      <div className="truncate text-sm">
                        <strong>{t("common.fields.size")}</strong>{" "}
                        {filesize(Number(attachment.size))}
                      </div>
                      <div className="truncate text-sm">
                        <strong>{t("common.fields.created")}</strong>
                        <div className="truncate">
                          <DateFormatter
                            date={attachment.createdAt}
                            formatString={
                              session?.user.preferences?.dateFormat +
                              " " +
                              session?.user.preferences?.timeFormat
                            }
                            timezone={session?.user.preferences?.timezone}
                          />
                        </div>
                      </div>
                      <div className="truncate text-sm">
                        <strong>{t("common.fields.createdBy")}</strong>
                        <UserNameCell userId={attachment.createdById} />
                      </div>
                      <div className="flex items-end space-x-2">
                        {attachment.mimeType !== "text/uri-list" ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link
                                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-3 text-primary-foreground hover:bg-primary/90"
                                href={
                                  getStorageUrlClient(attachment.url) ||
                                  attachment.url
                                }
                                target="_blank"
                              >
                                <Download className="h-5 w-5 shrink-0" />
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("common.actions.download")}
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                        {/* In deferred mode, show delete button */}
                        {deferredMode && !preventEditing && (
                          <Popover
                            open={openPopovers[index]}
                            onOpenChange={(isOpen) =>
                              handlePopoverOpenChange(index, isOpen)
                            }
                          >
                            <PopoverTrigger asChild>
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                              >
                                <Trash className="h-4 w-4" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-fit" side="bottom">
                              {t("attachments.delete.deferredMessage")}
                              <div className="mt-2 flex items-start justify-between gap-4">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    handlePopoverOpenChange(index, false)
                                  }
                                >
                                  <CircleSlash2 className="h-4 w-4" />
                                  {t("common.cancel")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={(e) => handleDelete(index, e)}
                                >
                                  <Trash className="h-4 w-4" />
                                  {t("common.actions.delete")}
                                </Button>
                              </div>
                            </PopoverContent>
                          </Popover>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {previousAttachments &&
        previousAttachments.map((prevAttachment, _index) => {
          if (
            !sortedAttachments.some(
              (currentAttachment) => currentAttachment.id === prevAttachment.id
            )
          ) {
            return (
              <div
                className="mb-4 w-full min-w-[260px] items-start rounded-sm border-2 border-primary bg-red-500/10 dark:bg-red-500/20"
                key={prevAttachment.id}
              >
                <div className="relative">
                  <div className="absolute inset-s-2 top-2 text-xl text-red-700 dark:text-red-400">
                    <Minus className="h-4 w-4" />
                  </div>
                </div>
                <div className="w-full p-2">
                  <div className="mb-2 flex h-full w-full flex-col items-center p-2">
                    <div className="mb-2 cursor-pointer text-center text-lg font-bold">
                      {prevAttachment.name}
                    </div>
                    <div className="flex h-80 w-full flex-col overflow-hidden md:flex-row">
                      <div className="flex h-full flex-col md:w-2/3">
                        <div className="flex h-full w-full cursor-pointer justify-center">
                          <AttachmentPreview
                            attachment={prevAttachment}
                            size="large"
                          />
                        </div>
                      </div>
                      <Separator
                        orientation="vertical"
                        className="m-1 h-full bg-primary/50"
                      />
                      <div className="flex h-fit w-full flex-col items-start justify-start overflow-hidden p-4 md:w-1/3">
                        <div className="w-full min-w-[50px] space-y-2 text-start">
                          <div className="truncate text-sm">
                            <strong>{t("common.fields.description")}</strong>
                            <div className="h-20 max-h-24 w-full overflow-auto md:max-h-48">
                              {prevAttachment.note
                                ? prevAttachment.note
                                : t("common.access.none")}
                            </div>
                          </div>
                          <Separator className="w-full" />
                          <div className="truncate text-sm">
                            <strong>{t("common.fields.size")}</strong>{" "}
                            {filesize(Number(prevAttachment.size))}
                          </div>
                          <div className="truncate text-sm">
                            <strong>{t("common.fields.created")}</strong>
                            <div className="truncate">
                              <DateFormatter
                                date={prevAttachment.createdAt}
                                formatString={
                                  session?.user.preferences?.dateFormat +
                                  " " +
                                  session?.user.preferences?.timeFormat
                                }
                                timezone={session?.user.preferences?.timezone}
                              />
                            </div>
                          </div>
                          <div className="truncate text-sm">
                            <strong>{t("common.fields.createdBy")}</strong>
                            <UserNameCell userId={prevAttachment.createdById} />
                          </div>
                          <div className="mt-4 flex space-x-2">
                            <Tooltip>
                              <TooltipTrigger type="button">
                                <Button type="button" className="mt-4">
                                  <Link
                                    href={
                                      getStorageUrlClient(prevAttachment.url) ||
                                      prevAttachment.url
                                    }
                                    download={prevAttachment.name}
                                    target="_blank"
                                  >
                                    <Download className="inline h-5 w-5" />
                                  </Link>
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("common.actions.download")}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          return null;
        })}
    </div>
  );
};
