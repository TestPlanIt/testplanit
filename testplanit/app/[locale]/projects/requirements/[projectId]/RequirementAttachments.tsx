"use client";

import { useClientQueries } from "@zenstackhq/tanstack-query/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  AttachmentsDisplay,
  type AttachmentChanges,
} from "@/components/AttachmentsDisplay";
import { AttachmentsCarousel } from "@/components/AttachmentsCarousel";
import UploadAttachments from "@/components/UploadAttachments";
import type { Attachments } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";

interface RequirementAttachmentsProps {
  requirementId: number;
  isEditMode: boolean;
  /** True while the panel's save is in flight — staging a file mid-save
   *  would be silently discarded by the success handler's reset. */
  isSaving: boolean;
  onStagedFilesChange: (files: File[]) => void;
  onPendingChangesChange: (changes: AttachmentChanges) => void;
}

/**
 * HIER-06's attachments section, rebuilt on the repository case's own
 * machinery instead of a bespoke, always-mutating list. Display mode is
 * view-only by construction, not by a second gate added here:
 * `AttachmentsDisplay` renders every mutating affordance behind
 * `deferredMode && !preventEditing`, so passing `preventEditing` with
 * `deferredMode` left off (the display branch below) leaves the component
 * with no add or remove control at all. Edit mode passes `deferredMode` so
 * a removal only ever stages into the shared `AttachmentChanges { edits,
 * deletes }` pending state -- this component performs no mutation of any
 * kind. `RequirementDetailPanel.tsx` owns the staged state (files, pending
 * changes) and applies it -- edits, then deletes, then signed-url uploads
 * -- on Save, and discards it on Cancel.
 *
 * Clicking an attachment opens the shared `AttachmentsCarousel` viewer in
 * EITHER mode, always with `canEdit={false}`: editing an attachment from
 * inside the carousel would write immediately and walk straight around the
 * deferred flow this component exists to enforce.
 *
 * Deliberately NOT gated on `isRequirementLocked` -- attachments, like
 * `Issue.note`, are outside the five `LOCKED_ISSUE_FIELDS` and stay usable
 * on a synced, locked requirement (see `RequirementDetailPanel.tsx`'s
 * identical carve-out for the note field).
 */
export function RequirementAttachments({
  requirementId,
  isEditMode,
  isSaving,
  onStagedFilesChange,
  onPendingChangesChange,
}: RequirementAttachmentsProps) {
  const t = useTranslations("requirements.attachments");

  const [selectedAttachmentIndex, setSelectedAttachmentIndex] = useState<
    number | null
  >(null);
  const [selectedAttachments, setSelectedAttachments] = useState<Attachments[]>(
    []
  );

  const { data: attachments } = useClientQueries(
    schema
  ).attachments.useFindMany({
    where: { issueId: requirementId, isDeleted: false },
    orderBy: { createdAt: "desc" },
  });

  const handleSelect = (selected: Attachments[], index: number) => {
    setSelectedAttachments(selected);
    setSelectedAttachmentIndex(index);
  };

  const handleClose = () => setSelectedAttachmentIndex(null);

  const hasAttachments = Boolean(attachments && attachments.length > 0);

  return (
    <div data-testid="requirement-attachments" className="flex flex-col gap-2">
      <h3 className="font-bold">{t("title")}</h3>
      {isEditMode ? (
        <>
          <UploadAttachments
            onFileSelect={onStagedFilesChange}
            compact
            disabled={isSaving}
          />
          {hasAttachments ? (
            <AttachmentsDisplay
              attachments={attachments!}
              onSelect={handleSelect}
              deferredMode
              onPendingChanges={onPendingChangesChange}
            />
          ) : (
            <div className="text-sm text-muted-foreground">{t("empty")}</div>
          )}
        </>
      ) : hasAttachments ? (
        <AttachmentsDisplay
          attachments={attachments!}
          onSelect={handleSelect}
          preventEditing
        />
      ) : (
        <div className="text-sm text-muted-foreground">{t("empty")}</div>
      )}
      {selectedAttachmentIndex !== null && (
        <AttachmentsCarousel
          attachments={selectedAttachments}
          initialIndex={selectedAttachmentIndex}
          onClose={handleClose}
          canEdit={false}
        />
      )}
    </div>
  );
}

export default RequirementAttachments;
