import { Direction } from "radix-ui";
import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { schema } from "~/zenstack/schema";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { Button } from "@/components/ui/button";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Attachments } from "~/zenstack/models";
import { filesize } from "filesize";
import {
  ChevronLeft,
  ChevronRight,
  CircleSlash2,
  Download,
  ExternalLink,
  SquarePen,
  Trash,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import React, { useEffect, useState } from "react";
import { getStorageUrlClient } from "~/utils/storageUrl";
import { DateFormatter } from "./DateFormatter";
import { UserNameCell } from "./tables/UserNameCell";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";
import { Textarea } from "./ui/textarea";

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
  const dir = Direction.useDirection();
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(initialIndex);
  const { mutateAsync: updateAttachments } =
    useClientQueries(schema).attachments.useUpdate();

  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState("");
  const [editedNote, setEditedNote] = useState("");
  const [attachments, setAttachments] = useState(initialAttachments);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [openPopovers, setOpenPopovers] = useState<boolean[]>(
    initialAttachments.map(() => false)
  );

  const handleFullScreenChange = (fullScreen: boolean) => {
    setIsFullScreen(fullScreen);
    // The edit controls are hidden while expanded, so don't leave edit mode
    // armed with a stale name/note form.
    if (fullScreen) {
      setIsEditing(false);
    }
  };

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

  // Arrow-key navigation. The shadcn Carousel only listens for arrows while
  // focus is within its own root, which never happens here — focus lands on the
  // dialog chrome or an embedded viewer — so wire a window-level handler that
  // works wherever focus sits inside the modal. If focus is inside the carousel
  // root its own handler runs first and calls preventDefault, so bail on an
  // already-handled event to avoid moving two slides at once.
  useEffect(() => {
    if (!api) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      // In RTL the visual order flips, so the physical arrow keys swap.
      const goPrev = (event.key === "ArrowLeft") !== (dir === "rtl");
      if (goPrev) api.scrollPrev();
      else api.scrollNext();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [api, dir]);

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
      <DialogContent
        className="flex w-full max-w-6xl min-w-md flex-col overflow-hidden"
        fullScreen={isFullScreen}
        onFullScreenChange={handleFullScreenChange}
        // While expanded, Escape steps back to the normal modal instead of
        // closing it; a second Escape then closes as usual.
        onEscapeKeyDown={(event) => {
          if (isFullScreen) {
            event.preventDefault();
            setIsFullScreen(false);
          }
        }}
      >
        {/* sr-only (not unmounted) in full screen: Radix requires a mounted
            DialogTitle/DialogDescription for accessibility. */}
        <DialogHeader className={isFullScreen ? "sr-only" : "shrink-0"}>
          <DialogTitle>{t("attachments.viewer.title")}</DialogTitle>
          <DialogDescription>
            {current + 1} {t("common.of")} {attachments.length}
          </DialogDescription>
        </DialogHeader>
        <div className="relative min-h-0 w-full flex-1 overflow-hidden">
          <Carousel
            setApi={setApi}
            className="mx-auto w-full max-w-5xl min-w-sm"
          >
            <CarouselContent className="mx-4 w-full">
              {attachments.map((attachment, index) => (
                <CarouselItem key={attachment.id} className="w-full">
                  {isFullScreen ? (
                    // Expanded mode: nothing but the attachment, scaled to the
                    // modal viewport. Clicking a non-interactive preview
                    // (images) toggles back out, same as the expand button.
                    <div className="flex h-[calc(100vh-6rem)] w-full items-center justify-center p-2">
                      {attachment.mimeType.startsWith("image/") ? (
                        <button
                          type="button"
                          onClick={() => handleFullScreenChange(false)}
                          aria-label={t("common.ui.dialog.toggleFullScreen")}
                          className="block h-full w-full cursor-zoom-out"
                          data-testid="carousel-fullscreen-preview"
                        >
                          <AttachmentPreview
                            attachment={attachment}
                            size="full"
                          />
                        </button>
                      ) : (
                        <AttachmentPreview
                          attachment={attachment}
                          size="full"
                        />
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full w-full flex-col items-center p-4">
                      <div className="flex w-full items-center">
                        {isEditing && index === current ? (
                          <div className="flex w-full items-start justify-between gap-4">
                            <Input
                              type="text"
                              value={editedName}
                              onChange={(e) => setEditedName(e.target.value)}
                              className="mb-4 w-full text-center text-2xl font-bold"
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
                                  className="ms-auto w-fit"
                                >
                                  <Trash className="h-5 w-5" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-fit" side="bottom">
                                {t("attachments.delete.confirmMessage")}
                                <div className="mt-2 flex items-start justify-between gap-4">
                                  <div className="mb-2 flex items-center">
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      className="ms-auto"
                                      onClick={() =>
                                        handlePopoverOpenChange(index, false)
                                      }
                                    >
                                      <CircleSlash2 className="h-4 w-4" />
                                      {t("common.cancel")}
                                    </Button>
                                  </div>
                                  <div className="flex items-center">
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      onClick={() => handleDelete(index)}
                                      className="ms-auto"
                                    >
                                      <Trash className="h-4 w-4" />
                                      {t("common.actions.delete")}
                                    </Button>
                                  </div>
                                </div>
                              </PopoverContent>
                            </Popover>
                          </div>
                        ) : (
                          <div className="mb-5 w-full text-center text-2xl font-bold">
                            {attachment.name}
                          </div>
                        )}
                      </div>
                      <div
                        className={`flex h-full w-full ${
                          attachment.mimeType === "text/uri-list"
                            ? "flex-col"
                            : "flex-col md:flex-row"
                        }`}
                      >
                        <div
                          className={`flex flex-col items-center ${
                            attachment.mimeType === "text/uri-list"
                              ? "w-full py-2"
                              : "md:w-2/3"
                          }`}
                        >
                          <div className="flex w-full items-start justify-center">
                            {attachment.mimeType.startsWith("image/") ? (
                              <button
                                type="button"
                                onClick={() => handleFullScreenChange(true)}
                                aria-label={t(
                                  "common.ui.dialog.toggleFullScreen"
                                )}
                                className="cursor-zoom-in"
                                data-testid="carousel-expand-preview"
                              >
                                <AttachmentPreview
                                  attachment={attachment}
                                  size="large"
                                />
                              </button>
                            ) : (
                              <AttachmentPreview
                                attachment={attachment}
                                size="large"
                              />
                            )}
                          </div>
                        </div>
                        <div
                          className={`flex w-full flex-col items-start justify-start overflow-auto p-4 ${
                            attachment.mimeType === "text/uri-list"
                              ? ""
                              : "md:w-1/3"
                          }`}
                        >
                          <div
                            className={`w-full text-start ${
                              attachment.mimeType === "text/uri-list"
                                ? "grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-6 gap-y-2"
                                : "space-y-2"
                            }`}
                          >
                            <div>
                              <strong>{t("common.fields.description")}</strong>
                              <div
                                className={`flex w-full items-center overflow-auto ${
                                  attachment.mimeType === "text/uri-list"
                                    ? "min-h-[1.5rem]"
                                    : "h-24 max-h-24 md:max-h-48"
                                }`}
                              >
                                {isEditing && index === current ? (
                                  <Textarea
                                    className="text-md h-24"
                                    value={editedNote}
                                    onChange={(e) =>
                                      setEditedNote(e.target.value)
                                    }
                                  />
                                ) : (
                                  <span
                                    className={
                                      attachment.mimeType === "text/uri-list"
                                        ? "w-full"
                                        : "h-24 w-full"
                                    }
                                  >
                                    {attachment.note
                                      ? attachment.note
                                      : t("common.access.none")}
                                  </span>
                                )}
                              </div>
                            </div>
                            {attachment.mimeType !== "text/uri-list" && (
                              <Separator className="w-full" />
                            )}
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
                  )}
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
          <Button
            className="absolute start-0 top-1/2 -translate-y-1/2 transform p-2"
            onClick={handlePrev}
            disabled={current === 0}
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          <Button
            className="absolute end-0 top-1/2 -translate-y-1/2 transform p-2"
            onClick={handleNext}
            disabled={current === attachments.length - 1}
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        </div>
        {!isFullScreen && (
          <DialogFooter className="shrink-0">
            <div className="flex items-center gap-4">
              {(() => {
                const isLink =
                  attachments[current].mimeType === "text/uri-list";
                return (
                  <a
                    href={
                      getStorageUrlClient(attachments[current].url) ||
                      attachments[current].url
                    }
                    {...(isLink ? {} : { download: attachments[current].name })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button variant="default" disabled={isEditing}>
                      {isLink ? (
                        <ExternalLink className="inline h-5 w-5" />
                      ) : (
                        <Download className="inline h-5 w-5" />
                      )}
                      {isLink
                        ? t("common.actions.openLink")
                        : t("common.actions.download")}
                    </Button>
                  </a>
                );
              })()}
              {canEdit && (
                <>
                  {isEditing ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={handleEditToggle}
                        disabled={isSubmitting}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button onClick={handleSubmit} disabled={isSubmitting}>
                        {isSubmitting
                          ? t("common.actions.saving")
                          : t("common.actions.submit")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={handleEditToggle}
                      disabled={isSubmitting}
                    >
                      <SquarePen className="h-4 w-4" />
                      {t("common.actions.edit")}
                    </Button>
                  )}
                </>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
};
