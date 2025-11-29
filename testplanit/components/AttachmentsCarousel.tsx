import React, { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import { Attachments } from "@prisma/client";
import { useUpdateAttachments } from "~/lib/hooks";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  SquarePen,
  Trash2,
  CircleSlash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Link } from "~/lib/navigation";
import { UserNameCell } from "./tables/UserNameCell";
import { DateFormatter } from "./DateFormatter";
import { filesize } from "filesize";
import { Separator } from "./ui/separator";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { Textarea } from "./ui/textarea";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useTranslations } from "next-intl";

interface AttachmentsCarouselProps {
  attachments: Attachments[];
  initialIndex: number;
  onClose: () => void;
  canEdit: boolean;
}

export const AttachmentsCarousel: React.FC<AttachmentsCarouselProps> = ({
  attachments: initialAttachments,
  initialIndex,
  onClose,
  canEdit,
}) => {
  const { data: session } = useSession();
  const t = useTranslations();
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(initialIndex);
  const { mutateAsync: updateAttachments } = useUpdateAttachments();

  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedNote, setEditedNote] = useState("");
  const [attachments, setAttachments] = useState(initialAttachments);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [openPopovers, setOpenPopovers] = useState<boolean[]>(
    initialAttachments.map(() => false)
  );

  useEffect(() => {
    if (api) {
      api.scrollTo(initialIndex);
    }
  }, [api, initialIndex]);

  useEffect(() => {
    if (api) {
      const handleSelect = () => {
        setCurrent(api.selectedScrollSnap());
        setIsEditing(false);
      };
      api.on("select", handleSelect);
      return () => {
        api.off("select", handleSelect);
      };
    }
  }, [api]);

  const handlePrev = () => {
    if (api && current > 0) {
      api.scrollTo(current - 1);
    }
  };

  const handleNext = () => {
    if (api && current < attachments.length - 1) {
      api.scrollTo(current + 1);
    }
  };

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
    if (!isEditing) {
      setEditedName(attachments[current].name);
      setEditedNote(attachments[current].note || "");
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    const updatedAttachment = {
      ...attachments[current],
      name: editedName,
      note: editedNote,
    };

    await updateAttachments({
      data: {
        name: editedName,
        note: editedNote,
      },
      where: {
        id: attachments[current].id,
      },
    });

    setAttachments((prevAttachments) =>
      prevAttachments.map((attachment, index) =>
        index === current ? updatedAttachment : attachment
      )
    );

    setIsEditing(false);
    setIsSubmitting(false);
  };

  const handlePopoverOpenChange = (index: number, isOpen: boolean) => {
    setOpenPopovers((prev) => {
      const newOpenPopovers = [...prev];
      newOpenPopovers[index] = isOpen;
      return newOpenPopovers;
    });
  };

  const handleDelete = async (index: number) => {
    const attachment = attachments[index];
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
      setAttachments((prevAttachments) =>
        prevAttachments.filter((_, idx) => idx !== index)
      );
      setCurrent((prevCurrent) => (prevCurrent > 0 ? prevCurrent - 1 : 0));
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to delete attachment:", error);
    } finally {
      setIsSubmitting(false);
    }
    // console.log(`Delete attachment at index ${index}`);
    handlePopoverOpenChange(index, false);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="w-full min-w-md max-w-6xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("attachments.viewer.title")}</DialogTitle>
          <DialogDescription>
            {current + 1} {t("common.table.pagination.of")} {attachments.length}
          </DialogDescription>
        </DialogHeader>
        <div className="relative w-full max-h-[80vh] overflow-hidden">
          <Carousel
            setApi={setApi}
            className="w-full min-w-sm max-w-5xl mx-auto"
          >
            <CarouselContent className="w-full mx-4">
              {attachments.map((attachment, index) => (
                <CarouselItem key={attachment.id} className="w-full">
                  <div className="flex flex-col items-center p-4 w-full h-full">
                    <div className="flex items-center w-full">
                      {isEditing && index === current ? (
                        <div className="flex items-start justify-between gap-4 w-full">
                          <Input
                            type="text"
                            value={editedName}
                            onChange={(e) => setEditedName(e.target.value)}
                            className="text-2xl font-bold text-center mb-4 w-full"
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
                                    onClick={() => handleDelete(index)}
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
                        <div className="text-2xl font-bold text-center mb-5 w-full">
                          {attachment.name}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col md:flex-row w-full h-full">
                      <div className="md:w-2/3 flex flex-col items-center">
                        <div className="w-full flex justify-center items-start">
                          <AttachmentPreview
                            attachment={attachment}
                            size="large"
                          />
                        </div>
                      </div>
                      <div className="md:w-1/3 w-full flex flex-col justify-start items-start p-4 overflow-auto">
                        <div className="text-left space-y-2 w-full">
                          <div>
                            <strong>{t("common.fields.description")}</strong>
                            <div className="flex items-center w-full h-24 max-h-24 md:max-h-48 overflow-auto">
                              {isEditing && index === current ? (
                                <Textarea
                                  className="text-md h-24"
                                  value={editedNote}
                                  onChange={(e) =>
                                    setEditedNote(e.target.value)
                                  }
                                />
                              ) : (
                                <span className="w-full h-24">
                                  {attachment.note
                                    ? attachment.note
                                    : t("common.labels.none")}
                                </span>
                              )}
                            </div>
                          </div>
                          <Separator className="w-full" />
                          <div className="text-sm">
                            <strong>{t("common.fields.size")}</strong>{" "}
                            {filesize(Number(attachment.size))}
                          </div>
                          <div className="text-sm">
                            <strong>{t("common.fields.created")}</strong>
                            <div>
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
                          <div className="text-sm">
                            <strong>{t("common.fields.createdBy")}</strong>
                            <UserNameCell userId={attachment.createdById} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
          <Button
            className="absolute left-0 top-1/2 transform -translate-y-1/2 p-2"
            onClick={handlePrev}
            disabled={current === 0}
          >
            <ChevronLeft className="w-6 h-6" />
          </Button>
          <Button
            className="absolute right-0 top-1/2 transform -translate-y-1/2 p-2"
            onClick={handleNext}
            disabled={current === attachments.length - 1}
          >
            <ChevronRight className="w-6 h-6" />
          </Button>
        </div>
        <DialogFooter>
          <div className="flex items-center gap-4">
            <Link
              href={attachments[current].url}
              download={attachments[current].name}
              target="_blank"
            >
              <Button variant="default" disabled={isEditing}>
                <Download className="inline w-5 h-5 mr-2" />
                {t("common.actions.download")}
              </Button>
            </Link>
            {canEdit && (
              <>
                {isEditing ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={handleEditToggle}
                      disabled={isSubmitting}
                    >
                      {t("common.actions.cancel")}
                    </Button>
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                      {isSubmitting
                        ? t("common.status.submitting")
                        : t("common.actions.submit")}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={handleEditToggle}
                    disabled={isSubmitting}
                  >
                    <SquarePen className="w-4 h-4 mr-2" />{" "}
                    {t("common.actions.edit")}
                  </Button>
                )}
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
