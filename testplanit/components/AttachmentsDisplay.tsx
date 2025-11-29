import React, { useState } from "react";
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
  Save,
  SquarePen,
  Trash2,
} from "lucide-react";
import { filesize } from "filesize";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUpdateAttachments } from "~/lib/hooks";
import { Textarea } from "@/components/ui/textarea";
import LoadingSpinner from "@/components/LoadingSpinner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { z } from "zod/v4";
import { useTranslations } from "next-intl";
import { at } from "lodash";

interface AttachmentsProps {
  attachments: Attachments[];
  onSelect: (attachments: Attachments[], index: number) => void;
  preventEditing?: boolean;
  previousAttachments?: Attachments[];
  onAttachmentDeleted?: (attachmentId: number) => void;
}

const AttachmentSchema = z.object({
  name: z.string().min(1, {
    error: "Name is required.",
  }),
  description: z.string().optional(),
});

export const AttachmentsDisplay: React.FC<AttachmentsProps> = ({
  attachments,
  onSelect,
  preventEditing = false,
  previousAttachments,
  onAttachmentDeleted,
}) => {
  const [editingIndices, setEditingIndices] = useState<number[]>([]);
  const [editedData, setEditedData] = useState<{
    [key: number]: { name: string; description: string };
  }>({});
  const [validationErrors, setValidationErrors] = useState<{
    [key: number]: { name?: string; description?: string };
  }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openPopovers, setOpenPopovers] = useState<boolean[]>(
    attachments.map(() => false)
  );
  const { data: session } = useSession();
  const { mutateAsync: updateAttachments } = useUpdateAttachments();
  const t = useTranslations();

  if (!attachments || attachments.length === 0) {
    return null;
  }

  // Sort attachments by createdAt timestamp (newest first)
  const sortedAttachments = [...attachments].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleSelect = (attachments: Attachments[], index: number) => {
    // Always call onSelect to allow viewing attachments in the carousel
    // Reset editing mode if applicable
    setEditingIndices([]);
    onSelect(attachments, index);
  };

  const handleEdit = (index: number, name: string, description: string) => {
    if (!preventEditing) {
      setEditingIndices((prev) => [...prev, index]);
      setEditedData((prev) => ({ ...prev, [index]: { name, description } }));
    }
  };

  const handleCancel = (
    index: number,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    setEditingIndices((prev) => prev.filter((i) => i !== index));
    setEditedData((prev) => {
      const newData = { ...prev };
      delete newData[index];
      return newData;
    });
    setValidationErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[index];
      return newErrors;
    });
  };

  const handleSubmit = async (
    index: number,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    event.stopPropagation();
    const attachment = sortedAttachments[index];
    const result = AttachmentSchema.safeParse(editedData[index]);

    if (!result.success) {
      const errors = result.error.issues.reduce(
        (acc, issue) => ({
          ...acc,
          [issue.path[0]]: issue.message,
        }),
        {}
      );
      setValidationErrors((prev) => ({ ...prev, [index]: errors }));
      return;
    }

    setIsSubmitting(true);
    try {
      await updateAttachments({
        data: {
          name: editedData[index].name,
          note: editedData[index].description,
        },
        where: {
          id: attachment.id,
        },
      });
      setEditingIndices((prev) => prev.filter((i) => i !== index));
      setEditedData((prev) => {
        const newData = { ...prev };
        delete newData[index];
        return newData;
      });
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[index];
        return newErrors;
      });
    } catch (error) {
      console.error("Failed to update attachment:", error);
    } finally {
      setIsSubmitting(false);
    }
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
    setIsSubmitting(true);
    try {
      await updateAttachments({
        data: {
          isDeleted: true,
        },
        where: {
          id: attachment.id,
        },
      });
      setEditingIndices((prev) => prev.filter((i) => i !== index));
      setEditedData((prev) => {
        const newData = { ...prev };
        delete newData[index];
        return newData;
      });

      if (onAttachmentDeleted) {
        onAttachmentDeleted(attachment.id);
      }
    } catch (error) {
      console.error("Failed to update attachment:", error);
    } finally {
      setIsSubmitting(false);
    }
    handlePopoverOpenChange(index, false);
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
        return (
          <div
            className="w-full border-2 mb-4 bg-accent rounded-sm border-primary items-start"
            key={attachment.id}
          >
            <div className="p-2 w-full">
              <div className="flex flex-col items-center p-2 w-full h-full mb-2">
                {editingIndices.includes(index) && !preventEditing ? (
                  <div className="flex flex-col gap-4 w-full">
                    <Textarea
                      value={editedData[index]?.name || ""}
                      onChange={(e) =>
                        setEditedData((prev) => ({
                          ...prev,
                          [index]: {
                            ...prev[index],
                            name: e.target.value,
                          },
                        }))
                      }
                      className="text-lg font-bold text-center w-full line-clamp-2 hover:line-clamp-none"
                    />
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
                          className="ml-auto w-fit"
                          disabled={preventEditing}
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-fit" side="bottom">
                        {t("attachments.delete.confirmMessage")}
                        <div className="flex items-start justify-between gap-4 mt-2">
                          <div className="flex items-center mb-2">
                            <Button
                              type="button"
                              variant="secondary"
                              className="ml-auto"
                              onClick={() =>
                                handlePopoverOpenChange(index, false)
                              }
                            >
                              <CircleSlash2 className="h-4 w-4 mr-1" />{" "}
                              {t("common.actions.cancel")}
                            </Button>
                          </div>
                          <div className="flex items-center">
                            <Button
                              type="button"
                              variant="destructive"
                              onClick={(e) => handleDelete(index, e)}
                              className="ml-auto"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />{" "}
                              {t("common.actions.delete")}
                            </Button>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : (
                  <div
                    onClick={() => handleSelect(sortedAttachments, index)}
                    className="text-lg font-bold text-center mb-2 cursor-pointer line-clamp-2 hover:line-clamp-none"
                  >
                    {renderFieldWithDifferences(
                      attachment.name,
                      previousAttachment?.name
                    )}
                  </div>
                )}
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
                      <div className="text-sm truncate">
                        <strong>{t("common.fields.name")}</strong>
                        <div className="truncate">{attachment.name}</div>
                      </div>
                      <div className="text-sm">
                        <strong>{t("common.fields.description")}</strong>
                        <div className="w-full min-h-10 max-h-10 overflow-y-auto hover:max-h-24">
                          {attachment.note || t("common.labels.none")}
                        </div>
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
                                  href={getStorageUrlClient(attachment.url) || attachment.url}
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
                        {editingIndices.includes(index) && !preventEditing ? (
                          <>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Button
                                    type="button"
                                    onClick={(e) => handleCancel(index, e)}
                                    disabled={isSubmitting}
                                  >
                                    <CircleSlash2 className="h-5 w-5 shrink-0" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("common.actions.cancel")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <Button
                                    type="button"
                                    className="mt-4"
                                    onClick={(e) => handleSubmit(index, e)}
                                    disabled={isSubmitting}
                                  >
                                    {isSubmitting ? (
                                      <LoadingSpinner className="w-5 h-5" />
                                    ) : (
                                      <Save className="inline w-5 h-5" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("common.actions.save")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </>
                        ) : (
                          !preventEditing && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    className="mt-4"
                                    onClick={() =>
                                      handleEdit(
                                        index,
                                        attachment.name,
                                        attachment.note ?? ""
                                      )
                                    }
                                  >
                                    <SquarePen className="inline w-5 h-5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("common.actions.edit")}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )
                        )}
                      </div>
                      {validationErrors[index]?.name && (
                        <div className="text-destructive font-bold text-sm text-right">
                          {validationErrors[index].name}
                        </div>
                      )}
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
                                : t("common.labels.none")}
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
                                      href={getStorageUrlClient(prevAttachment.url) || prevAttachment.url}
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
