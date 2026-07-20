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

import { TestCaseDetailsView } from "@/[locale]/projects/repository/[projectId]/[caseId]/TestCaseDetailsView";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Link } from "~/lib/navigation";

/**
 * True when the focused element should keep arrow keys for itself — text fields,
 * the rich-text editor, native/ARIA selects & comboboxes, sliders, and anything
 * inside an open menu or dialog. Used to gate the panel's arrow-key prev/next so
 * it never steals arrows from editing or from assistive-tech interactions.
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
      '[role="tablist"], [role="dialog"], [role="alertdialog"]'
  );
}

interface CaseDetailsPanelProps {
  /** Selected case id (string, from the `case` URL param). */
  caseId: string;
  /** Project id (string). */
  projectId: string;
  /** True when the panel fills the whole content area (tree + list hidden). */
  fullWidth: boolean;
  /** Toggle split ↔ full-width. */
  onToggleFullWidth: () => void;
  /** Close the panel (clears the `case` param). */
  onClose: () => void;
  /** Step to the previous case in the filtered result set. */
  onPrev: () => void;
  /** Step to the next case in the filtered result set. */
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  /** 1-based position within the full result set, or null while resolving. */
  position: number | null;
  /** Total cases in the current filtered result set. */
  total: number;
}

/**
 * Docked test-case details panel shown to the right of the repository list
 * (Testiny-style). It wraps the reusable {@link TestCaseDetailsView} with panel
 * chrome: a full-width toggle + "open full page" link + close in the header, and
 * a prev/next stepper (position within the whole filtered set) in the footer.
 *
 * The view is remounted on `caseId` change (via `key`) so its internal edit
 * state resets when stepping between cases. It self-fetches by id, so prev/next
 * works even when the neighbour lives on another list page.
 */
export function CaseDetailsPanel({
  caseId,
  projectId,
  fullWidth,
  onToggleFullWidth,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  position,
  total,
}: CaseDetailsPanelProps) {
  const t = useTranslations();

  const toggleLabel = fullWidth
    ? t("repository.cases.collapseDetails")
    : t("repository.cases.expandDetails");

  // Keyboard prev/next: Left/Right step through the result set, but only when
  // focus isn't in a field/editor/menu and no modifier is held — so we never
  // interfere with text editing, selects, or screen-reader browse mode (which
  // consumes arrows itself). Direction is flipped under RTL. The visible
  // buttons remain the primary, always-available affordance.
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
      data-testid="case-details-panel"
    >
      {/* Header toolbar */}
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
              data-testid="case-details-fullwidth-toggle"
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

        {/* Prev/next through the full filtered result set. Hidden when the
            selected case isn't part of the current list (e.g. after switching
            folders) — there's no position, so the whole stepper goes away. */}
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
                  aria-label={t("repository.cases.previousCase")}
                  data-testid="case-details-prev"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("repository.cases.previousCase")}
              </TooltipContent>
            </Tooltip>
            <span
              className="text-primary-foreground text-sm tabular-nums whitespace-nowrap"
              data-testid="case-details-position"
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
                  aria-label={t("repository.cases.nextCase")}
                  data-testid="case-details-next"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("repository.cases.nextCase")}</TooltipContent>
            </Tooltip>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={`/projects/repository/${projectId}/${caseId}`}
                target="_blank"
                aria-label={t("repository.cases.openFullPage")}
                data-testid="case-details-open-full-page"
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
            <TooltipContent>
              {t("repository.cases.openFullPage")}
            </TooltipContent>
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
                data-testid="case-details-close"
              >
                <X className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("common.actions.close")}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Body — the reused case details view (read + edit) */}
      <div className="flex-1 overflow-y-auto">
        <TestCaseDetailsView
          key={caseId}
          caseIdOverride={caseId}
          projectIdOverride={projectId}
          inSheet
          onClose={onClose}
        />
      </div>
    </div>
  );
}
