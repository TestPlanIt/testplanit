"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { isMacPlatform, useDragModifier } from "~/hooks/useDragModifier";
import { useDragTargetKind } from "~/hooks/useDragTargetKind";
import { cn } from "~/utils";

interface DropZoneOverlayProps {
  /**
   * What dropping here does: reorder within the case list, or move/copy onto a
   * folder in the tree.
   */
  kind: "reorder" | "tree";
  /** Set false where the zone cannot accept a drop, e.g. a non-folder view. */
  enabled?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}

/**
 * Outlines a region that accepts the case currently being dragged and says what
 * dropping there will do.
 *
 * Reads the drag state from context rather than taking it as a prop: the
 * provider is rendered by the repository page itself, so anything reading the
 * state in that component's own body would sit above the provider and never see
 * a drag start.
 *
 * The outline never takes pointer events — drawing it must not intercept the
 * drop it is advertising.
 */
export function DropZoneOverlay({
  kind,
  enabled = true,
  children,
  className,
  testId,
}: DropZoneOverlayProps) {
  const t = useTranslations("repository.dragDrop");
  const { isDraggingCase, isDraggingFolder } = useDragTargetKind();
  // A held modifier decides whether dropping on the tree prompts or acts
  // directly, so the wording follows it.
  const { copyHeld, moveHeld } = useDragModifier(isDraggingCase);

  // A dragged folder can only land in the tree (reorder/nest), never the case
  // list, so it lights up the tree zone only.
  const draggingFolderHere = kind === "tree" && isDraggingFolder;
  const active = enabled && (isDraggingCase || draggingFolderHere);
  if (!active) {
    return <div className={cn("relative h-full", className)}>{children}</div>;
  }

  // With a modifier held the outcome is already decided, so name it. Otherwise
  // spell out the keys that decide it, rather than leaving the user to discover
  // the prompt.
  const label = draggingFolderHere
    ? t("dropZoneFolder")
    : kind === "reorder"
      ? t("dropZoneReorder")
      : copyHeld
        ? t("dropZoneTreeCopy")
        : moveHeld
          ? t("dropZoneTreeMove")
          : isMacPlatform()
            ? t("dropZoneTreeMac")
            : t("dropZoneTreeWin");

  return (
    <div className={cn("relative h-full", className)}>
      {children}
      <div
        aria-hidden
        data-testid={testId}
        className="pointer-events-none absolute inset-0 z-30 rounded-md border-2 border-dashed border-primary bg-primary/5"
      >
        <div className="absolute inset-x-0 top-0 flex -translate-y-1/2 justify-center px-2">
          <span className="max-w-full truncate rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow-md">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}

export default DropZoneOverlay;
