"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { filesize } from "filesize";
import { Download, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AttachmentPreview } from "@/components/AttachmentPreview";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import UploadAttachments from "@/components/UploadAttachments";
import { Link } from "~/lib/navigation";
import { fetchSignedUrl } from "~/utils/fetchSignedUrl";
import { getStorageUrlClient } from "~/utils/storageUrl";
import { schema } from "~/zenstack/schema";

interface RequirementAttachmentsProps {
  projectId: string;
  requirementId: number;
}

/**
 * HIER-06's discrete attachment list: a client-side staging picker
 * (UploadAttachments) above the persisted, independently removable list --
 * the same two-component split TestCaseFormControl.tsx uses. Persists
 * through the same signed-url path every other attachment surface in this
 * codebase uses (fetchSignedUrl -> attachments.useCreate()), never the
 * legacy attachment-upload route, which has zero consumers.
 *
 * Deliberately NOT gated on isRequirementLocked -- attachments, like
 * Issue.note, are outside the five LOCKED_ISSUE_FIELDS and stay usable on a
 * synced, locked requirement (see RequirementDetailPanel.tsx's identical
 * carve-out for the note field).
 */
export function RequirementAttachments({
  projectId,
  requirementId,
}: RequirementAttachmentsProps) {
  const t = useTranslations("requirements.attachments");
  const tAttachments = useTranslations("attachments");
  const tCommon = useTranslations("common");
  const { data: session } = useSession();

  const [isUploading, setIsUploading] = useState(false);
  // Bumped after every processed batch to remount UploadAttachments, which
  // clears its own internal staged-file list -- the same key-remount trick
  // RequirementDetailPanel.tsx already uses for TipTapEditor.
  const [uploadKey, setUploadKey] = useState(0);
  const [openRemoveId, setOpenRemoveId] = useState<number | null>(null);
  // UploadAttachments always reports its FULL cumulative staged array on
  // every change, not just the newly-added delta, so this tracks file
  // signatures already handed to fetchSignedUrl this batch to avoid
  // double-uploading a file still in flight.
  const processedRef = useRef<Set<string>>(new Set());

  const { data: attachments } = useClientQueries(
    schema
  ).attachments.useFindMany({
    where: { issueId: requirementId, isDeleted: false },
    orderBy: { createdAt: "desc" },
  });

  const { mutateAsync: createAttachment } =
    useClientQueries(schema).attachments.useCreate();
  const { mutateAsync: updateAttachment } =
    useClientQueries(schema).attachments.useUpdate();

  const handleFileSelect = async (files: File[]) => {
    const userId = session?.user?.id;
    if (!userId) return;

    const newFiles = files.filter((file) => {
      const signature = `${file.name}-${file.size}-${file.lastModified}`;
      if (processedRef.current.has(signature)) return false;
      processedRef.current.add(signature);
      return true;
    });
    if (newFiles.length === 0) return;

    setIsUploading(true);
    try {
      // sanitizedFolder/prependString convention matched from the other
      // fetchSignedUrl call sites (AddSessionModal.tsx, SessionResultForm.tsx):
      // projectId, then the acting user's id.
      const sanitizedFolder = projectId?.toString() || "";
      await Promise.all(
        newFiles.map(async (file) => {
          const fileUrl = await fetchSignedUrl(
            file,
            `/api/get-attachment-url/`,
            `${sanitizedFolder}/${userId}`
          );
          await createAttachment({
            data: {
              issue: { connect: { id: requirementId } },
              url: fileUrl,
              name: file.name,
              note: "",
              mimeType: file.type,
              size: BigInt(file.size),
              createdBy: { connect: { id: userId } },
            },
          });
        })
      );
      toast.success(t("uploadSuccess"));
    } catch (error) {
      console.error("Failed to upload requirement attachment:", error);
      toast.error(t("uploadFailed"));
    } finally {
      setIsUploading(false);
      processedRef.current.clear();
      setUploadKey((key) => key + 1);
    }
  };

  const handleRemove = async (attachmentId: number) => {
    setOpenRemoveId(null);
    try {
      // Always soft-delete -- never a real delete of user data.
      await updateAttachment({
        where: { id: attachmentId },
        data: { isDeleted: true },
      });
      toast.success(t("removeSuccess"));
    } catch (error) {
      console.error("Failed to remove requirement attachment:", error);
      toast.error(t("removeFailed"));
    }
  };

  return (
    <div data-testid="requirement-attachments" className="flex flex-col gap-2">
      <h3 className="font-bold">{t("title")}</h3>
      <UploadAttachments
        key={uploadKey}
        onFileSelect={handleFileSelect}
        disabled={isUploading}
        compact
      />
      {attachments && attachments.length > 0 ? (
        <ul
          className="flex flex-col gap-2"
          data-testid="requirement-attachments-list"
        >
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              data-testid={`requirement-attachment-${attachment.id}`}
              className="flex items-center border rounded-sm p-2"
            >
              <div className="shrink-0">
                <AttachmentPreview attachment={attachment} size="small" />
              </div>
              <div className="flex-1 min-w-0 px-2">
                <div className="truncate text-sm">{attachment.name}</div>
                <div className="text-xs text-muted-foreground">
                  {filesize(Number(attachment.size))}
                </div>
              </div>
              <Link
                href={getStorageUrlClient(attachment.url) || attachment.url}
                target="_blank"
                aria-label={tCommon("actions.download")}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
              >
                <Download className="h-4 w-4" />
              </Link>
              <Popover
                open={openRemoveId === attachment.id}
                onOpenChange={(open) =>
                  setOpenRemoveId(open ? attachment.id : null)
                }
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tCommon("actions.remove")}
                    data-testid={`requirement-attachment-remove-${attachment.id}`}
                    onClick={() => setOpenRemoveId(attachment.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-fit" side="bottom">
                  <div className="mb-2">
                    {tAttachments("delete.confirmMessage")}
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setOpenRemoveId(null)}
                    >
                      {tCommon("cancel")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      data-testid={`requirement-attachment-remove-confirm-${attachment.id}`}
                      onClick={() => handleRemove(attachment.id)}
                    >
                      {tCommon("actions.remove")}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-muted-foreground">{t("empty")}</div>
      )}
    </div>
  );
}

export default RequirementAttachments;
