"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import RequirementDetailPanel from "@/projects/requirements/[projectId]/RequirementDetailPanel";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link } from "~/lib/navigation";

import { RequirementBreadcrumb } from "./RequirementBreadcrumb";

/**
 * Focus targets that legitimately consume arrow keys -- text inputs, the
 * rich-text editor, native/ARIA selects & comboboxes, sliders, and anything
 * inside an open menu or dialog. Gates the panel's arrow-key prev/next so it
 * never steals arrows from editing or from assistive-tech interactions.
 * Ported verbatim from `CaseDetailsPanel` so the two panels answer the same
 * question the same way.
 */
function focusWantsArrowKeys(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!el.closest(
    'input, textarea, select, [contenteditable="true"], [role="textbox"], ' +
      '[role="searchbox"], [role="combobox"], [role="listbox"], [role="menu"], ' +
      '[role="grid"], [role="slider"], [role="spinbutton"], [role="tree"], ' +
      '[role="tablist"], [role="dialog"], [role="alertdialog"], [role="separator"]'
  );
}

interface RequirementDetailsPanelProps {
  projectId: string;
  requirementId: number;
  fullWidth: boolean;
  onToggleFullWidth: () => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** Null when the selected requirement is not in the current row set --
   *  filtered out, or inside a collapsed subtree. The whole stepper hides
   *  rather than showing a position it cannot honestly compute. */
  position: number | null;
  total: number;
  /** Forwarded to the detail body: the workspace's Delete route and its
   *  edit-mode request token. Both optional there, and both absent on the
   *  standalone route, which owns neither dialog. */
  onRequestDelete?: () => void;
  editRequest?: { id: number; token: number } | null;
}

/**
 * Chrome around the existing `RequirementDetailPanel`, mirroring
 * `components/repositories/CaseDetailsPanel.tsx` so requirements and test
 * cases behave identically: a header toolbar with expand/contract, a
 * prev/next stepper over the list's visible order, a link to the standalone
 * page, and close.
 *
 * The body is `RequirementDetailPanel` unchanged -- the same component the
 * standalone route renders. That sharing is the whole point of the pattern:
 * the page is a thin wrapper, not a second implementation.
 */
export function RequirementDetailsPanel({
  projectId,
  requirementId,
  fullWidth,
  onToggleFullWidth,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  position,
  total,
  onRequestDelete,
  editRequest,
}: RequirementDetailsPanelProps) {
  const t = useTranslations();
  const toggleLabel = fullWidth
    ? t("repository.cases.collapseDetails")
    : t("repository.cases.expandDetails");

  // Arrow-key stepping, gated on the focus guard above so it never
  // interferes with text editing, selects, or screen-reader browse mode
  // (which consumes arrows itself). Direction is flipped under RTL. The
  // visible buttons remain the primary, always-available affordance.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (focusWantsArrowKeys(document.activeElement)) return;
      const rtl = document.dir === "rtl";
      const wantsPrev = rtl ? e.key === "ArrowRight" : e.key === "ArrowLeft";
      if (wantsPrev) {
        if (!hasPrev) return;
        e.preventDefault();
        onPrev();
      } else {
        if (!hasNext) return;
        e.preventDefault();
        onNext();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [hasPrev, hasNext, onPrev, onNext]);

  return (
    <div
      className="flex h-full flex-col bg-background"
      data-testid="requirement-details-panel"
    >
      <div className="flex items-center justify-between rounded-lg bg-primary text-primary-foreground [&_button:hover]:bg-primary-foreground/15 [&_button:hover]:text-primary-foreground px-3 h-9 mt-0.5 shrink-0 gap-2 shadow-md">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onToggleFullWidth}
              aria-label={toggleLabel}
              data-testid="requirement-details-fullwidth-toggle"
            >
              {fullWidth ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>

        {position != null && (
          <div className="flex items-center gap-1 min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  aria-label={t("requirements.detail.previousRequirement")}
                  data-testid="requirement-details-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("requirements.detail.previousRequirement")}
              </TooltipContent>
            </Tooltip>
            <span
              className="text-primary-foreground text-sm tabular-nums whitespace-nowrap"
              data-testid="requirement-details-position"
            >
              {t("repository.cases.caseNavPosition", {
                position: String(position),
                total: String(total),
              })}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={onNext}
                  disabled={!hasNext}
                  aria-label={t("requirements.detail.nextRequirement")}
                  data-testid="requirement-details-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("requirements.detail.nextRequirement")}
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={`/projects/requirements/${projectId}/${requirementId}`}
                target="_blank"
                aria-label={t("repository.cases.openFullPage")}
                data-testid="requirement-details-open-full-page"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  tabIndex={-1}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent>{t("repository.cases.openFullPage")}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onClose}
                aria-label={t("common.actions.close")}
                data-testid="requirement-details-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("common.actions.close")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* The breadcrumb earns its place only once the tree is off screen;
          in split view the tree itself is the answer to "where does this
          sit?" and a second copy is noise. */}
      {fullWidth && (
        <div className="px-3 pt-2 shrink-0">
          <RequirementBreadcrumb
            projectId={projectId}
            requirementId={requirementId}
            hrefForAncestor={(ancestorId) =>
              `/projects/requirements/${projectId}?requirement=${ancestorId}`
            }
          />
        </div>
      )}

      {/* Body -- the same detail view the standalone route renders. Keyed on
          the id so stepping to the next requirement remounts it and its
          form state cannot leak across rows, matching CaseDetailsPanel. */}
      <div className="flex-1 overflow-y-auto">
        <RequirementDetailPanel
          key={requirementId}
          projectId={projectId}
          requirementId={requirementId}
          onRequestDelete={onRequestDelete}
          editRequest={editRequest}
        />
      </div>
    </div>
  );
}

export default RequirementDetailsPanel;
