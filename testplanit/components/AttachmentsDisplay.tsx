import React, { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Attachments } from "@prisma/client";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { DateFormatter } from "@/components/DateFormatter";
import { Separator } from "@/components/ui/separator";
import { UserNameCell } from "@/components/tables/UserNameCell";
import { Link } from "~/lib/navigation";
import { Button } from "@/components/ui/button";
import { getStorageUrlClient } from "~/utils/storageUrl";
import {
  CircleSlash2,
  Download,
  Minus,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { filesize } from "filesize";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";

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
          <div className="bg-green-100 text-green-700 p-1">
            <strong>
              <Plus className="w-4 h-4" />
            </strong>{" "}
            {current}
          </div>
          <div className="bg-red-100 text-red-700 p-1">
            <strong>
              <Minus className="w-4 h-4" />
            </strong>{" "}
            {previous}
          </div>
        </>
      ) : (
        <div
          className={
            label === "Description" && !previousAttachments
              ? "whitespace-pre-wrap max-h-24 overflow-y-auto"
              : ""
          }
        >
          {current}
        </div>
      )}
    </>
  );

  return (
    <div className="h-fit w-full mr-12">
      {sortedAttachments.map((attachment, index) => {
        const previousAttachment = findPreviousAttachment(attachment);
        const isMarkedForDelete = isPendingDelete(attachment.id);
        const hasEdit = hasPendingEdit(attachment.id);
        const displayValues = getDisplayValues(attachment);

        // Skip rendering if marked for delete in deferred mode (show separate section below)
        if (isMarkedForDelete && deferredMode) {
          return (
            <div
              className="w-full min-w-sm border-2 mb-4 bg-destructive/10 rounded-sm border-destructive items-start opacity-60"
              key={attachment.id}
            >
              <div className="p-2 w-full overflow-hidden">
                <div className="flex items-center gap-2 p-2">
                  <Trash2 className="h-5 w-5 text-destructive shrink-0" />
                  <span className="line-through text-muted-foreground truncate min-w-0 flex-1">
                    {attachment.name}
                  </span>
                  <Badge
                    variant="destructive"
                    className="text-xs text-nowrap shrink-0"
                  >
                    {t("common.status.pendingDelete")}
                  </Badge>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-nowrap shrink-0"
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
                  </TooltipProvider>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div
            className="w-full border-2 mb-4 bg-accent rounded-sm items-start border-primary"
            key={attachment.id}
          >
            <div className="p-2 w-full">
              <div className="flex flex-col items-center p-2 w-full h-full mb-2">
                {/* Clickable title - always shows display value (which may include pending edits) */}
                <div
                  onClick={() => handleSelect(sortedAttachments, index)}
                  className="text-lg font-bold text-center mb-2 cursor-pointer line-clamp-2 hover:line-clamp-none"
                >
                  {renderFieldWithDifferences(
                    displayValues.name,
                    previousAttachment?.name
                  )}
                </div>
                <div className="flex flex-col md:flex-row w-full max-h-96 overflow-hidden">
                  <div
                    onClick={() => handleSelect(sortedAttachments, index)}
                    className="md:w-2/3 w-full h-full flex justify-center cursor-pointer"
                  >
                    <AttachmentPreview attachment={attachment} size="large" />
                  </div>
                  <Separator
                    orientation="vertical"
                    className="h-full bg-primary/50 m-1"
                  />
                  <div className="md:w-1/3 w-full flex flex-col justify-start items-start p-4 overflow-hidden">
                    <div className="text-left space-y-2 min-w-[50px] w-full">
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
                            className="w-full mt-1 px-2 py-1 text-sm border rounded-md bg-background"
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
                            className="w-full mt-1 text-sm min-h-[60px]"
                            placeholder={t(
                              "common.fields.description_placeholder"
                            )}
                          />
                        ) : (
                          <div className="w-full min-h-10 max-h-10 overflow-y-auto hover:max-h-24">
                            {displayValues.note || t("common.access.none")}
                          </div>
                        )}
                      </div>
                      <Separator className="w-full" />
                      <div className="text-sm truncate">
                        <strong>{t("common.fields.size")}</strong>{" "}
                        {filesize(Number(attachment.size))}
                      </div>
                      <div className="text-sm truncate">
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
                      <div className="text-sm truncate">
                        <strong>{t("common.fields.createdBy")}</strong>
                        <UserNameCell userId={attachment.createdById} />
                      </div>
                      <div className="flex space-x-2 items-end">
                        {attachment.mimeType !== "text/uri-list" ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link
                                  className="inline-flex h-9 items-center justify-center rounded-md px-3 bg-primary text-primary-foreground hover:bg-primary/90"
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
                          </TooltipProvider>
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
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-fit" side="bottom">
                              {t("attachments.delete.deferredMessage")}
                              <div className="flex items-start justify-between gap-4 mt-2">
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={() =>
                                    handlePopoverOpenChange(index, false)
                                  }
                                >
                                  <CircleSlash2 className="h-4 w-4 mr-1" />
                                  {t("common.cancel")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  onClick={(e) => handleDelete(index, e)}
                                >
                                  <Trash2 className="h-4 w-4 mr-1" />
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
        previousAttachments.map((prevAttachment, index) => {
          if (
            !sortedAttachments.some(
              (currentAttachment) => currentAttachment.id === prevAttachment.id
            )
          ) {
            return (
              <div
                className="w-full border-2 mb-4 bg-red-100 rounded-sm border-primary items-start min-w-[260px]"
                key={prevAttachment.id}
              >
                <div className="relative">
                  <div className="absolute top-2 left-2 text-red-700 text-xl">
                    <Minus className="w-4 h-4" />
                  </div>
                </div>
                <div className="p-2 w-full">
                  <div className="flex flex-col items-center p-2 w-full h-full mb-2">
                    <div className="text-lg font-bold text-center mb-2 cursor-pointer">
                      {prevAttachment.name}
                    </div>
                    <div className="flex flex-col md:flex-row w-full h-80">
                      <div className="md:w-2/3 flex flex-col h-full">
                        <div className="w-full h-full flex justify-center cursor-pointer">
                          <AttachmentPreview
                            attachment={prevAttachment}
                            size="large"
                          />
                        </div>
                      </div>
                      <Separator
                        orientation="vertical"
                        className="h-full bg-primary/50 m-1"
                      />
                      <div className="md:w-1/3 w-full flex flex-col justify-start items-start p-4 overflow-hidden h-fit">
                        <div className="text-left space-y-2 min-w-[50px] w-full">
                          <div className="text-sm truncate">
                            <strong>{t("common.fields.description")}</strong>
                            <div className="w-full h-20 max-h-24 md:max-h-48 overflow-auto">
                              {prevAttachment.note
                                ? prevAttachment.note
                                : t("common.access.none")}
                            </div>
                          </div>
                          <Separator className="w-full" />
                          <div className="text-sm truncate">
                            <strong>{t("common.fields.size")}</strong>{" "}
                            {filesize(Number(prevAttachment.size))}
                          </div>
                          <div className="text-sm truncate">
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
                          <div className="text-sm truncate">
                            <strong>{t("common.fields.createdBy")}</strong>
                            <UserNameCell userId={prevAttachment.createdById} />
                          </div>
                          <div className="flex space-x-2 mt-4">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Button type="button" className="mt-4">
                                    <Link
                                      href={
                                        getStorageUrlClient(
                                          prevAttachment.url
                                        ) || prevAttachment.url
                                      }
                                      download={prevAttachment.name}
                                      target="_blank"
                                    >
                                      <Download className="inline w-5 h-5" />
                                    </Link>
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("common.actions.download")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
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
